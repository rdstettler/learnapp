
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

async function seed() {
    console.log('Seeding test config...');

    // Check node 279
    const nodeRes = await db.execute('SELECT * FROM curriculum_nodes WHERE id = 279');
    if (nodeRes.rows.length === 0) {
        console.error('Node 279 not found! Please check DB.');
        return;
    }
    console.log('Node 279:', nodeRes.rows[0]);

    // Insert config
    const config = {
        addMax: 20,
        divMax: 50,
        divDivisorMax: 10,
        operations: ['add', 'sub']
    };

    await db.execute({
        sql: `INSERT OR REPLACE INTO app_config (app_id, curriculum_node_id, config_json) VALUES (?, ?, ?)`,
        args: ['kopfrechnen', 279, JSON.stringify(config)]
    });

    console.log('Config inserted for kopfrechnen @ node 279');
}

seed().catch(console.error);
