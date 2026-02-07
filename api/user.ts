
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';

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

        const type = req.query.type || req.body?.type;

        if (type === 'profile') {
            return handleProfile(req, res, db);
        } else if (type === 'metrics') {
            return handleMetrics(req, res, db);
        } else {
            return res.status(400).json({ error: "Missing or invalid 'type' parameter (profile|metrics)" });
        }

    } catch (error: any) {
        console.error('User API error:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function handleProfile(req: VercelRequest, res: VercelResponse, db: any) {
    if (req.method === 'GET') {
        // Get user profile
        const { uid } = req.query;

        if (!uid || typeof uid !== 'string') {
            return res.status(400).json({ error: 'uid is required' });
        }

        const result = await db.execute({
            sql: `SELECT display_name, avatar_config, avatar_svg, skill_level, learn_level FROM users WHERE uid = ?`,
            args: [uid]
        });

        if (result.rows.length === 0) {
            return res.status(200).json({ profile: null });
        }

        const row = result.rows[0];
        const profile = {
            displayName: row.display_name as string | null,
            avatarConfig: row.avatar_config ? JSON.parse(row.avatar_config as string) : null,
            avatarSvg: row.avatar_svg as string | null,
            skillLevel: row.skill_level as number | null,
            learnLevel: row.learn_level as number | null
        };

        return res.status(200).json({ profile });
    }

    if (req.method === 'POST') {
        // Save/update user profile
        const { uid, profile } = req.body;

        if (!uid) {
            return res.status(400).json({ error: 'uid is required' });
        }

        if (!profile) {
            return res.status(400).json({ error: 'profile is required' });
        }

        const { displayName, avatarConfig, avatarSvg, skillLevel, learnLevel } = profile;

        // Update user profile fields
        await db.execute({
            sql: `
                UPDATE users 
                SET display_name = ?,
                    avatar_config = ?,
                    avatar_svg = ?,
                    skill_level = ?,
                    learn_level = ?
                WHERE uid = ?
            `,
            args: [
                displayName || null,
                avatarConfig ? JSON.stringify(avatarConfig) : null,
                avatarSvg || null,
                skillLevel !== undefined ? skillLevel : null,
                learnLevel !== undefined ? learnLevel : null,
                uid
            ]
        });

        return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed for profile' });
}

async function handleMetrics(req: VercelRequest, res: VercelResponse, db: any) {
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

    return res.status(405).json({ error: 'Method not allowed for metrics' });
}
