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

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error: any) {
        console.error('User profile error:', error);
        return res.status(500).json({ error: error.message });
    }
}
