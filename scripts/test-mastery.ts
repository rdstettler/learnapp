
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

async function testMastery() {
    const userId = 'local-test-user';

    console.log('--- Cleaning up test data ---');
    await db.execute({ sql: "DELETE FROM user_curriculum_progress WHERE user_uid = ?", args: [userId] });

    console.log('--- Simulating correct answer for Node 279 ---');
    // Simulate API call to /api/events (question_progress)
    // We'll call the logic directly or simulate DB insert as if API did it

    // 1. Initial Insert (API would do this)
    await db.execute({
        sql: `INSERT INTO user_curriculum_progress (user_uid, curriculum_node_id, status, mastery_level, last_activity)
              VALUES (?, ?, 'started', ?, CURRENT_TIMESTAMP)`,
        args: [userId, 279, 5]
    });

    let res = await db.execute({
        sql: "SELECT * FROM user_curriculum_progress WHERE user_uid = ? AND curriculum_node_id = ?",
        args: [userId, 279]
    });
    console.log('After 1st correct:', res.rows[0]);

    // 2. Another correct (+5)
    await db.execute({
        sql: `UPDATE user_curriculum_progress SET mastery_level = mastery_level + 5 WHERE user_uid = ? AND curriculum_node_id = ?`,
        args: [userId, 279]
    });

    res = await db.execute({
        sql: "SELECT * FROM user_curriculum_progress WHERE user_uid = ? AND curriculum_node_id = ?",
        args: [userId, 279]
    });
    console.log('After 2nd correct:', res.rows[0]);

    // 3. Completion
    await db.execute({
        sql: `UPDATE user_curriculum_progress SET mastery_level = 100, status = 'completed' WHERE user_uid = ? AND curriculum_node_id = ?`,
        args: [userId, 279]
    });

    res = await db.execute({
        sql: "SELECT * FROM user_curriculum_progress WHERE user_uid = ? AND curriculum_node_id = ?",
        args: [userId, 279]
    });
    console.log('After completion:', res.rows[0]);

    console.log('Verified DB logic. Frontend should reflect this.');
}

testMastery().catch(console.error);
