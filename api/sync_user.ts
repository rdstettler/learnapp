import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient, initSchema } from './_lib/turso.js';

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

    try {
        const { uid, email, displayName, photoUrl } = req.body;

        if (!uid || !email) {
            return res.status(400).json({ error: 'uid and email are required' });
        }

        const db = getTursoClient();

        // Ensure schema exists
        await initSchema();

        // Upsert user
        await db.execute({
            sql: `
                INSERT INTO users (uid, email, display_name, photo_url) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(uid) DO UPDATE SET
                    email = excluded.email,
                    photo_url = excluded.photo_url
            `,
            args: [uid, email, displayName || null, photoUrl || null]
        });

        return res.status(200).json({ success: true, uid });
    } catch (error: any) {
        console.error('User sync error:', error);
        return res.status(500).json({ error: error.message });
    }
}
