
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from '../_lib/supabase.js';
import { requireAuth, handleCors } from '../_lib/auth.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Require authenticated admin user
    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const db = getSupabaseClient();

    const { data: user, error: userError } = await db
        .from('users')
        .select('is_admin')
        .eq('uid', decoded.uid)
        .single();

    if (userError || !user || !user.is_admin) {
        return res.status(403).json({ error: 'Forbidden: Admins only' });
    }

    const limit = parseInt(req.query.limit as string) || 1;

    try {
        const updates = [];

        // Fetch candidates. 
        // Supabase doesn't support RANDOM() sort easily. 
        // We fetch a larger batch sorted by priority (least reviewed, most flagged) and shuffle in memory.
        const excludedApps = ['kopfrechnen', 'zeitrechnen', 'umrechnen', 'zahlen-raten', 'flaeche-umfang'];

        const { data: candidates, error } = await db.from('app_content')
            .select('*')
            .eq('ai_generated', true)
            .eq('human_verified', false)
            .not('app_id', 'in', `(${excludedApps.join(',')})`)
            .order('ai_reviewed_counter', { ascending: true })
            .order('flag_counter', { ascending: false })
            .limit(limit * 5); // Fetch 5x needed to allow some randomization

        if (error) throw error;

        if (!candidates || candidates.length === 0) {
            return res.status(200).json({ checked_count: 0, results: [] });
        }

        // Shuffle in memory
        const shuffled = candidates.sort(() => 0.5 - Math.random()).slice(0, limit);

        for (const row of shuffled) {
            let content = null;
            try { content = JSON.parse(row.data as string); } catch (e) { }
            const app_id = row.app_id as string;

            // Always increment review counter (Read-Modify-Write)
            const newReviewCount = (row.ai_reviewed_counter || 0) + 1;
            await db.from('app_content').update({ ai_reviewed_counter: newReviewCount }).eq('id', row.id);

            if (!content) continue;

            const result = await reviewItem(app_id, content);

            if (result.status === "FAILED") {
                console.warn(`[Quality Check] Flagging app_content ${row.id}: ${result.reason}`);

                // Increment flag_counter
                const newFlagCount = (row.flag_counter || 0) + 1;
                await db.from('app_content').update({ flag_counter: newFlagCount }).eq('id', row.id);

                // Log the correction/issue for human review
                await db.from('feedback').insert({
                    user_uid: 'system',
                    app_id: app_id,
                    session_id: 'cron-job',
                    target_id: `app_content:${row.id}`,
                    content: JSON.stringify(content),
                    comment: `AI Review: ${result.reason}. Suggestion: ${JSON.stringify(result.correction)}`,
                    error_type: 'ai_review_flag',
                    resolved: false
                });

                updates.push({ source: 'app_content', id: row.id, status: "FAILED", reason: result.reason });
            } else {
                updates.push({ source: 'app_content', id: row.id, status: "PASS" });
            }
        }

        return res.status(200).json({
            checked_count: shuffled.length,
            results: updates
        });

    } catch (e: unknown) {
        console.error("Error in generic review:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function reviewItem(appId: string, content: Record<string, unknown>, languageVariant: 'swiss' | 'standard' = 'swiss'): Promise<{ status: string, reason?: string, correction?: string }> {
    // We now handle ss/ß replacement at runtime, so we enforce Standard German spelling in the review to ensure correctness before runtime transformation.
    const languageRule = "IMPORTANT: Verify that the content uses Standard German spelling conventions (e.g., use 'ß' where appropriate). However, do NOT flag spelling errors in JSON property names (keys). Specifically, treat 'ae' vs 'ä', 'ue' vs 'ü', and 'oe' vs 'ö' as valid variations in keys (e.g., 'praeteritum' is acceptable).";

    const prompt = `
    You are a Data Quality Auditor.
    Review the following learning task for correctness.
    
    App ID: ${appId}
    Task Content JSON: ${JSON.stringify(content)}
    
    Verify the question statement and the answer key.
    If the question contains errors (spelling, factual, mathematical) or the answer key is wrong, mark it as FAILED.
    Otherwise mark it PASS.
    
    Return JSON:
    {
        "status": "PASS" | "FAILED",
        "reason": "string (if failed)",
        "correction": "object (the fully corrected content JSON object, exactly as it should be in the database)"
    }
    `;

    try {
        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: `You are a strict educational content reviewer. ${languageRule}`,
            prompt: prompt
        });

        const text = aiRes.text.replace(/```json\n?|```/g, '').trim();
        return JSON.parse(text);
    } catch (e: unknown) {
        console.error("AI Generation Failed", e);
        return { status: "ERROR", reason: e instanceof Error ? e.message : 'Unknown error' };
    }
}
