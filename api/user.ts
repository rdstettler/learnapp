
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient, type TursoClient } from './_lib/turso.js';
import { requireAuth, handleCors } from './_lib/auth.js';
import { BADGE_DEFINITIONS, getBadgeInfoList } from './_lib/badges.js';

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
        } else if (type === 'badges') {
            return handleBadges(req, res, db, decoded.uid);
        } else if (type === 'streak') {
            return handleStreak(req, res, db, decoded.uid);
        } else if (type === 'stats') {
            return handleStats(req, res, db, decoded.uid);
        } else {
            return res.status(400).json({ error: "Missing or invalid 'type' parameter (profile|metrics|sync|badges|streak|stats)" });
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

async function handleBadges(req: VercelRequest, res: VercelResponse, db: TursoClient, uid: string) {
    if (req.method === 'GET') {
        // Return all badge definitions + which ones this user has earned
        try {
            const earned = await db.execute({
                sql: `SELECT badge_id, awarded_at FROM user_badges WHERE user_uid = ?`,
                args: [uid]
            });

            const earnedMap: Record<string, string> = {};
            for (const row of earned.rows) {
                earnedMap[row.badge_id as string] = row.awarded_at as string;
            }

            const allBadges = getBadgeInfoList().map(badge => ({
                ...badge,
                earned: !!earnedMap[badge.id],
                awardedAt: earnedMap[badge.id] || null
            }));

            return res.status(200).json({ badges: allBadges });
        } catch (error: unknown) {
            console.error('Error fetching badges:', error);
            return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
        }
    }

    if (req.method === 'POST') {
        // Check all badges and award any newly earned ones.
        // Returns the list of NEWLY awarded badges (for toast notifications).
        try {
            const earned = await db.execute({
                sql: `SELECT badge_id FROM user_badges WHERE user_uid = ?`,
                args: [uid]
            });
            const earnedSet = new Set(earned.rows.map(r => r.badge_id as string));

            const newlyAwarded: { id: string; name: string; icon: string; tier: string }[] = [];

            for (const badge of BADGE_DEFINITIONS) {
                if (earnedSet.has(badge.id)) continue; // Already earned

                const result = await db.execute({
                    sql: badge.check.query,
                    args: [uid]
                });

                const count = (result.rows[0]?.count as number) || 0;
                if (count >= badge.check.threshold) {
                    // Award!
                    await db.execute({
                        sql: `INSERT INTO user_badges (user_uid, badge_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
                        args: [uid, badge.id]
                    });
                    newlyAwarded.push({ id: badge.id, name: badge.name, icon: badge.icon, tier: badge.tier });
                }
            }

            return res.status(200).json({ newBadges: newlyAwarded });
        } catch (error: unknown) {
            console.error('Error checking badges:', error);
            return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed for badges' });
}

async function handleStreak(req: VercelRequest, res: VercelResponse, db: TursoClient, uid: string) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed for streak' });
    }

    try {
        // Fetch all active dates for this user, ordered descending
        const result = await db.execute({
            sql: `SELECT activity_date FROM user_daily_activity WHERE user_uid = ? ORDER BY activity_date DESC`,
            args: [uid]
        });

        const dates = result.rows.map(r => r.activity_date as string); // YYYY-MM-DD, descending
        const totalActiveDays = dates.length;

        if (totalActiveDays === 0) {
            return res.status(200).json({
                currentStreak: 0,
                longestStreak: 0,
                totalActiveDays: 0,
                lastActivityDate: null
            });
        }

        const lastActivityDate = dates[0];

        // Compute current streak: consecutive days ending today or yesterday
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        let currentStreak = 0;
        if (dates[0] === today || dates[0] === yesterday) {
            // Walk backwards from most recent date
            currentStreak = 1;
            for (let i = 1; i < dates.length; i++) {
                const prev = new Date(dates[i - 1] + 'T00:00:00Z');
                const curr = new Date(dates[i] + 'T00:00:00Z');
                const diffDays = (prev.getTime() - curr.getTime()) / 86400000;
                if (diffDays === 1) {
                    currentStreak++;
                } else {
                    break;
                }
            }
        }

        // Compute longest streak from all dates (reversed to ascending)
        const ascending = [...dates].reverse();
        let longestStreak = 1;
        let runLength = 1;
        for (let i = 1; i < ascending.length; i++) {
            const prev = new Date(ascending[i - 1] + 'T00:00:00Z');
            const curr = new Date(ascending[i] + 'T00:00:00Z');
            const diffDays = (curr.getTime() - prev.getTime()) / 86400000;
            if (diffDays === 1) {
                runLength++;
                if (runLength > longestStreak) longestStreak = runLength;
            } else {
                runLength = 1;
            }
        }

        return res.status(200).json({
            currentStreak,
            longestStreak,
            totalActiveDays,
            lastActivityDate
        });
    } catch (error: unknown) {
        console.error('Error computing streak:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
}

async function handleStats(req: VercelRequest, res: VercelResponse, db: TursoClient, uid: string) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed for stats' });
    }

    try {
        // Run all queries in parallel for speed
        const [appAccuracy, activityDays, weakAreas, overallTotals] = await Promise.all([
            // 1. Per-app accuracy
            db.execute({
                sql: `SELECT uqp.app_id,
                             a.name as app_name,
                             a.icon as app_icon,
                             COALESCE(SUM(uqp.success_count), 0) as correct,
                             COALESCE(SUM(uqp.success_count + uqp.failure_count), 0) as total
                      FROM user_question_progress uqp
                      JOIN apps a ON uqp.app_id = a.id
                      WHERE uqp.user_uid = ?
                      GROUP BY uqp.app_id
                      ORDER BY CASE WHEN SUM(uqp.success_count + uqp.failure_count) > 0
                                    THEN CAST(SUM(uqp.success_count) AS REAL) / SUM(uqp.success_count + uqp.failure_count)
                                    ELSE 0 END ASC`,
                args: [uid]
            }),
            // 2. Activity heatmap (last 90 days)
            db.execute({
                sql: `SELECT activity_date FROM user_daily_activity
                      WHERE user_uid = ? AND activity_date >= DATE('now', '-90 days')
                      ORDER BY activity_date ASC`,
                args: [uid]
            }),
            // 3. Weakest content areas (top 10 by failure rate)
            db.execute({
                sql: `SELECT uqp.app_id,
                             a.name as app_name,
                             a.icon as app_icon,
                             ac.data as content_data,
                             uqp.success_count,
                             uqp.failure_count
                      FROM user_question_progress uqp
                      JOIN app_content ac ON uqp.app_content_id = ac.id
                      JOIN apps a ON uqp.app_id = a.id
                      WHERE uqp.user_uid = ? AND uqp.failure_count > 0
                      ORDER BY uqp.failure_count DESC, uqp.success_count ASC
                      LIMIT 10`,
                args: [uid]
            }),
            // 4. Overall totals
            db.execute({
                sql: `SELECT COALESCE(SUM(success_count + failure_count), 0) as total_answers,
                             COALESCE(SUM(success_count), 0) as total_correct,
                             COUNT(DISTINCT app_id) as apps_used
                      FROM user_question_progress
                      WHERE user_uid = ?`,
                args: [uid]
            })
        ]);

        // Format per-app accuracy
        const perApp = appAccuracy.rows.map(r => ({
            appId: r.app_id as string,
            appName: r.app_name as string,
            appIcon: r.app_icon as string,
            correct: r.correct as number,
            total: r.total as number,
            accuracy: (r.total as number) > 0
                ? Math.round(((r.correct as number) / (r.total as number)) * 100)
                : 0
        }));

        // Format heatmap
        const heatmap = activityDays.rows.map(r => r.activity_date as string);

        // Format weak areas
        const weak = weakAreas.rows.map(r => {
            let preview = '';
            try {
                const parsed = JSON.parse(r.content_data as string);
                // Try to extract a meaningful preview from the content
                if (parsed.category) {
                    preview = parsed.category;
                } else if (parsed.question) {
                    preview = (parsed.question as string).slice(0, 80);
                } else if (parsed.sentences) {
                    preview = ((parsed.sentences as string[])[0] || '').slice(0, 80);
                } else if (parsed.pairs) {
                    const pair = (parsed.pairs as { word1: string; word2: string }[])[0];
                    preview = pair ? `${pair.word1} / ${pair.word2}` : '';
                } else {
                    preview = JSON.stringify(parsed).slice(0, 80);
                }
            } catch { }

            return {
                appId: r.app_id as string,
                appName: r.app_name as string,
                appIcon: r.app_icon as string,
                preview,
                successCount: r.success_count as number,
                failureCount: r.failure_count as number
            };
        });

        // Overall
        const totals = overallTotals.rows[0];
        const totalAnswers = (totals.total_answers as number) || 0;
        const totalCorrect = (totals.total_correct as number) || 0;

        return res.status(200).json({
            overview: {
                totalAnswers,
                totalCorrect,
                accuracy: totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0,
                appsUsed: (totals.apps_used as number) || 0,
                totalActiveDays: heatmap.length
            },
            perApp,
            heatmap,
            weakAreas: weak
        });
    } catch (error: unknown) {
        console.error('Error fetching stats:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
}
