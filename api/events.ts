import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';
import { requireAuth, handleCors } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const type = req.body.type;

    if (type === 'telemetry') {
        return handleTelemetry(req, res, decoded.uid);
    } else if (type === 'app_result') {
        return handleAppResult(req, res, decoded.uid);
    } else {
        return res.status(400).json({ error: "Missing or invalid 'type' in body (telemetry|app_result)" });
    }
}

async function handleTelemetry(req: VercelRequest, res: VercelResponse, uid: string) {
    try {
        const { appId, eventType, metadata } = req.body;

        if (!appId || !eventType) {
            return res.status(400).json({ error: 'appId and eventType are required' });
        }

        const db = getTursoClient();

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
        return res.status(500).json({ error: error.message });
    }
}

async function handleAppResult(req: VercelRequest, res: VercelResponse, uid: string) {
    try {
        const { appId, sessionId, content } = req.body;

        if (!appId || !sessionId || !content) {
            return res.status(400).json({
                error: 'appId, sessionId, and content are required'
            });
        }

        const db = getTursoClient();

        const result = await db.execute({
            sql: `
                INSERT INTO app_results (app_id, user_uid, session_id, content)
                VALUES (?, ?, ?, ?)
            `,
            args: [appId, uid, sessionId, content]
        });

        return res.status(200).json({
            success: true,
            id: Number(result.lastInsertRowid)
        });
    } catch (error: any) {
        console.error('App Results error:', error);
        return res.status(500).json({ error: error.message });
    }
}
