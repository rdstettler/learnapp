import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();
const db = getTursoClient();

async function main() {
    try {
        await db.execute('ALTER TABLE reading_texts ADD COLUMN autor TEXT');
        console.log('✅ Added autor column');
    } catch (e: any) {
        console.log('Column may already exist:', e.message);
    }
}
main();
