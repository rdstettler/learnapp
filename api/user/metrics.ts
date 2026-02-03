import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient, initSchema } from '../_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const db = getTursoClient();
        await initSchema();

        if (req.method === 'GET') {
            // Get user metrics
            const { uid } = req.query;

            if (!uid || typeof uid !== 'string') {
                return res.status(400).json({ error: 'uid is required' });
            }

            const result = await db.execute({
                sql: `SELECT app_id, open_count, last_opened FROM user_metrics WHERE user_uid = ?`,
                args: [uid]
            });

            // Transform to metrics object
            const metrics: Record<string, { openCount: number; lastOpened: string | null }> = {};
            for (const row of result.rows) {
                metrics[row.app_id as string] = {
                    openCount: row.open_count as number,
                    lastOpened: row.last_opened as string | null
                };
            }

            return res.status(200).json({ metrics });
        }

        if (req.method === 'POST') {
            // Save/update user metrics
            const { uid, metrics } = req.body;

            if (!uid) {
                return res.status(400).json({ error: 'uid is required' });
            }

            if (!metrics || typeof metrics !== 'object') {
                return res.status(400).json({ error: 'metrics object is required' });
            }

            // Upsert each app's metrics
            for (const [appId, appMetrics] of Object.entries(metrics)) {
                const { openCount, lastOpened } = appMetrics as { openCount: number; lastOpened: string | null };
                
                await db.execute({
                    sql: `
                        INSERT INTO user_metrics (user_uid, app_id, open_count, last_opened)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(user_uid, app_id) DO UPDATE SET
                            open_count = excluded.open_count,
                            last_opened = excluded.last_opened
                    `,
                    args: [uid, appId, openCount, lastOpened]
                });
            }

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error: any) {
        console.error('User metrics error:', error);
        return res.status(500).json({ error: error.message });
    }
}
