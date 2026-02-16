
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

async function debug() {
    const res = await db.execute("SELECT id, code, title, description FROM curriculum_nodes WHERE code LIKE 'MA.1.A.3.a%' LIMIT 1");
    console.log(JSON.stringify(res.rows, null, 2));
}

debug();
