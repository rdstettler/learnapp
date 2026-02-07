
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../_lib/turso.js';

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

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const user_uid = req.headers['x-user-uid'];
    if (!user_uid) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { app_id, content, category, level } = req.body;

    if (!app_id || !content) {
        return res.status(400).json({ error: 'Missing required fields (app_id, content)' });
    }

    const db = getTursoClient();

    try {
        // 1. Check Admin Status
        const user = await db.execute({
            sql: "SELECT is_admin FROM users WHERE uid = ?",
            args: [user_uid as string]
        });

        if (user.rows.length === 0 || !user.rows[0].is_admin) {
            return res.status(403).json({ error: "Forbidden: Admins only" });
        }

        // 2. Insert Content
        await db.execute({
            sql: `INSERT INTO app_content (app_id, data, level, ai_generated, human_verified)
                  VALUES (?, ?, ?, 0, 1)`,
            args: [
                app_id,
                JSON.stringify(content),
                level || null
            ]
        });

        return res.status(200).json({ success: true, message: 'Content added successfully' });

    } catch (e: any) {
        console.error("Error adding app content:", e);
        return res.status(500).json({ error: e.message });
    }
}
