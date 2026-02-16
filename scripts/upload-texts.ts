/**
 * Upload texts from assets/geschichten/ into the reading_texts table.
 * 
 * Expected YAML-like format:
 *   Source:
 *       https://...
 *   Age:
 *       7+
 *   Title:
 *       Story Title
 *   Thema:                   (optional)
 *       Tiere
 *   Text:
 *       Paragraph 1...
 *       Paragraph 2...
 */
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const db = getTursoClient();

interface ParsedText {
    source: string;
    autor: string | null;
    age: number;
    title: string;
    thema: string | null;
    text: string;
    wordCount: number;
    zyklus: number;
}

function parseTextFile(filePath: string): ParsedText {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/);

    let source = '';
    let autor: string | null = null;
    let age = 4;
    let title = '';
    let thema: string | null = null;
    let textLines: string[] = [];
    let currentField: 'source' | 'autor' | 'age' | 'title' | 'thema' | 'text' | null = null;

    for (const line of lines) {
        const trimmed = line.trim();

        // Detect field headers
        if (/^Source:\s*$/i.test(trimmed) || /^Source:\s*$/i.test(line.trim())) {
            currentField = 'source';
            continue;
        }
        if (/^Autor:\s*$/i.test(trimmed) || /^Autor:$/i.test(trimmed)) {
            currentField = 'autor';
            continue;
        }
        if (/^Age:\s*$/i.test(trimmed) || /^Age:$/i.test(trimmed)) {
            currentField = 'age';
            continue;
        }
        if (/^Title:\s*$/i.test(trimmed) || /^Title:$/i.test(trimmed)) {
            currentField = 'title';
            continue;
        }
        if (/^Thema:\s*$/i.test(trimmed) || /^Thema:$/i.test(trimmed)) {
            currentField = 'thema';
            continue;
        }
        if (/^Text:\s*$/i.test(trimmed) || /^Text:$/i.test(trimmed)) {
            currentField = 'text';
            continue;
        }

        // Read indented content
        if (currentField && trimmed) {
            switch (currentField) {
                case 'source':
                    source = trimmed;
                    break;
                case 'autor':
                    autor = trimmed;
                    break;
                case 'age':
                    age = parseInt(trimmed.replace('+', ''));
                    break;
                case 'title':
                    title = trimmed;
                    break;
                case 'thema':
                    thema = trimmed;
                    break;
                case 'text':
                    // Skip image description lines (end with &nbsp; or contain only visual descriptions)
                    if (trimmed.endsWith('&nbsp;') || trimmed.endsWith('\u00a0')) {
                        continue;
                    }
                    textLines.push(trimmed);
                    break;
            }
        }
    }

    const text = textLines.join('\n');
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    // Map age to Zyklus
    let zyklus = 1;
    if (age >= 9) zyklus = 3;
    else if (age >= 7) zyklus = 2;

    return { source, autor, age, title, thema, text, wordCount, zyklus };
}

async function uploadTexts() {
    const geschichtenDir = path.join(__dirname, '..', 'assets', 'geschichten');

    if (!fs.existsSync(geschichtenDir)) {
        console.error(`Directory not found: ${geschichtenDir}`);
        return;
    }

    const files = fs.readdirSync(geschichtenDir).filter(f => f.endsWith('.txt') || f.endsWith('.txxt'));
    console.log(`Found ${files.length} text files`);

    let uploaded = 0;
    let skipped = 0;

    for (const file of files) {
        const filePath = path.join(geschichtenDir, file);
        try {
            const parsed = parseTextFile(filePath);

            if (!parsed.title || !parsed.text) {
                console.log(`  ⚠ Skipping ${file} — missing title or text`);
                skipped++;
                continue;
            }

            // Check if already exists (by title)
            const existing = await db.execute({
                sql: 'SELECT id FROM reading_texts WHERE title = ?',
                args: [parsed.title]
            });

            if (existing.rows.length > 0) {
                console.log(`  ⏭ "${parsed.title}" already exists (id=${existing.rows[0].id})`);
                skipped++;
                continue;
            }

            await db.execute({
                sql: `INSERT INTO reading_texts (title, text, source_url, autor, thema, min_age, zyklus, word_count) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [parsed.title, parsed.text, parsed.source, parsed.autor, parsed.thema, parsed.age, parsed.zyklus, parsed.wordCount]
            });

            console.log(`  ✅ "${parsed.title}" — ${parsed.wordCount} words, Age ${parsed.age}+, Zyklus ${parsed.zyklus}`);
            uploaded++;
        } catch (err) {
            console.error(`  ❌ Error processing ${file}:`, err);
        }
    }

    console.log(`\nDone: ${uploaded} uploaded, ${skipped} skipped`);

    // Show all texts in DB
    const all = await db.execute('SELECT id, title, word_count, min_age, zyklus FROM reading_texts ORDER BY id');
    console.log(`\nTexts in database:`);
    for (const r of all.rows) {
        console.log(`  [${r.id}] ${r.title} — ${r.word_count} words, Age ${r.min_age}+, Z${r.zyklus}`);
    }
}

uploadTexts().catch(console.error);
