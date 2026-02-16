
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

async function migrate() {
    console.log('Creating app_config table...');
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS app_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id TEXT NOT NULL,
                curriculum_node_id INTEGER NOT NULL,
                config_json TEXT NOT NULL,
                difficulty_score REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (app_id) REFERENCES apps(id),
                FOREIGN KEY (curriculum_node_id) REFERENCES curriculum_nodes(id)
            )
        `);
        console.log('✅ app_config table created/verified');
    } catch (e: any) {
        console.error('❌ Error creating table:', e.message);
    }
}

migrate();
