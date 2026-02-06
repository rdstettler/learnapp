
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { user_uid, app_id, session_id, content, comment, error_type } = req.body;

    if (!app_id || !comment) {
        return res.status(400).json({ error: "Missing required fields (app_id, comment)" });
    }

    const db = getTursoClient();

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
