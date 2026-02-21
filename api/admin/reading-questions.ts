
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from '../_lib/supabase.js';
import { requireAuth, handleCors } from '../_lib/auth.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const db = getSupabaseClient();

    // Check Admin Status
    const { data: user, error: userError } = await db
        .from('users')
        .select('is_admin')
        .eq('uid', decoded.uid)
        .single();
    if (userError || !user || !user.is_admin) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        switch (req.method) {
            case 'GET':
                return handleGetQuestions(req, res, db);
            case 'PUT':
                return handleUpdateQuestion(req, res, db);
            case 'DELETE':
                return handleDeleteQuestion(req, res, db);
            case 'POST':
                return handleBulkAction(req, res, db);
            default:
                return res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (e: unknown) {
        console.error("Admin reading questions error:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleGetQuestions(req: VercelRequest, res: VercelResponse, db: any) {
    const filterReviewed = req.query.reviewed; // 'all', '0', '1'
    const textId = req.query.text_id ? parseInt(req.query.text_id as string) : null;

    // Get all texts
    const { data: texts, error: textsError } = await db
        .from('reading_texts')
        .select('*')
        .order('id');

    if (textsError) throw textsError;

    // Get stats for texts (aggregate query workaround)
    // We fetch all questions (lightweight props) to count them, or use a separate stats query if volume is high.
    // Given the admin nature, fetching all questions ID/text_id/reviewed is likely fine.
    const { data: questionStats, error: statsError } = await db
        .from('reading_questions')
        .select('id, text_id, reviewed');

    if (statsError) throw statsError;

    const statsMap = new Map<number, { total: number, approved: number, pending: number }>();
    for (const q of questionStats || []) {
        const tid = q.text_id;
        const entry = statsMap.get(tid) || { total: 0, approved: 0, pending: 0 };
        entry.total++;
        if (q.reviewed) entry.approved++;
        else entry.pending++;
        statsMap.set(tid, entry);
    }

    const enrichedTexts = texts.map((t: any) => {
        const s = statsMap.get(t.id) || { total: 0, approved: 0, pending: 0 };
        return {
            id: t.id,
            title: t.title,
            autor: t.autor,
            zyklus: t.zyklus,
            minAge: t.min_age,
            wordCount: t.word_count,
            totalQuestions: s.total,
            approvedQuestions: s.approved,
            pendingQuestions: s.pending,
        };
    });

    // Get questions filtered
    let query = db.from('reading_questions').select('*, reading_texts(title)');

    if (filterReviewed === '0' || filterReviewed === '1') {
        query = query.eq('reviewed', filterReviewed === '1');
    }
    if (textId) {
        query = query.eq('text_id', textId);
    }

    query = query.order('text_id').order('paragraph_index').order('tier').order('id');

    const { data: questions, error: questionsError } = await query;
    if (questionsError) throw questionsError;

    return res.status(200).json({
        texts: enrichedTexts,
        questions: questions.map((q: any) => ({
            id: q.id,
            textId: q.text_id,
            textTitle: q.reading_texts?.title, // Join result
            tier: q.tier,
            questionType: q.question_type,
            question: q.question,
            options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
            correctAnswer: q.correct_answer,
            explanation: q.explanation,
            paragraphIndex: q.paragraph_index,
            aiGenerated: Boolean(q.ai_generated),
            reviewed: Boolean(q.reviewed),
            createdAt: q.created_at,
        })),
    });
}

async function handleUpdateQuestion(req: VercelRequest, res: VercelResponse, db: any) {
    const { id, question, options, correctAnswer, explanation, reviewed, tier, questionType } = req.body;

    if (!id) return res.status(400).json({ error: 'Missing id' });

    const updates: any = { updated_at: new Date().toISOString() };
    if (question !== undefined) updates.question = question;
    if (options !== undefined) updates.options = JSON.stringify(options);
    if (correctAnswer !== undefined) updates.correct_answer = correctAnswer;
    if (explanation !== undefined) updates.explanation = explanation;
    if (reviewed !== undefined) updates.reviewed = reviewed;
    if (tier !== undefined) updates.tier = tier;
    if (questionType !== undefined) updates.question_type = questionType;

    const { error } = await db.from('reading_questions').update(updates).eq('id', id);
    if (error) throw error;

    return res.status(200).json({ success: true });
}

async function handleDeleteQuestion(req: VercelRequest, res: VercelResponse, db: any) {
    const id = req.query.id ? parseInt(req.query.id as string) : req.body?.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { error } = await db.from('reading_questions').delete().eq('id', id);
    if (error) throw error;

    return res.status(200).json({ success: true });
}

async function handleBulkAction(req: VercelRequest, res: VercelResponse, db: any) {
    const { action, textId, questionIds } = req.body;

    // Helper to get query builder
    const getQuery = () => db.from('reading_questions');

    try {
        if (action === 'approve-all') {
            let query = getQuery().update({ reviewed: true, updated_at: new Date().toISOString() });

            if (textId) {
                query = query.eq('text_id', textId).eq('reviewed', false);
            } else if (questionIds && questionIds.length > 0) {
                query = query.in('id', questionIds);
            } else {
                return res.status(400).json({ error: 'Missing filter for approve-all' });
            }

            const { error, count } = await query.select('id', { count: 'exact' });
            if (error) throw error;
            return res.status(200).json({ success: true, affected: count || 'unknown' });
        }
        else if (action === 'reject-all') {
            let query = getQuery().delete();

            if (textId) {
                query = query.eq('text_id', textId).eq('reviewed', false);
            } else if (questionIds && questionIds.length > 0) {
                query = query.in('id', questionIds);
            } else {
                return res.status(400).json({ error: 'Missing filter for reject-all' });
            }

            const { error, count } = await query.select('id', { count: 'exact' });
            if (error) throw error;
            return res.status(200).json({ success: true, affected: count || 'unknown' });
        }
        else if (action === 'generate-questions') {
            return handleGenerateQuestions(req, res, db);
        }
        else if (action === 'save-text-with-questions') {
            return handleSaveTextWithQuestions(req, res, db);
        }
        else {
            return res.status(400).json({ error: `Unknown action: ${action}` });
        }
    } catch (e: unknown) {
        throw e;
    }
}

async function handleGenerateQuestions(req: VercelRequest, res: VercelResponse, db: any) {
    const { title, text, zyklus, minAge, thema } = req.body;

    if (!title || !text) {
        return res.status(400).json({ error: 'title and text are required' });
    }

    const wordCount = text.trim().split(/\s+/).length;
    const paragraphs = text.split('\n').filter((p: string) => p.trim().length > 0);

    const systemPrompt = `You are an expert reading comprehension question creator for a Swiss/German children's learning platform.
You create questions at 3 tiers:
- Tier 1 (Grundwissen): Direct factual recall from the text
- Tier 2 (Schlussfolgerung): Inference and deduction
- Tier 3 (Analyse): Critical analysis, evaluation, author's intent

Question types:
- "multiple_choice": 4 options, exactly one correct
- "true_false": Statement is "Wahr" or "Falsch"
- "true_false_unknown": Statement is "Wahr", "Falsch", or "Steht nicht im Text"

Rules:
- Use Standard German spelling (with ß where appropriate)
- Questions must be answerable from the text alone
- Provide clear explanations referencing the text
- paragraphIndex should reference the 1-based paragraph number the question relates to (or null for whole-text questions)
- For multiple_choice, correctAnswer must exactly match one of the options
- Return ONLY valid JSON, no markdown fences`;

    const userPrompt = `TEXT TITLE: ${title}
ZYKLUS: ${zyklus || 2}
MIN AGE: ${minAge || 8}
${thema ? `THEMA: ${thema}` : ''}

TEXT (${paragraphs.length} paragraphs, ${wordCount} words):
${paragraphs.map((p: string, i: number) => `[Paragraph ${i + 1}] ${p}`).join('\n\n')}

TASK: Generate 8-12 comprehension questions spread across all 3 tiers and question types.
Aim for: ~4 Tier 1, ~4 Tier 2, ~3 Tier 3.
Mix question types: use multiple_choice, true_false, and true_false_unknown.
Distribute paragraphIndex across the text paragraphs.

Return a JSON array where each element has:
{
  "tier": 1|2|3,
  "questionType": "multiple_choice"|"true_false"|"true_false_unknown",
  "question": "...",
  "options": ["A", "B", "C", "D"] | null,
  "correctAnswer": "...",
  "explanation": "...",
  "paragraphIndex": number|null
}`;

    try {
        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: systemPrompt,
            prompt: userPrompt
        });

        const cleaned = aiRes.text.replace(/```json\n?|```/g, '').trim();
        const questions = JSON.parse(cleaned);

        if (!Array.isArray(questions)) {
            return res.status(500).json({ error: 'AI returned invalid format (not an array)' });
        }

        return res.status(200).json({
            generatedQuestions: questions,
            textMeta: {
                title,
                wordCount,
                paragraphCount: paragraphs.length,
                zyklus: zyklus || 2,
                minAge: minAge || 8,
            }
        });
    } catch (e: unknown) {
        console.error('[GENERATE-QUESTIONS] Error:', e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'AI generation failed' });
    }
}

async function handleSaveTextWithQuestions(req: VercelRequest, res: VercelResponse, db: any) {
    const { text: textData, questions } = req.body;

    if (!textData || !textData.title || !textData.text) {
        return res.status(400).json({ error: 'text.title and text.text are required' });
    }
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'At least one question is required' });
    }

    const wordCount = textData.text.trim().split(/\s+/).length;

    try {
        // 1. Insert the text
        const { data: insertedText, error: textError } = await db
            .from('reading_texts')
            .insert({
                title: textData.title,
                text: textData.text,
                zyklus: textData.zyklus || 2,
                min_age: textData.minAge || 8,
                thema: textData.thema || null,
                source_url: textData.sourceUrl || null,
                autor: textData.autor || null,
                word_count: wordCount,
            })
            .select('id')
            .single();

        if (textError) throw textError;

        const textId = insertedText.id;

        // 2. Insert questions
        const questionRows = questions.map((q: any) => ({
            text_id: textId,
            tier: q.tier,
            question_type: q.questionType,
            question: q.question,
            options: q.options ? JSON.stringify(q.options) : null,
            correct_answer: q.correctAnswer,
            explanation: q.explanation || null,
            paragraph_index: q.paragraphIndex || null,
            ai_generated: true,
            reviewed: false,
        }));

        const { error: qError } = await db
            .from('reading_questions')
            .insert(questionRows);

        if (qError) throw qError;

        return res.status(200).json({
            success: true,
            textId,
            insertedQuestionCount: questionRows.length,
        });
    } catch (e: unknown) {
        console.error('[SAVE-TEXT-WITH-QUESTIONS] Error:', e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Save failed' });
    }
}
