/**
 * Generate reading comprehension questions for texts in reading_texts table.
 * Uses xai('grok-4-1-fast-reasoning') to create tiered questions.
 * All generated questions are stored with reviewed = 0 (pending admin review).
 * 
 * Usage: npx tsx scripts/generate-questions.ts [--text-id=N] [--force]
 *   --text-id=N  Only process text with this ID
 *   --force      Regenerate even if questions already exist
 */
import { getTursoClient } from '../api/_lib/turso.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

interface GeneratedQuestion {
    tier: number;
    question_type: 'multiple_choice' | 'true_false' | 'true_false_unknown';
    question: string;
    options: string[] | null;
    correct_answer: string;
    explanation: string;
    paragraph_index: number | null;
}

/**
 * Split text into chunks of ~3-4 sentences for the chunked display mode.
 * Returns an array of paragraph chunks.
 */
function splitIntoChunks(text: string): string[] {
    const paragraphs = text.split('\n').filter(p => p.trim().length > 0);
    const chunks: string[] = [];
    let current: string[] = [];
    let sentenceCount = 0;

    for (const para of paragraphs) {
        // Count sentences (rough heuristic)
        const sentences = para.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
        current.push(para);
        sentenceCount += sentences;

        if (sentenceCount >= 3) {
            chunks.push(current.join('\n'));
            current = [];
            sentenceCount = 0;
        }
    }
    if (current.length > 0) {
        chunks.push(current.join('\n'));
    }

    return chunks;
}

async function generateQuestionsForText(textId: number, title: string, text: string, zyklus: number): Promise<GeneratedQuestion[]> {
    const chunks = splitIntoChunks(text);

    const prompt = `Du bist ein erfahrener Schweizer Primarschullehrer der ein Textverständnis-Training erstellt.

TEXT-TITEL: "${title}"
TEXT (${chunks.length} Abschnitte):
${chunks.map((c, i) => `--- Abschnitt ${i + 1} ---\n${c}`).join('\n\n')}

Erstelle Verständnisfragen in 3 Schwierigkeitsstufen. Antworte ausschliesslich mit einem JSON-Array von Frage-Objekten.

REGELN:
- Jede Frage hat: tier (1/2/3), question_type, question, options (array oder null), correct_answer, explanation, paragraph_index (1-basiert, welcher Abschnitt)
- Sprache: Schweizer Hochdeutsch (kein ß, verwende ss statt ß)
- Erklärungen sollen kurz und lernhaft sein

TIER 1 (Faktenwissen, ${zyklus <= 1 ? '4-5' : '3'} Fragen):
- question_type: "multiple_choice"
- 3 Antwortoptionen
- Einfache "Wer?", "Was?", "Wo?" Fragen
- Antwort direkt im Text auffindbar

TIER 2 (Schlussfolgerung, 3-4 Fragen):
- question_type: "multiple_choice" oder "true_false"
- Bei multiple_choice: 4 Antwortoptionen
- Schlussfolgerndes Denken, Wortschatz, Zusammenhänge
- Bei true_false: options = ["Stimmt", "Stimmt nicht"], correct_answer = "Stimmt" oder "Stimmt nicht"

TIER 3 (Analyse, 2-3 Fragen):
- question_type: "true_false_unknown"
- options = ["Stimmt", "Stimmt nicht", "Kann man nicht wissen"]
- MINDESTENS EINE Frage muss "Kann man nicht wissen" als korrekte Antwort haben
- Aussagen, die aus dem Text NICHT ableitbar sind, müssen "Kann man nicht wissen" als Antwort haben
- correct_answer = "Stimmt" oder "Stimmt nicht" oder "Kann man nicht wissen"

Antworte NUR mit dem JSON-Array, keine weiteren Erklärungen.`;

    console.log(`  🤖 Generating questions for "${title}" (Zyklus ${zyklus})...`);

    const result = await generateText({
        model: xai('grok-4-1-fast-reasoning'),
        prompt,
        maxTokens: 4000,
    });

    // Parse JSON from response
    let questions: GeneratedQuestion[];
    try {
        // Extract JSON array from response (might be wrapped in markdown code blocks)
        let jsonStr = result.text.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        questions = JSON.parse(jsonStr);
    } catch (err) {
        console.error(`  ❌ Failed to parse AI response for "${title}":`, err);
        console.error(`  Response: ${result.text.substring(0, 200)}...`);
        return [];
    }

    // Validate and normalize
    return questions.filter(q => {
        if (!q.question || !q.correct_answer || !q.question_type) {
            console.warn(`  ⚠ Skipping invalid question: ${JSON.stringify(q).substring(0, 100)}`);
            return false;
        }
        return true;
    }).map(q => ({
        ...q,
        tier: q.tier || 1,
        paragraph_index: q.paragraph_index || null,
        options: q.options || null,
    }));
}

async function main() {
    const args = process.argv.slice(2);
    const textIdArg = args.find(a => a.startsWith('--text-id='));
    const force = args.includes('--force');
    const targetTextId = textIdArg ? parseInt(textIdArg.split('=')[1]) : null;

    // Get texts to process
    let sql = 'SELECT id, title, text, zyklus FROM reading_texts';
    const sqlArgs: any[] = [];
    if (targetTextId) {
        sql += ' WHERE id = ?';
        sqlArgs.push(targetTextId);
    }

    const texts = await db.execute({ sql, args: sqlArgs });
    console.log(`Found ${texts.rows.length} text(s) to process`);

    for (const row of texts.rows) {
        const textId = row.id as number;
        const title = row.title as string;
        const text = row.text as string;
        const zyklus = row.zyklus as number;

        // Check existing questions
        if (!force) {
            const existing = await db.execute({
                sql: 'SELECT COUNT(*) as cnt FROM reading_questions WHERE text_id = ?',
                args: [textId]
            });
            if ((existing.rows[0].cnt as number) > 0) {
                console.log(`  ⏭ "${title}" already has questions — use --force to regenerate`);
                continue;
            }
        } else {
            // Delete existing questions if forcing
            await db.execute({ sql: 'DELETE FROM reading_questions WHERE text_id = ?', args: [textId] });
        }

        const questions = await generateQuestionsForText(textId, title, text, zyklus);

        if (questions.length === 0) {
            console.log(`  ⚠ No questions generated for "${title}"`);
            continue;
        }

        // Insert questions
        const batch = questions.map(q => ({
            sql: `INSERT INTO reading_questions (text_id, tier, question_type, question, options, correct_answer, explanation, paragraph_index, ai_generated, reviewed)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
            args: [
                textId,
                q.tier,
                q.question_type,
                q.question,
                q.options ? JSON.stringify(q.options) : null,
                q.correct_answer,
                q.explanation || null,
                q.paragraph_index,
            ] as any[]
        }));

        await db.batch(batch);
        console.log(`  ✅ Generated ${questions.length} questions for "${title}":`);
        const t1 = questions.filter(q => q.tier === 1).length;
        const t2 = questions.filter(q => q.tier === 2).length;
        const t3 = questions.filter(q => q.tier === 3).length;
        console.log(`     Tier 1: ${t1}, Tier 2: ${t2}, Tier 3: ${t3}`);
    }

    // Summary
    const total = await db.execute('SELECT COUNT(*) as cnt FROM reading_questions');
    const reviewed = await db.execute('SELECT COUNT(*) as cnt FROM reading_questions WHERE reviewed = 1');
    console.log(`\n═══ Summary ═══`);
    console.log(`  Total questions: ${total.rows[0].cnt}`);
    console.log(`  Reviewed: ${reviewed.rows[0].cnt}`);
    console.log(`  Pending: ${(total.rows[0].cnt as number) - (reviewed.rows[0].cnt as number)}`);
}

main().catch(console.error);
