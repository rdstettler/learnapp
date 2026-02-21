
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient, type DbClient } from './_lib/supabase.js';
import { requireAuth, handleCors } from './_lib/auth.js';
import { BADGE_DEFINITIONS, getBadgeInfoList } from './_lib/badges.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    try {
        const db = getSupabaseClient();

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

async function handleProfile(req: VercelRequest, res: VercelResponse, db: DbClient, uid: string) {
    if (req.method === 'GET') {
        // Get user profile — uid from verified token
        const { data, error } = await db.from('users').select('display_name, avatar_config, avatar_svg, skill_level, learn_level, is_admin').eq('uid', uid).single();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(200).json({ profile: null });
        const profile = {
            displayName: data.display_name,
            avatarConfig: data.avatar_config ? JSON.parse(data.avatar_config) : null,
            avatarSvg: data.avatar_svg,
            skillLevel: data.skill_level,
            learnLevel: data.learn_level,
            isAdmin: !!data.is_admin
        };
        return res.status(200).json({ profile });
    }
    if (req.method === 'POST') {
        // Save/update user profile — uid from verified token
        const { profile } = req.body;
        if (!profile) return res.status(400).json({ error: 'profile is required' });
        const { displayName, avatarConfig, avatarSvg, skillLevel, learnLevel } = profile;
        const { error } = await db.from('users').update({
            display_name: displayName || null,
            avatar_config: avatarConfig ? JSON.stringify(avatarConfig) : null,
            avatar_svg: avatarSvg || null,
            skill_level: skillLevel ?? null,
            learn_level: learnLevel ?? null
        }).eq('uid', uid);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed for profile' });
}

async function handleMetrics(req: VercelRequest, res: VercelResponse, db: DbClient, uid: string) {
    if (req.method === 'GET') {
        // Get user metrics — uid from verified token
        const { data, error } = await db.from('user_metrics').select('app_id, open_count, last_opened').eq('user_uid', uid);
        if (error) return res.status(500).json({ error: error.message });
        const metrics: Record<string, { openCount: number; lastOpened: string | null }> = {};
        for (const row of data || []) {
            metrics[row.app_id] = {
                openCount: row.open_count,
                lastOpened: row.last_opened
            };
        }
        return res.status(200).json({ metrics });
    }
    if (req.method === 'POST') {
        // Save/update user metrics — uid from verified token
        const { metrics } = req.body;
        if (!metrics || typeof metrics !== 'object') return res.status(400).json({ error: 'metrics object is required' });
        for (const [appId, appMetrics] of Object.entries(metrics)) {
            const { openCount, lastOpened } = appMetrics as { openCount: number; lastOpened: string | null };
            await db.from('user_metrics').upsert({
                user_uid: uid,
                app_id: appId,
                open_count: openCount,
                last_opened: lastOpened
            }, { onConflict: 'user_uid, app_id' });
        }
        return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed for metrics' });
}

async function handleSync(req: VercelRequest, res: VercelResponse, db: DbClient, decoded: { uid: string; email?: string }) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed for sync' });
    const uid = decoded.uid;
    const email = decoded.email || req.body.email;
    const { displayName, photoUrl } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });
    const { error } = await db.rpc('sync_user', {
        p_uid: uid,
        p_email: email,
        p_display_name: displayName || null,
        p_photo_url: photoUrl || null
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, uid });
}

async function handleBadges(req: VercelRequest, res: VercelResponse, db: DbClient, uid: string) {
    if (req.method === 'GET') {
        // Return all badge definitions + which ones this user has earned
        try {
            const { data, error } = await db.from('user_badges').select('badge_id, awarded_at').eq('user_uid', uid);
            if (error) return res.status(500).json({ error: error.message });
            const earnedMap: Record<string, string> = {};
            for (const row of data || []) {
                earnedMap[row.badge_id] = row.awarded_at;
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
            const { data: earnedRows, error: earnedError } = await db.from('user_badges').select('badge_id').eq('user_uid', uid);
            if (earnedError) return res.status(500).json({ error: earnedError.message });

            const existingBadgeIds = new Set((earnedRows || []).map(r => r.badge_id));
            const newlyAwardedIds = await import('./_lib/badges.js').then(m => m.checkAllBadges(db, uid, existingBadgeIds));

            const newlyAwarded: { id: string; name: string; icon: string; tier: string }[] = [];

            if (newlyAwardedIds.length > 0) {
                // Insert new badges
                const inserts = newlyAwardedIds.map(id => ({ user_uid: uid, badge_id: id }));
                const { error: insertError } = await db.from('user_badges').upsert(inserts, { onConflict: 'user_uid, badge_id' });
                if (insertError) console.error("Error inserting badges", insertError);

                // Prepare response
                const defs = await import('./_lib/badges.js').then(m => m.BADGE_DEFINITIONS);
                const defMap = new Map(defs.map(d => [d.id, d]));

                for (const id of newlyAwardedIds) {
                    const badge = defMap.get(id);
                    if (badge) {
                        newlyAwarded.push({ id: badge.id, name: badge.name, icon: badge.icon, tier: badge.tier });
                    }
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

async function handleStreak(req: VercelRequest, res: VercelResponse, db: DbClient, uid: string) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed for streak' });
    try {
        // Fetch all active dates for this user, ordered descending
        const { data, error } = await db.from('user_daily_activity').select('activity_date').eq('user_uid', uid).order('activity_date', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        const dates = (data || []).map(r => r.activity_date);
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

async function handleStats(req: VercelRequest, res: VercelResponse, db: DbClient, uid: string) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed for stats' });
    try {
        // Run all queries in parallel — no more RPCs, just direct queries
        const [progressResult, activityDays, appsResult] = await Promise.all([
            db.from('user_question_progress')
                .select('app_id, app_content_id, success_count, failure_count')
                .eq('user_uid', uid),
            db.from('user_daily_activity')
                .select('activity_date')
                .eq('user_uid', uid)
                .gte('activity_date', new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
                .order('activity_date', { ascending: true }),
            db.from('apps').select('id, name, icon')
        ]);

        const progressRows = progressResult.data || [];
        const appsRows = appsResult.data || [];

        // Build app lookup map
        const appMap = new Map<string, { name: string; icon: string }>();
        for (const app of appsRows) {
            appMap.set(app.id, { name: app.name, icon: app.icon || '📱' });
        }

        // Aggregate per-app stats
        const appAgg = new Map<string, { correct: number; total: number }>();
        let totalAnswers = 0;
        let totalCorrect = 0;

        for (const row of progressRows) {
            const s = row.success_count || 0;
            const f = row.failure_count || 0;
            const total = s + f;
            totalAnswers += total;
            totalCorrect += s;

            const existing = appAgg.get(row.app_id) || { correct: 0, total: 0 };
            existing.correct += s;
            existing.total += total;
            appAgg.set(row.app_id, existing);
        }

        const perApp = Array.from(appAgg.entries()).map(([appId, agg]) => {
            const appInfo = appMap.get(appId);
            return {
                appId,
                appName: appInfo?.name || appId,
                appIcon: appInfo?.icon || '📱',
                correct: agg.correct,
                total: agg.total,
                accuracy: agg.total > 0 ? Math.round((agg.correct / agg.total) * 100) : 0
            };
        }).sort((a, b) => b.total - a.total); // Sort by most used

        // Format heatmap
        const heatmap = (activityDays.data || []).map((r: any) => r.activity_date);

        // Weak areas: find content items with highest failure rate (min 2 attempts)
        const weakItems = progressRows
            .filter(r => (r.failure_count || 0) > (r.success_count || 0) && ((r.success_count || 0) + (r.failure_count || 0)) >= 2)
            .sort((a, b) => (b.failure_count || 0) - (a.failure_count || 0))
            .slice(0, 10);

        // Fetch content data for weak items
        let weak: any[] = [];
        if (weakItems.length > 0) {
            const contentIds = weakItems.map(w => w.app_content_id);
            const { data: contentRows } = await db.from('app_content')
                .select('id, app_id, data')
                .in('id', contentIds);

            const contentMap = new Map<number, any>();
            for (const c of contentRows || []) {
                contentMap.set(c.id, c);
            }

            weak = weakItems.map(w => {
                const content = contentMap.get(w.app_content_id);
                const appInfo = appMap.get(w.app_id);
                let preview = '';
                if (content?.data) {
                    try {
                        const parsed = JSON.parse(content.data);
                        if (parsed.category) preview = parsed.category;
                        else if (parsed.question) preview = (parsed.question as string).slice(0, 80);
                        else if (parsed.sentences) preview = ((parsed.sentences as string[])[0] || '').slice(0, 80);
                        else if (parsed.pairs) {
                            const pair = (parsed.pairs as { word1: string; word2: string }[])[0];
                            preview = pair ? `${pair.word1} / ${pair.word2}` : '';
                        } else preview = JSON.stringify(parsed).slice(0, 80);
                    } catch { }
                }
                return {
                    appId: w.app_id,
                    appName: appInfo?.name || w.app_id,
                    appIcon: appInfo?.icon || '📱',
                    preview,
                    successCount: w.success_count || 0,
                    failureCount: w.failure_count || 0
                };
            });
        }

        return res.status(200).json({
            overview: {
                totalAnswers,
                totalCorrect,
                accuracy: totalAnswers > 0 ? Math.round((totalCorrect / totalAnswers) * 100) : 0,
                appsUsed: appAgg.size,
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
