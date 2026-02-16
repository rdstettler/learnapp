import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();
const db = getTursoClient();

async function main() {
    const result = await db.execute('UPDATE reading_questions SET reviewed = 1 WHERE ai_generated = 1');
    console.log('Approved questions:', result.rowsAffected);

    const summary = await db.execute('SELECT text_id, tier, question_type, question FROM reading_questions ORDER BY text_id, tier LIMIT 10');
    for (const r of summary.rows) {
        console.log(`  [Text ${r.text_id}] T${r.tier} (${r.question_type}): ${(r.question as string).substring(0, 60)}...`);
    }
}
main().catch(console.error);
