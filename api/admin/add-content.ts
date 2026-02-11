
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../_lib/turso.js';
import { requireAuth, handleCors } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const user_uid = decoded.uid;
    const db = getTursoClient();

    // Check Admin Status (all operations require admin)
    const user = await db.execute({
        sql: "SELECT is_admin FROM users WHERE uid = ?",
        args: [user_uid as string]
    });

    if (user.rows.length === 0 || !user.rows[0].is_admin) {
        return res.status(403).json({ error: "Forbidden: Admins only" });
    }

    if (req.method === 'GET') {
        return handleGetContent(req, res, db);
    } else if (req.method === 'POST') {
        return handleAddContent(req, res, db);
    } else if (req.method === 'PUT') {
        return handleUpdateContent(req, res, db);
    } else if (req.method === 'DELETE') {
        return handleDeleteContent(req, res, db);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

type DB = ReturnType<typeof getTursoClient>;

/**
 * GET — List content for an app, with per-question stats
 * Query params: app_id (required), page (default 1), limit (default 50)
 */
async function handleGetContent(req: VercelRequest, res: VercelResponse, db: DB) {
    const app_id = req.query.app_id as string;
    if (!app_id) {
        return res.status(400).json({ error: 'app_id query param required' });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    try {
        const [contentResult, countResult] = await Promise.all([
            db.execute({
                sql: `SELECT ac.id, ac.app_id, ac.data, ac.level, ac.skill_level,
                             ac.ai_generated, ac.human_verified, ac.flag_counter, ac.created_at,
                             COALESCE(stats.total_attempts, 0) as total_attempts,
                             COALESCE(stats.total_correct, 0) as total_correct,
                             COALESCE(stats.total_wrong, 0) as total_wrong,
                             COALESCE(stats.unique_users, 0) as unique_users
                      FROM app_content ac
                      LEFT JOIN (
                          SELECT app_content_id,
                                 SUM(success_count + failure_count) as total_attempts,
                                 SUM(success_count) as total_correct,
                                 SUM(failure_count) as total_wrong,
                                 COUNT(DISTINCT user_uid) as unique_users
                          FROM user_question_progress
                          GROUP BY app_content_id
                      ) stats ON ac.id = stats.app_content_id
                      WHERE ac.app_id = ?
                      ORDER BY ac.id ASC
                      LIMIT ? OFFSET ?`,
                args: [app_id, limit, offset]
            }),
            db.execute({
                sql: `SELECT COUNT(*) as count FROM app_content WHERE app_id = ?`,
                args: [app_id]
            })
        ]);

        const totalCount = countResult.rows[0].count as number;

        const items = contentResult.rows.map(row => {
            let data = {};
            try { data = JSON.parse(row.data as string); } catch { }

            return {
                id: row.id as number,
                appId: row.app_id as string,
                data,
                level: row.level as number | null,
                skillLevel: row.skill_level as number | null,
                aiGenerated: Boolean(row.ai_generated),
                humanVerified: Boolean(row.human_verified),
                flagCounter: row.flag_counter as number,
                createdAt: row.created_at as string,
                stats: {
                    totalAttempts: row.total_attempts as number,
                    totalCorrect: row.total_correct as number,
                    totalWrong: row.total_wrong as number,
                    uniqueUsers: row.unique_users as number,
                    accuracy: (row.total_attempts as number) > 0
                        ? Math.round(((row.total_correct as number) / (row.total_attempts as number)) * 100)
                        : null
                }
            };
        });

        return res.status(200).json({
            items,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (e: unknown) {
        console.error("Error listing content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * POST — Add new content
 */
async function handleAddContent(req: VercelRequest, res: VercelResponse, db: DB) {
    const { app_id, content, level } = req.body;

    if (!app_id || !content) {
        return res.status(400).json({ error: 'Missing required fields (app_id, content)' });
    }

    try {
        const result = await db.execute({
            sql: `INSERT INTO app_content (app_id, data, level, ai_generated, human_verified)
                  VALUES (?, ?, ?, 0, 1)`,
            args: [app_id, JSON.stringify(content), level || null]
        });

        return res.status(200).json({
            success: true,
            id: Number(result.lastInsertRowid),
            message: 'Content added successfully'
        });
    } catch (e: unknown) {
        console.error("Error adding content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * PUT — Update existing content
 */
async function handleUpdateContent(req: VercelRequest, res: VercelResponse, db: DB) {
    const { id, data, level, human_verified } = req.body;

    if (!id || data === undefined) {
        return res.status(400).json({ error: 'Missing required fields (id, data)' });
    }

    try {
        await db.execute({
            sql: `UPDATE app_content 
                  SET data = ?, level = ?, human_verified = ?, flag_counter = 0
                  WHERE id = ?`,
            args: [
                typeof data === 'string' ? data : JSON.stringify(data),
                level ?? null,
                human_verified !== undefined ? (human_verified ? 1 : 0) : 1,
                id
            ]
        });

        return res.status(200).json({ success: true });
    } catch (e: unknown) {
        console.error("Error updating content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * DELETE — Remove content by id
 */
async function handleDeleteContent(req: VercelRequest, res: VercelResponse, db: DB) {
    const id = req.query.id || req.body?.id;

    if (!id) {
        return res.status(400).json({ error: 'Missing id' });
    }

    try {
        await db.execute({
            sql: `DELETE FROM app_content WHERE id = ?`,
            args: [id]
        });

        return res.status(200).json({ success: true });
    } catch (e: unknown) {
        console.error("Error deleting content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}
