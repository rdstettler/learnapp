
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from './_lib/supabase.js';
import { verifyAuth, handleCors } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const db = getSupabaseClient();

    // --- Admin / Review Logic (GET & POST with action='resolve') ---

    // Check for Admin Review Request (GET)
    if (req.method === 'GET') {
        return handleAdminReviewList(req, res, db);
    }

    // Check for Admin Resolve Request (POST with action='resolve')
    if (req.method === 'POST' && req.body.action === 'resolve') {
        return handleAdminResolve(req, res, db);
    }

    // --- Standard Feedback Submission (POST) ---

    if (req.method === 'POST') {
        return handleFeedbackSubmission(req, res, db);
    }

    return res.status(405).json({ error: "Method not allowed" });
}

async function handleFeedbackSubmission(req: VercelRequest, res: VercelResponse, db: any) {
    // Allow anonymous feedback, but use verified uid if available
    const decoded = await verifyAuth(req);
    const { app_id, session_id, content, comment, error_type } = req.body;
    const user_uid = decoded?.uid || 'anonymous';

    if (!app_id || !comment) {
        return res.status(400).json({ error: "Missing required fields (app_id, comment)" });
    }

    try {
        const { error } = await db.from('feedback').insert({
            user_uid: user_uid || null,
            app_id,
            session_id: session_id || null,
            content: typeof content === 'object' ? JSON.stringify(content) : (content || null),
            comment,
            error_type: error_type || 'general',
            target_id: req.body.target_id || null
        });

        if (error) throw error;

        return res.status(200).json({ success: true, message: "Feedback submitted successfully" });
    } catch (e: unknown) {
        console.error("Error submitting feedback:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleAdminReviewList(req: VercelRequest, res: VercelResponse, db: any) {
    // 1. Verify token
    const decoded = await verifyAuth(req);
    if (!decoded) return res.status(401).json({ error: "Unauthorized" });
    const user_uid = decoded.uid;

    try {
        const { data: user, error: userError } = await db
            .from('users')
            .select('is_admin')
            .eq('uid', user_uid)
            .single();

        if (userError || !user || !user.is_admin) {
            return res.status(403).json({ error: "Forbidden: Admins only" });
        }

        // 2. List Pending Feedback
        const { data: feedback, error: feedbackError } = await db
            .from('feedback')
            .select('*')
            .or('resolved.is.null,resolved.eq.false') // (resolved = 0 OR resolved IS NULL)
            .eq('error_type', 'ai_review_flag')
            .order('created_at', { ascending: false });

        if (feedbackError) throw feedbackError;

        return res.status(200).json(feedback);

    } catch (e: unknown) {
        console.error("Error in admin review list:", e);
        return res.status(500).json({ error: "Auth check or DB error" });
    }
}

async function handleAdminResolve(req: VercelRequest, res: VercelResponse, db: any) {
    // 1. Verify token
    const decoded = await verifyAuth(req);
    if (!decoded) return res.status(401).json({ error: "Unauthorized" });
    const user_uid = decoded.uid;

    try {
        const { data: user, error: userError } = await db
            .from('users')
            .select('is_admin')
            .eq('uid', user_uid)
            .single();

        if (userError || !user || !user.is_admin) {
            return res.status(403).json({ error: "Forbidden: Admins only" });
        }

        // 3. POST: Approve Correction
        const { feedback_id, target_id, new_content, resolution_reason } = req.body;

        if (!feedback_id || !target_id || !new_content) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Identify Target Table
        let table = "";
        let id = "";

        if (target_id.startsWith("app_content:")) {
            table = "app_content";
            id = target_id.split(":")[1];
        } else {
            return res.status(400).json({ error: "Only app_content updates are supported." });
        }

        // Update Content
        if (table === 'app_content') {
            const { error: updateError } = await db
                .from('app_content')
                .update({
                    data: JSON.stringify(new_content),
                    human_verified: true
                })
                .eq('id', id);

            if (updateError) throw updateError;
        } else {
            // Fallback for other tables if ever supported
            // const { error: updateError } = await db.from(table).update({ content: new_content }).eq('id', id);
            // if (updateError) throw updateError;
        }

        // Mark Feedback Resolved
        const { error: resolveError } = await db
            .from('feedback')
            .update({
                resolved: true,
                resolution_reason: resolution_reason || null
            })
            .eq('id', feedback_id);

        if (resolveError) throw resolveError;

        return res.status(200).json({ success: true });

    } catch (e: unknown) {
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}
