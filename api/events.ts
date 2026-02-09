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
    } else if (type === 'question_progress') {
        return handleQuestionProgress(req, res, decoded.uid);
    } else {
        return res.status(400).json({ error: "Missing or invalid 'type' in body (telemetry|question_progress)" });
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
    } catch (error: unknown) {
        console.error('Telemetry error:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
}

async function handleQuestionProgress(req: VercelRequest, res: VercelResponse, uid: string) {
    try {
        const { appId, appContentId, isCorrect } = req.body;

        if (!appId || appContentId == null || isCorrect == null) {
            return res.status(400).json({
                error: 'appId, appContentId, and isCorrect are required'
            });
        }

        const db = getTursoClient();
        const col = isCorrect ? 'success_count' : 'failure_count';

        await db.execute({
            sql: `INSERT INTO user_question_progress (user_uid, app_id, app_content_id, success_count, failure_count, last_attempt_at)
                  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_uid, app_content_id) DO UPDATE SET
                  ${col} = ${col} + 1,
                  last_attempt_at = CURRENT_TIMESTAMP`,
            args: [uid, appId, appContentId, isCorrect ? 1 : 0, isCorrect ? 0 : 1]
        });

        return res.status(200).json({ success: true });
    } catch (error: unknown) {
        console.error('Question progress error:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
}
