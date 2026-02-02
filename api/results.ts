import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient, initSchema } from './_lib/turso';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const db = getTursoClient();
    await initSchema();

    // POST - Save a new result
    if (req.method === 'POST') {
        try {
            const { uid, appId, score, maxScore, durationSeconds, details } = req.body;

            if (!uid || !appId || score === undefined || maxScore === undefined) {
                return res.status(400).json({
                    error: 'uid, appId, score, and maxScore are required'
                });
            }

            const result = await db.execute({
                sql: `
                    INSERT INTO learn_results (user_uid, app_id, score, max_score, duration_seconds, details)
                    VALUES (?, ?, ?, ?, ?, ?)
                `,
                args: [
                    uid,
                    appId,
                    score,
                    maxScore,
                    durationSeconds || null,
                    details ? JSON.stringify(details) : null
                ]
            });

            return res.status(200).json({
                success: true,
                id: Number(result.lastInsertRowid)
            });
        } catch (error: any) {
            console.error('Results POST error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // GET - Retrieve results
    if (req.method === 'GET') {
        try {
            const { uid, appId, limit = '10' } = req.query;

            if (!uid) {
                return res.status(400).json({ error: 'uid is required' });
            }

            let sql = `
                SELECT id, app_id, score, max_score, completed_at, duration_seconds, details
                FROM learn_results
                WHERE user_uid = ?
            `;
            const args: any[] = [uid];

            if (appId) {
                sql += ' AND app_id = ?';
                args.push(appId);
            }

            sql += ' ORDER BY completed_at DESC LIMIT ?';
            args.push(parseInt(limit as string, 10));

            const results = await db.execute({ sql, args });

            return res.status(200).json({
                results: results.rows.map(row => ({
                    id: row.id,
                    appId: row.app_id,
                    score: row.score,
                    maxScore: row.max_score,
                    completedAt: row.completed_at,
                    durationSeconds: row.duration_seconds,
                    details: row.details ? JSON.parse(row.details as string) : null
                }))
            });
        } catch (error: any) {
            console.error('Results GET error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
