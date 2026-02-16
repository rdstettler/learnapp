/**
 * Lehrplan 21 Curriculum Scraper
 *
 * Scrapes the zh.lehrplan.ch website to extract the full curriculum hierarchy
 * for Deutsch and Mathematik, then inserts it into the curriculum_nodes table.
 *
 * Hierarchy:
 *   Fachbereich → Kompetenzbereich → Handlungsaspekt → Kompetenz → Kompetenzstufe
 *
 * Usage: npx tsx scripts/scrape-lehrplan.ts
 */

import { getTursoClient } from '../api/_lib/turso.js';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'https://zh.lehrplan.ch/index.php';
const DELAY_MS = 600; // Be polite to the server
const CHECKPOINT_FILE = path.resolve(__dirname, '../assets/lehrplan-checkpoint.json');

// ═══ TYPES ═══

interface CurriculumNode {
    code: string;
    fachbereich: string;
    level: 'fachbereich' | 'kompetenzbereich' | 'handlungsaspekt' | 'kompetenz' | 'kompetenzstufe';
    parent_code: string | null;
    zyklus: number | null;
    title: string;
    description: string | null;
    lp21_url: string | null;
}

interface Checkpoint {
    completedFachbereiche: string[];
    completedKompetenzen: string[];
    nodes: CurriculumNode[];
}

// ═══ CONFIG ═══

// Fachbereiche to scrape
const FACHBEREICHE = [
    {
        id: 'deutsch',
        prefix: 'D',
        overviewCode: 'b|1|11',
        kompetenzbereichCodes: [
            { nr: 1, name: 'Hören', code: 'a|1|11|1' },
            { nr: 2, name: 'Lesen', code: 'a|1|11|2' },
            { nr: 3, name: 'Sprechen', code: 'a|1|11|3' },
            { nr: 4, name: 'Schreiben', code: 'a|1|11|4' },
            { nr: 5, name: 'Sprache(n) im Fokus', code: 'a|1|11|5' },
            { nr: 6, name: 'Literatur im Fokus', code: 'a|1|11|6' },
        ]
    },
    {
        id: 'mathematik',
        prefix: 'MA',
        overviewCode: 'b|5|0',
        kompetenzbereichCodes: [
            { nr: 1, name: 'Zahl und Variable', code: 'a|5|0|1' },
            { nr: 2, name: 'Form und Raum', code: 'a|5|0|2' },
            { nr: 3, name: 'Grössen, Funktionen, Daten und Zufall', code: 'a|5|0|3' },
        ]
    }
];

// Handlungsaspekt letters → names (per fachbereich)
const HANDLUNGSASPEKTE_MATH: Record<string, string> = {
    'A': 'Operieren und Benennen',
    'B': 'Erforschen und Argumentieren',
    'C': 'Mathematisieren und Darstellen',
};

// ═══ HELPERS ═══

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(code: string): Promise<string> {
    const url = `${BASE_URL}?code=${code}&la=yes`;
    console.log(`  Fetching: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    await sleep(DELAY_MS);
    return await res.text();
}

function loadCheckpoint(): Checkpoint {
    if (fs.existsSync(CHECKPOINT_FILE)) {
        return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    }
    return { completedFachbereiche: [], completedKompetenzen: [], nodes: [] };
}

function saveCheckpoint(cp: Checkpoint): void {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ═══ PARSING ═══

/**
 * Parse a Kompetenzbereich overview page to extract Handlungsaspekte and Kompetenzen.
 *
 * The page structure has sections like:
 *   ### A|Operieren und Benennen
 *   1. Die Schülerinnen und Schüler können...  (link to detail page)
 *   2. Die Schülerinnen und Schüler können...
 */
function parseKompetenzbereichPage(html: string, fachbereich: string, prefix: string, kbNr: number): {
    handlungsaspekte: { letter: string; name: string }[];
    kompetenzen: { letter: string; nr: number; description: string; detailCode: string }[];
} {
    const $ = cheerio.load(html);
    const handlungsaspekte: { letter: string; name: string }[] = [];
    const kompetenzen: { letter: string; nr: number; description: string; detailCode: string }[] = [];

    // Find all h3 elements that represent Handlungsaspekte
    $('h3').each((_, el) => {
        const text = $(el).text().trim();
        // Match pattern like "A|Operieren und Benennen" or "A|Grundfertigkeiten"
        const match = text.match(/^([A-G])\|(.+)$/);
        if (!match) return;

        const letter = match[1];
        const name = match[2].trim();
        handlungsaspekte.push({ letter, name });

        // Find all numbered competency links after this heading
        let sibling = $(el).next();
        while (sibling.length && sibling.prop('tagName') !== 'H3' && sibling.prop('tagName') !== 'H2' && sibling.prop('tagName') !== 'H1') {
            // Look for links that point to competency detail pages
            sibling.find('a').each((_, linkEl) => {
                const href = $(linkEl).attr('href') || '';
                const linkText = $(linkEl).text().trim();

                // Extract the code from the link
                const codeMatch = href.match(/code=([^&]+)/);
                if (codeMatch) {
                    const detailCode = codeMatch[1];
                    // Extract the competency number from the link text
                    const nrMatch = linkText.match(/^(\d+)\.\s+(.+)$/);
                    if (nrMatch) {
                        kompetenzen.push({
                            letter,
                            nr: parseInt(nrMatch[1]),
                            description: nrMatch[2].trim(),
                            detailCode
                        });
                    }
                }
            });
            sibling = sibling.next();
        }
    });

    // If no H3 headings found (some pages use different structure), try parsing links directly
    if (handlungsaspekte.length === 0) {
        // Try to parse from the main content area
        const mainContent = $('.content, .main, #content, body').first();
        mainContent.find('a').each((_, linkEl) => {
            const href = $(linkEl).attr('href') || '';
            const linkText = $(linkEl).text().trim();
            const codeMatch = href.match(/code=([^&]+)/);
            if (codeMatch && linkText.match(/^\d+\.\s+/)) {
                const detailCode = codeMatch[1];
                const nrMatch = linkText.match(/^(\d+)\.\s+(.+)$/);
                if (nrMatch) {
                    // Try to infer the Handlungsaspekt from the code
                    const codeParts = detailCode.split('|');
                    const haIndex = parseInt(codeParts[codeParts.length - 2]) || 1;
                    const haLetters = 'ABCDEFG';
                    const letter = haLetters[haIndex - 1] || 'A';
                    kompetenzen.push({
                        letter,
                        nr: parseInt(nrMatch[1]),
                        description: nrMatch[2].trim(),
                        detailCode
                    });
                }
            }
        });

        // Deduce Handlungsaspekte from kompetenzen
        const uniqueLetters = new Set(kompetenzen.map(k => k.letter));
        for (const letter of uniqueLetters) {
            const name = HANDLUNGSASPEKTE_MATH[letter] || `Aspekt ${letter}`;
            handlungsaspekte.push({ letter, name });
        }
    }

    return { handlungsaspekte, kompetenzen };
}

/**
 * Parse a Kompetenz detail page to extract Kompetenzstufen.
 *
 * Structure:
 *   MA.1.A.3
 *   Die Schülerinnen und Schüler ...
 *   1          ← Zyklus 1
 *   a
 *   - können im Zahlenraum bis 20 verdoppeln...
 *   b
 *   - können bis 100 addieren...
 *   2          ← Zyklus 2
 *   d
 *   - können schriftlich addieren...
 */
function parseKompetenzDetailPage(html: string): {
    stufen: { letter: string; zyklus: number; descriptions: string[] }[];
    kompetenzTitle: string;
} {
    const $ = cheerio.load(html);
    const stufen: { letter: string; zyklus: number; descriptions: string[] }[] = [];
    let kompetenzTitle = '';

    // Get the main content text
    // The detail page has a structured format — let's parse the text content
    const bodyText = $('body').text();

    // Try to extract the competency reference code + title
    const codeMatch = bodyText.match(/((?:MA|D)\.\d+\.[A-G]\.\d+)/);
    if (codeMatch) {
        // Find the description after the code
        const afterCode = bodyText.substring(bodyText.indexOf(codeMatch[0]) + codeMatch[0].length);
        const titleMatch = afterCode.match(/\s*Die Schülerinnen und Schüler ([^.]+\.)/);
        if (titleMatch) {
            kompetenzTitle = 'Die Schülerinnen und Schüler ' + titleMatch[1];
        }
    }

    // Parse the structured content from the page
    // The page contains content sections with Zyklus markers (1, 2, 3) and lettered steps (a-j)
    // We need to use the actual DOM structure

    // Many LP21 pages use a specific table/div structure
    // Let's try parsing the content container
    const contentContainer = $('.inhalt, .kompetenz-beschreibung, .content-text').first();
    let textToParse = contentContainer.length ? contentContainer.text() : $('body').text();

    // Simplified parsing: look for the pattern of Zyklus numbers followed by lettered items
    let currentZyklus = 1;
    const lines = textToParse.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let currentLetter = '';
    let currentDescriptions: string[] = [];

    for (const line of lines) {
        // Detect Zyklus marker (standalone 1, 2, or 3)
        if (/^[123]$/.test(line)) {
            // Save previous stufe if exists
            if (currentLetter && currentDescriptions.length > 0) {
                stufen.push({ letter: currentLetter, zyklus: currentZyklus, descriptions: [...currentDescriptions] });
            }
            currentZyklus = parseInt(line);
            currentLetter = '';
            currentDescriptions = [];
            continue;
        }

        // Detect stufe letter (standalone a-j)
        if (/^[a-j]$/.test(line)) {
            // Save previous stufe
            if (currentLetter && currentDescriptions.length > 0) {
                stufen.push({ letter: currentLetter, zyklus: currentZyklus, descriptions: [...currentDescriptions] });
            }
            currentLetter = line;
            currentDescriptions = [];
            continue;
        }

        // Collect bullet points for current stufe
        if (currentLetter && line.startsWith('können')) {
            currentDescriptions.push(line);
        } else if (currentLetter && line.startsWith('kennen')) {
            currentDescriptions.push(line);
        } else if (currentLetter && /^(Erweiterung:|-)/.test(line)) {
            currentDescriptions.push(line.replace(/^-\s*/, ''));
        }
    }

    // Save last stufe
    if (currentLetter && currentDescriptions.length > 0) {
        stufen.push({ letter: currentLetter, zyklus: currentZyklus, descriptions: [...currentDescriptions] });
    }

    return { stufen, kompetenzTitle };
}


// ═══ MAIN SCRAPING LOGIC ═══

async function scrape(): Promise<void> {
    const db = getTursoClient();
    const checkpoint = loadCheckpoint();
    const allNodes: CurriculumNode[] = [...checkpoint.nodes];

    console.log('═══ Lehrplan 21 Curriculum Scraper ═══');
    console.log(`Checkpoint: ${checkpoint.nodes.length} nodes already scraped\n`);

    for (const fb of FACHBEREICHE) {
        if (checkpoint.completedFachbereiche.includes(fb.id)) {
            console.log(`⏭ Skipping ${fb.id} (already completed)`);
            continue;
        }

        console.log(`\n╔══ Fachbereich: ${fb.id.toUpperCase()} ══╗`);

        // Add the Fachbereich root node
        const fbNode: CurriculumNode = {
            code: fb.prefix,
            fachbereich: fb.id,
            level: 'fachbereich',
            parent_code: null,
            zyklus: null,
            title: fb.id === 'deutsch' ? 'Deutsch' : 'Mathematik',
            description: null,
            lp21_url: `${BASE_URL}?code=${fb.overviewCode}`
        };
        allNodes.push(fbNode);

        for (const kb of fb.kompetenzbereichCodes) {
            const kbCode = `${fb.prefix}.${kb.nr}`;
            console.log(`\n  ╠══ Kompetenzbereich ${kbCode}: ${kb.name}`);

            // Add Kompetenzbereich node
            allNodes.push({
                code: kbCode,
                fachbereich: fb.id,
                level: 'kompetenzbereich',
                parent_code: fb.prefix,
                zyklus: null,
                title: kb.name,
                description: null,
                lp21_url: `${BASE_URL}?code=${kb.code}`
            });

            // Fetch the overview page for this Kompetenzbereich
            // For Deutsch, we need to fetch each sub-aspect page
            // For Math, the overview page contains all Handlungsaspekte
            const overviewHtml = await fetchPage(fb.overviewCode);
            const parsed = parseKompetenzbereichPage(overviewHtml, fb.id, fb.prefix, kb.nr);

            // Filter to only the Handlungsaspekte for this Kompetenzbereich
            // We need to fetch the specific Kompetenzbereich page instead
            const kbHtml = await fetchPage(kb.code.startsWith('a|') ? `b|${kb.code.split('|').slice(1).join('|')}` : kb.code);

            // Re-parse from the KB-specific page
            const kbParsed = parseKompetenzbereichPage(kbHtml, fb.id, fb.prefix, kb.nr);

            // If we got results from the KB page, use those; otherwise fall back to overview
            const finalParsed = kbParsed.kompetenzen.length > 0 ? kbParsed : parsed;

            // Add Handlungsaspekte
            for (const ha of finalParsed.handlungsaspekte) {
                const haCode = `${kbCode}.${ha.letter}`;
                console.log(`    ╠══ Handlungsaspekt ${haCode}: ${ha.name}`);

                allNodes.push({
                    code: haCode,
                    fachbereich: fb.id,
                    level: 'handlungsaspekt',
                    parent_code: kbCode,
                    zyklus: null,
                    title: ha.name,
                    description: null,
                    lp21_url: null
                });
            }

            // Add Kompetenzen and fetch their detail pages for Stufen
            for (const komp of finalParsed.kompetenzen) {
                const kompCode = `${kbCode}.${komp.letter}.${komp.nr}`;
                const haCode = `${kbCode}.${komp.letter}`;

                if (checkpoint.completedKompetenzen.includes(kompCode)) {
                    console.log(`    ⏭ Skipping ${kompCode} (already completed)`);
                    continue;
                }

                console.log(`    ╠══ Kompetenz ${kompCode}: ${komp.description.substring(0, 60)}...`);

                allNodes.push({
                    code: kompCode,
                    fachbereich: fb.id,
                    level: 'kompetenz',
                    parent_code: haCode,
                    zyklus: null,
                    title: komp.description,
                    description: komp.description,
                    lp21_url: `${BASE_URL}?code=${komp.detailCode}`
                });

                // Fetch detail page for Kompetenzstufen
                try {
                    const detailHtml = await fetchPage(komp.detailCode);
                    const detail = parseKompetenzDetailPage(detailHtml);

                    for (const stufe of detail.stufen) {
                        const stufeCode = `${kompCode}.${stufe.letter}`;
                        const description = stufe.descriptions.join(' | ');

                        allNodes.push({
                            code: stufeCode,
                            fachbereich: fb.id,
                            level: 'kompetenzstufe',
                            parent_code: kompCode,
                            zyklus: stufe.zyklus,
                            title: `Stufe ${stufe.letter}`,
                            description: description || null,
                            lp21_url: `${BASE_URL}?code=${komp.detailCode}`
                        });
                    }

                    console.log(`      → ${detail.stufen.length} Kompetenzstufen extracted`);
                } catch (err) {
                    console.error(`      ✗ Error fetching detail page for ${kompCode}:`, err);
                }

                checkpoint.completedKompetenzen.push(kompCode);
                checkpoint.nodes = allNodes;
                saveCheckpoint(checkpoint);
            }
        }

        checkpoint.completedFachbereiche.push(fb.id);
        saveCheckpoint(checkpoint);
    }

    // ═══ INSERT INTO DATABASE ═══
    console.log(`\n═══ Inserting ${allNodes.length} nodes into database ═══`);

    // Deduplicate by code
    const uniqueNodes = new Map<string, CurriculumNode>();
    for (const node of allNodes) {
        uniqueNodes.set(node.code, node);
    }

    let inserted = 0;
    let skipped = 0;

    for (const node of uniqueNodes.values()) {
        try {
            await db.execute({
                sql: `INSERT OR IGNORE INTO curriculum_nodes (code, fachbereich, level, parent_code, zyklus, title, description, lp21_url)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    node.code,
                    node.fachbereich,
                    node.level,
                    node.parent_code,
                    node.zyklus,
                    node.title,
                    node.description,
                    node.lp21_url
                ]
            });
            inserted++;
        } catch (err) {
            skipped++;
            console.error(`  ✗ Error inserting ${node.code}:`, err);
        }
    }

    console.log(`\n✅ Done! Inserted: ${inserted}, Skipped/Errors: ${skipped}`);
    console.log(`Total unique nodes: ${uniqueNodes.size}`);

    // Print summary by level
    const summary = new Map<string, number>();
    for (const node of uniqueNodes.values()) {
        summary.set(node.level, (summary.get(node.level) || 0) + 1);
    }
    console.log('\nSummary by level:');
    for (const [level, count] of summary) {
        console.log(`  ${level}: ${count}`);
    }

    // Cleanup checkpoint on success
    if (fs.existsSync(CHECKPOINT_FILE)) {
        fs.unlinkSync(CHECKPOINT_FILE);
        console.log('\nCheckpoint file cleaned up.');
    }
}

scrape().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
