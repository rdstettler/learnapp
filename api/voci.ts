import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from './_lib/supabase.js';
import { handleCors, verifyAuth } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const db = getSupabaseClient();
    const { topic, limit, lang_code } = req.query;

    try {
        let query = db.from('voci').select('id, lang_code, de_word, target_word, topic, created_at');

        if (lang_code && typeof lang_code === 'string') {
            query = query.eq('lang_code', lang_code);
        }

        if (topic && typeof topic === 'string' && topic !== 'all') {
            query = query.eq('topic', topic);
        }

        // Limit results to make quizzes manageable length
        const maxLimit = limit ? parseInt(limit as string, 10) : 50;
        query = query.limit(maxLimit);

        // Fetch user progress if authorized
        const decoded = await verifyAuth(req);
        const userUid = decoded?.uid;

        const { data: words, error } = await query;
        if (error) throw error;

        // Optionally mix in user_progress if a table exists for it, but for now we just return words
        // Users can implement progress tracking matching reading_progress standard later.

        return res.status(200).json({ words: words || [] });
    } catch (e: unknown) {
        console.error("Error fetching voci:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}
