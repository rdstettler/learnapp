
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();

    if (req.method === 'GET') {
        const { user_uid } = req.query;
        if (!user_uid || typeof user_uid !== 'string') {
            return res.status(400).json({ error: 'Missing user_uid' });
        }

        try {
            const result = await db.execute({
                sql: "SELECT app_id FROM user_apps WHERE user_uid = ? AND is_favorite = 1",
                args: [user_uid]
            });
            const favoriteIds = result.rows.map(r => r.app_id);
            return res.status(200).json({ favorites: favoriteIds });
        } catch (e: any) {
            return res.status(500).json({ error: e.message });
        }
    }
    else if (req.method === 'POST') {
        const { user_uid, app_id, is_favorite } = req.body;

        if (!user_uid || !app_id || is_favorite === undefined) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        try {
            await db.execute({
                sql: `INSERT INTO user_apps (user_uid, app_id, is_favorite, created_at)
                      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                      ON CONFLICT(user_uid, app_id) DO UPDATE SET
                      is_favorite = excluded.is_favorite`,
                args: [user_uid, app_id, is_favorite ? 1 : 0]
            });
            return res.status(200).json({ success: true });
        } catch (e: any) {
            return res.status(500).json({ error: e.message });
        }
    }
    else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
}
