
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient, type TursoClient } from './_lib/turso.js';
import { requireAuth, handleCors } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    try {
        const db = getTursoClient();

        const type = req.query.type || req.body?.type;

        if (type === 'profile') {
            return handleProfile(req, res, db, decoded.uid);
        } else if (type === 'metrics') {
            return handleMetrics(req, res, db, decoded.uid);
        } else if (type === 'sync') {
            return handleSync(req, res, db, decoded);
        } else {
            return res.status(400).json({ error: "Missing or invalid 'type' parameter (profile|metrics|sync)" });
        }

    } catch (error: unknown) {
        console.error('User API error:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
}

async function handleProfile(req: VercelRequest, res: VercelResponse, db: TursoClient, uid: string) {
    if (req.method === 'GET') {
        // Get user profile — uid from verified token

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
        // Save/update user profile — uid from verified token
        const { profile } = req.body;

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

async function handleMetrics(req: VercelRequest, res: VercelResponse, db: TursoClient, uid: string) {
    if (req.method === 'GET') {
        // Get user metrics — uid from verified token

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
        // Save/update user metrics — uid from verified token
        const { metrics } = req.body;

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

async function handleSync(req: VercelRequest, res: VercelResponse, db: TursoClient, decoded: { uid: string; email?: string }) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed for sync' });
    }

    const uid = decoded.uid;
    const email = decoded.email || req.body.email;
    const { displayName, photoUrl } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'email is required' });
    }

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
}
