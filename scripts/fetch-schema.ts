
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables from correct path
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const db = getTursoClient();

async function fetchSchema() {
    try {
        const result = await db.execute("SELECT name, sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_litestream_seq' AND name != '_litestream_lock' AND name != 'libsql_wasm_func_table'");

        fs.writeFileSync('schema.json', JSON.stringify(result.rows, null, 2), 'utf8');
        console.log('Schema written to schema.json');
    } catch (e) {
        console.error(e);
    }
}

fetchSchema();
