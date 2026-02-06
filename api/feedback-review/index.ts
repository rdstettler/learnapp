
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();
    const user_uid = req.headers['x-user-uid'] || req.query.user_uid; // Simple auth for now

    // 1. Check Admin Status
    if (!user_uid) return res.status(401).json({ error: "Unauthorized" });

    try {
        const user = await db.execute({
            sql: "SELECT is_admin FROM users WHERE uid = ?",
            args: [user_uid as string]
        });

        if (user.rows.length === 0 || !user.rows[0].is_admin) {
            return res.status(403).json({ error: "Forbidden: Admins only" });
        }
    } catch (e: any) {
        return res.status(500).json({ error: "Auth check failed" });
    }

    // 2. GET: List Pending Feedback
    if (req.method === 'GET') {
        try {
            const feedback = await db.execute(`
                SELECT * FROM feedback 
                WHERE (resolved = 0 OR resolved IS NULL) AND error_type = 'ai_review_flag'
                ORDER BY created_at DESC
            `);
            return res.status(200).json(feedback.rows);
        } catch (e: any) {
            return res.status(500).json({ error: e.message });
        }
    }

    // 3. POST: Approve Correction
    if (req.method === 'POST') {
        const { feedback_id, target_id, new_content, resolution_reason } = req.body;

        if (!feedback_id || !target_id || !new_content) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        try {
            // Identify Target Table
            let table = "";
            let id = "";

            if (target_id.startsWith("app_content:")) {
                table = "app_content";
                id = target_id.split(":")[1];
            } else {
                return res.status(400).json({ error: "Only app_content updates are supported." });
            }

            // Update Content
            const updateSql = table === 'app_content'
                ? `UPDATE ${table} SET data = ?, human_verified = 1 WHERE id = ?`
                : `UPDATE ${table} SET content = ? WHERE id = ?`;

            await db.execute({
                sql: updateSql,
                args: [JSON.stringify(new_content), id]
            });

            // Mark Feedback Resolved
            await db.execute({
                sql: "UPDATE feedback SET resolved = 1, resolution_reason = ? WHERE id = ?",
                args: [resolution_reason || null, feedback_id]
            });

            return res.status(200).json({ success: true });

        } catch (e: any) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: "Method not allowed" });
}
