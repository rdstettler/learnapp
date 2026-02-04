import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const db = getTursoClient();

    try {
        const { appId, uid, sessionId, content } = req.body;

        if (!appId || !uid || !sessionId || !content) {
            return res.status(400).json({
                error: 'appId, uid, sessionId, and content are required'
            });
        }

        const result = await db.execute({
            sql: `
                INSERT INTO app_results (app_id, user_uid, session_id, content)
                VALUES (?, ?, ?, ?)
            `,
            args: [
                appId,
                uid,
                sessionId,
                content
            ]
        });

        return res.status(200).json({
            success: true,
            id: Number(result.lastInsertRowid)
        });

    } catch (error: any) {
        console.error('App Results POST error:', error);
        return res.status(500).json({ error: error.message });
    }
}
