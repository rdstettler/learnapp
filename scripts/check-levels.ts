
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

async function check() {
    const levels = await db.execute("SELECT DISTINCT level FROM curriculum_nodes");
    console.log('Unique Levels:', levels.rows.map(r => r.level));

    const deeperNodes = await db.execute("SELECT * FROM curriculum_nodes WHERE level = 'kompetenzstufe' LIMIT 5");
    console.log('Sample Kompetenzstufen:', JSON.stringify(deeperNodes.rows, null, 2));
}

check().catch(console.error);
