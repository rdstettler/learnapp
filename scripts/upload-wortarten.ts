import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_ID = 'wortarten';

async function main() {
    const db = getTursoClient();

    const filePath = path.resolve(__dirname, '../assets/wortarten.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const items: { skill_level: number; text: string }[] = JSON.parse(raw);

    console.log(`Found ${items.length} items to upload for app_id="${APP_ID}"`);

    // Ensure the app entry exists
    await db.execute({
        sql: `INSERT OR IGNORE INTO apps (id, name, description, category, route, icon, type, tags)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            APP_ID,
            'Wortarten',
            'Finde alle Nomen, Verben und Adjektive im Text',
            'Deutsch',
            '/wortarten',
            '🏷️',
            'learning',
            JSON.stringify(['deutsch', 'grammatik', 'wortarten', 'nomen', 'verben', 'adjektive'])
        ]
    });
    console.log(`App entry ensured for "${APP_ID}"`);

    let inserted = 0;
    for (const item of items) {
        const level = item.skill_level;
        if (typeof level !== 'number' || !isFinite(level)) {
            console.warn(`Skipping item with invalid level: ${level}`);
            continue;
        }
        await db.execute({
            sql: `INSERT INTO app_content (app_id, data, skill_level, human_verified)
                  VALUES (?, ?, ?, ?)`,
            args: [APP_ID, JSON.stringify(item.text), level, 1]
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
