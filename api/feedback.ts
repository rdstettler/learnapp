
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-User-Uid');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const db = getTursoClient();

    // --- Admin / Review Logic (GET & POST with action='resolve') ---

    // Check for Admin Review Request (GET)
    if (req.method === 'GET') {
        return handleAdminReviewList(req, res, db);
    }

    // Check for Admin Resolve Request (POST with action='resolve')
    if (req.method === 'POST' && req.body.action === 'resolve') {
        return handleAdminResolve(req, res, db);
    }

    // --- Standard Feedback Submission (POST) ---

    if (req.method === 'POST') {
        return handleFeedbackSubmission(req, res, db);
    }

    return res.status(405).json({ error: "Method not allowed" });
}

async function handleFeedbackSubmission(req: VercelRequest, res: VercelResponse, db: any) {
    const { user_uid, app_id, session_id, content, comment, error_type } = req.body;

    if (!app_id || !comment) {
        return res.status(400).json({ error: "Missing required fields (app_id, comment)" });
    }

    try {
        await db.execute({
            sql: `INSERT INTO feedback (user_uid, app_id, session_id, content, comment, error_type, target_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [
                user_uid || null,
                app_id,
                session_id || null,
                typeof content === 'object' ? JSON.stringify(content) : (content || null),
                comment,
                error_type || 'general',
                req.body.target_id || null
            ]
        });

        return res.status(200).json({ success: true, message: "Feedback submitted successfully" });
    } catch (e: any) {
        console.error("Error submitting feedback:", e);
        return res.status(500).json({ error: e.message });
    }
}

async function handleAdminReviewList(req: VercelRequest, res: VercelResponse, db: any) {
    const user_uid = req.headers['x-user-uid'] || req.query.user_uid;

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

        // 2. List Pending Feedback
        const feedback = await db.execute(`
            SELECT * FROM feedback 
            WHERE (resolved = 0 OR resolved IS NULL) AND error_type = 'ai_review_flag'
            ORDER BY created_at DESC
        `);
        return res.status(200).json(feedback.rows);

    } catch (e: any) {
        return res.status(500).json({ error: "Auth check or DB error" });
    }
}

async function handleAdminResolve(req: VercelRequest, res: VercelResponse, db: any) {
    const user_uid = req.headers['x-user-uid'] || req.body.user_uid;

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

        // 3. POST: Approve Correction
        const { feedback_id, target_id, new_content, resolution_reason } = req.body;

        if (!feedback_id || !target_id || !new_content) {
            return res.status(400).json({ error: "Missing required fields" });
        }

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
