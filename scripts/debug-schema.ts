
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

async function debug() {
    console.log('--- app_results ---');
    const t1 = await db.execute("PRAGMA table_info(app_results)");
    console.log(JSON.stringify(t1.rows, null, 2));

    console.log('--- user_daily_activity ---');
    const t3 = await db.execute("PRAGMA table_info(user_daily_activity)");
    console.log(JSON.stringify(t3.rows, null, 2));
}

debug();
