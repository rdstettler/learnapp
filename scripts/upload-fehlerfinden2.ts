import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_ID = 'fehlerfinden2';

async function main() {
    const db = getTursoClient();

    // Read the JSON file
    const filePath = path.resolve(__dirname, '../assets/fehlerfinden2.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const items: { correct: string; wrong: string[] }[] = JSON.parse(raw);

    console.log(`Found ${items.length} items to upload for app_id="${APP_ID}"`);

    // Ensure the app entry exists in the apps table
    await db.execute({
        sql: `INSERT OR IGNORE INTO apps (id, name, description, category, route, icon, type, tags)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            APP_ID,
            'Fehler finden – Sätze',
            'Finde den richtigen Satz unter vier Varianten',
            'Deutsch',
            '/fehler',          // same route — the component handles both
            '🔍',
            'learning',
            JSON.stringify(['deutsch', 'grammatik', 'rechtschreibung', 'sätze'])
        ]
    });
    console.log(`App entry ensured for "${APP_ID}"`);

    // Upload each item individually
    let inserted = 0;
    for (const item of items) {
        await db.execute({
            sql: `INSERT INTO app_content (app_id, data, human_verified)
                  VALUES (?, ?, 1)`,
            args: [APP_ID, JSON.stringify(item)]
        });
        inserted++;
        if (inserted % 10 === 0) {
            console.log(`  ... inserted ${inserted}/${items.length}`);
        }
    }

    console.log(`Done! Inserted ${inserted} rows into app_content for "${APP_ID}".`);
}

main().catch(err => {
    console.error('Upload failed:', err);
    process.exit(1);
});
