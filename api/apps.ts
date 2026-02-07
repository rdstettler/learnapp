import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient, type TursoClient } from './_lib/turso.js';
import { handleCors, verifyAuth } from './_lib/auth.js';
import { replaceEszett } from './_lib/text-utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Route: if app_id is provided, serve content for that app; otherwise list all apps
    const { app_id } = req.query;
    if (app_id && typeof app_id === 'string') {
        return handleAppContent(req, res, app_id);
    }
    return handleAppsList(req, res);
}

async function handleAppsList(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();

    // Cache for 1 hour, reuse stale for 10 mins
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

    try {
        const result = await db.execute("SELECT * FROM apps");

        const apps = result.rows.map(row => {
            // Parse tags from JSON string
            let tags = [];
            try {
                tags = JSON.parse(row.tags as string);
            } catch (e) {
                console.error("Error parsing tags for app", row.id, e);
            }

            return {
                ...row,
                tags,
                // Ensure boolean conversion for featured if needed (SQLite uses 0/1)
                featured: Boolean(row.featured)
            };
        });

        return res.status(200).json({ apps });
    } catch (e: unknown) {
        console.error("Error fetching apps:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleAppContent(req: VercelRequest, res: VercelResponse, app_id: string) {
    const db = getTursoClient();
    const { skill_level, level } = req.query;

    // Optional auth — personalize if logged in, anonymous fallback otherwise
    const decoded = await verifyAuth(req);
    const user_uid = decoded?.uid;

    try {
        let sql: string;
        const args: (string | number)[] = [];

        if (user_uid) {
            // Personalized query: LEFT JOIN with user progress
            sql = `SELECT ac.*, 
                          uqp.success_count, 
                          uqp.failure_count, 
                          uqp.last_attempt_at
                   FROM app_content ac
                   LEFT JOIN user_question_progress uqp 
                     ON ac.id = uqp.app_content_id AND uqp.user_uid = ?
                   WHERE ac.app_id = ?`;
            args.push(user_uid, app_id);
        } else {
            sql = "SELECT * FROM app_content WHERE app_id = ?";
            args.push(app_id);
        }

        if (skill_level) {
            const skillVal = parseFloat(skill_level as string);
            if (!isNaN(skillVal)) {
                sql += " AND (ac.skill_level IS NULL OR ac.skill_level <= ?)";
                args.push(skillVal);
            }
        }

        if (level) {
            const levelVal = parseInt(level as string);
            if (!isNaN(levelVal)) {
                sql += " AND (ac.level IS NULL OR ac.level = ?)";
                args.push(levelVal);
            }
        }

        const result = await db.execute({ sql, args });

        const content = result.rows.map(row => {
            let data = null;
            try {
                data = JSON.parse(row.data as string);
            } catch (e) {
                console.error("Error parsing content data", row.id);
            }

            if (user_uid) {
                const s = (row.success_count as number) ?? 0;
                const f = (row.failure_count as number) ?? 0;
                const total = s + f;

                let mastery: 'new' | 'struggling' | 'improving' | 'mastered' = 'new';
                let priority = 0.5; // default for unseen

                if (total > 0) {
                    priority = Math.min(1.0, (f + 1) / (total + 1));

                    if (s >= 3 && f === 0) {
                        mastery = 'mastered';
                    } else if (f > s) {
                        mastery = 'struggling';
                    } else {
                        mastery = 'improving';
                    }

                    // Recency boost: questions attempted recently get higher priority
                    if (row.last_attempt_at) {
                        const daysSince = (Date.now() - new Date(row.last_attempt_at as string).getTime()) / 86400000;
                        const recencyBoost = Math.exp(-0.1 * daysSince);
                        priority *= (0.3 + 0.7 * recencyBoost);
                    }
                }

                return {
                    ...row,
                    data,
                    mastery,
                    success_count: s,
                    failure_count: f,
                    _priority: priority
                };
            }

            return { ...row, data };
        });

        // Sort personalized content: struggling first, mastered last
        if (user_uid) {
            content.sort((a: any, b: any) => (b._priority ?? 0) - (a._priority ?? 0));
            // Strip internal sort field
            content.forEach((c: any) => delete c._priority);
        }

        const langFormat = req.query['language-format'];
        if (langFormat === 'swiss') {
            return res.status(200).json({ content: replaceEszett(content) });
        }

        return res.status(200).json({ content });
    } catch (e: unknown) {
        console.error("Error fetching app content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}
