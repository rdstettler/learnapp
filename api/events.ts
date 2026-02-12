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
        const { appId, appContentId, category, isCorrect, mode } = req.body;

        if (!appId || isCorrect == null) {
            return res.status(400).json({
                error: 'appId and isCorrect are required'
            });
        }

        // Resolve content ID: either directly provided, or via category for procedural apps
        let resolvedContentId = appContentId;

        if (resolvedContentId == null && category && appId) {
            resolvedContentId = await resolveCategory(appId, category);
        }

        if (resolvedContentId == null) {
            return res.status(400).json({
                error: 'appContentId or category is required'
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
            args: [uid, appId, resolvedContentId, isCorrect ? 1 : 0, isCorrect ? 0 : 1]
        });

        // Record mode usage as telemetry event (fire-and-forget)
        if (mode) {
            db.execute({
                sql: `INSERT INTO telemetry_events (user_uid, app_id, event_type, metadata)
                      VALUES (?, ?, ?, ?)`,
                args: [uid, appId, 'question_progress', JSON.stringify({ mode, isCorrect, contentId: resolvedContentId })]
            }).catch(e => console.error('Mode telemetry insert error:', e));
        }

        // Record daily activity for streak tracking (fire-and-forget, ON CONFLICT ignores duplicates)
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        db.execute({
            sql: `INSERT INTO user_daily_activity (user_uid, activity_date) VALUES (?, ?) ON CONFLICT DO NOTHING`,
            args: [uid, today]
        }).catch(e => console.error('Daily activity insert error:', e));

        return res.status(200).json({ success: true });
    } catch (error: unknown) {
        console.error('Question progress error:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
}



// Cache for procedural category → app_content_id mappings (avoids repeated DB lookups)
const categoryCache = new Map<string, number>();

async function resolveCategory(appId: string, category: string): Promise<number> {
    const cacheKey = `${appId}:${category}`;
    const cached = categoryCache.get(cacheKey);
    if (cached) return cached;

    const db = getTursoClient();
    const categoryData = JSON.stringify({ category, procedural: true });

    // Try to find existing entry
    const existing = await db.execute({
        sql: `SELECT id FROM app_content WHERE app_id = ? AND data = ?`,
        args: [appId, categoryData]
    });

    if (existing.rows.length > 0) {
        const id = existing.rows[0].id as number;
        categoryCache.set(cacheKey, id);
        return id;
    }

    // Auto-create entry for this category
    const result = await db.execute({
        sql: `INSERT INTO app_content (app_id, data, human_verified) VALUES (?, ?, 1)`,
        args: [appId, categoryData]
    });

    const newId = Number(result.lastInsertRowid);
    categoryCache.set(cacheKey, newId);
    return newId;
}
