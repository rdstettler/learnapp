
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

async function migrate() {
    console.log('Creating user_curriculum_progress table...');

    await db.execute(`
        CREATE TABLE IF NOT EXISTS user_curriculum_progress (
            user_uid TEXT NOT NULL,
            curriculum_node_id INTEGER NOT NULL,
            status TEXT DEFAULT 'started', -- 'started', 'completed'
            mastery_level INTEGER DEFAULT 0, -- 0-100
            last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_uid, curriculum_node_id)
        )
    `);

    console.log('Done.');
}

migrate().catch(console.error);
