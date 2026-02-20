
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from './_lib/supabase.js';
import { requireAuth, handleCors } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const type = req.body.type;

    if (type === 'question_progress') {
        return handleQuestionProgress(req, res, decoded.uid);
    } else {
        return res.status(400).json({ error: "Missing or invalid 'type' in body (question_progress)" });
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

        const db = getSupabaseClient();

        // 1. Track Curriculum Mastery if category matches 'curriculum-{nodeId}'
        if (category && typeof category === 'string' && category.startsWith('curriculum-')) {
            const nodeIdParts = category.split('-');
            if (nodeIdParts.length > 1) {
                const nodeId = parseInt(nodeIdParts[1]);
                if (!isNaN(nodeId)) {
                    // Read-modify-write for mastery level
                    const { data: existing } = await db.from('user_curriculum_progress')
                        .select('mastery_level')
                        .eq('user_uid', uid)
                        .eq('curriculum_node_id', nodeId)
                        .single();

                    const currentMastery = existing ? (existing.mastery_level || 0) : 0;
                    // Calculate mastery change: +5 for correct, -2 for wrong
                    const delta = isCorrect ? 5 : -2;
                    const newMastery = Math.max(0, Math.min(100, currentMastery + delta));
                    const newStatus = newMastery >= 100 ? 'completed' : 'started';

                    await db.from('user_curriculum_progress').upsert({
                        user_uid: uid,
                        curriculum_node_id: nodeId,
                        mastery_level: newMastery,
                        status: newStatus,
                        last_activity: new Date().toISOString()
                    }, { onConflict: 'user_uid, curriculum_node_id' });
                }
            }
        }

        // Resolve content ID: either directly provided, or via category for procedural apps
        let resolvedContentId = appContentId;

        if (resolvedContentId == null && category && appId) {
            try {
                resolvedContentId = await resolveCategory(db, appId, category);
            } catch (err) {
                console.error("Error resolving category:", err);
                // Continue? Or return error? If we can't resolve content ID, we can't track specific progress.
                // But existing code returned error if null.
            }
        }

        if (resolvedContentId == null) {
            return res.status(400).json({
                error: 'appContentId or category is required'
            });
        }

        // 2. Track Question Progress (Read-Modify-Write)
        const { data: progressExisting } = await db.from('user_question_progress')
            .select('success_count, failure_count')
            .eq('user_uid', uid)
            .eq('app_id', appId)
            .eq('app_content_id', resolvedContentId)
            .single();

        let success = progressExisting?.success_count || 0;
        let failure = progressExisting?.failure_count || 0;

        if (isCorrect) success++;
        else failure++;

        await db.from('user_question_progress').upsert({
            user_uid: uid,
            app_id: appId,
            app_content_id: resolvedContentId,
            success_count: success,
            failure_count: failure,
            last_attempt_at: new Date().toISOString()
        }, { onConflict: 'user_uid, app_content_id' });


        // Record daily activity for streak tracking (fire-and-forget)
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        db.from('user_daily_activity').upsert({
            user_uid: uid,
            activity_date: today
        }, { onConflict: 'user_uid, activity_date' }).then(({ error }) => {
            // Ignore duplicate key error if upsert handles it (it does), or if we used insert and ignore.
            // Upsert is safer.
            if (error) console.error('Daily activity insert error:', error);
        });

        return res.status(200).json({ success: true });
    } catch (error: unknown) {
        console.error('Question progress error:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
}

// Cache for procedural category → app_content_id mappings (avoids repeated DB lookups)
const categoryCache = new Map<string, number>();

async function resolveCategory(db: any, appId: string, category: string): Promise<number> {
    const cacheKey = `${appId}:${category}`;
    const cached = categoryCache.get(cacheKey);
    if (cached) return cached;

    const categoryData = JSON.stringify({ category, procedural: true });

    // Try to find existing entry
    // NOTE: 'data' is text in Supabase/Postgres.
    const { data: existing } = await db.from('app_content')
        .select('id')
        .eq('app_id', appId)
        .eq('data', categoryData)
        .limit(1);

    if (existing && existing.length > 0) {
        const id = existing[0].id as number;
        categoryCache.set(cacheKey, id);
        return id;
    }

    // Auto-create entry for this category
    const { data: inserted, error } = await db.from('app_content')
        .insert({ app_id: appId, data: categoryData, human_verified: true })
        .select('id')
        .single();

    if (error) {
        // Handle race condition: check again if it was inserted by another process
        const { data: retry } = await db.from('app_content')
            .select('id')
            .eq('app_id', appId)
            .eq('data', categoryData)
            .limit(1);

        if (retry && retry.length > 0) {
            const id = retry[0].id as number;
            categoryCache.set(cacheKey, id);
            return id;
        }
        throw error;
    }

    const newId = inserted.id;
    categoryCache.set(cacheKey, newId);
    return newId;
}
