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
        const { uid, appId, eventType, metadata } = req.body;

        if (!uid || !appId || !eventType) {
            return res.status(400).json({ error: 'uid, appId, and eventType are required' });
        }

        const db = getTursoClient();

        // Ensure schema exists
        await initSchema();

        await db.execute({
            sql: `
                INSERT INTO telemetry_events (user_uid, app_id, event_type, metadata)
                VALUES (?, ?, ?, ?)
            `,
            args: [uid, appId, eventType, metadata ? JSON.stringify(metadata) : null]
        });

        return res.status(200).json({ success: true });
    } catch (error: any) {
        console.error('Telemetry error:', error);
        // Log stack trace if available
        if (error.stack) {
            console.error(error.stack);
        }
        return res.status(500).json({
            error: {
                code: '500',
                message: error.message || 'A server error has occurred',
                details: process.env.NODE_ENV === 'development' ? error : undefined
            }
        });
    }
}
