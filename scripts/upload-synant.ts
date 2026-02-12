import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_ID = 'synant';

async function main() {
    const db = getTursoClient();

    const filePath = path.resolve(__dirname, '../assets/synant.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const items: {
        firstGroup: { strong: string[]; weak: string[] };
        secondGroup: { strong: string[]; weak: string[] };
    }[] = JSON.parse(raw);

    console.log(`Found ${items.length} items to upload for app_id="${APP_ID}"`);

    // Ensure the app entry exists
    await db.execute({
        sql: `INSERT OR IGNORE INTO apps (id, name, description, category, route, icon, type, tags)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
            APP_ID,
            'Antonyme & Synonyme',
            'Finde den Spion! Erkenne die Antonyme unter den Synonymen',
            'Deutsch',
            '/synant',
            '🕵️',
            'learning',
            JSON.stringify(['deutsch', 'wortschatz', 'synonyme', 'antonyme', 'spion'])
        ]
    });
    console.log(`App entry ensured for "${APP_ID}"`);

    let inserted = 0;
    for (const item of items) {
        await db.execute({
            sql: `INSERT INTO app_content (app_id, data, human_verified)
                  VALUES (?, ?, ?)`,
            args: [APP_ID, JSON.stringify(item), 1]
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
