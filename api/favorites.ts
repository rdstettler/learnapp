
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from './_lib/supabase.js';
import { requireAuth, handleCors } from './_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const db = getSupabaseClient();
    const user_uid = decoded.uid;

    if (req.method === 'GET') {
        try {
            const { data, error } = await db
                .from('user_apps')
                .select('app_id')
                .eq('user_uid', user_uid)
                .eq('is_favorite', true);

            if (error) throw error;

            const favoriteIds = data.map(r => r.app_id);
            return res.status(200).json({ favorites: favoriteIds });
        } catch (e: unknown) {
            return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
        }
    }
    else if (req.method === 'POST') {
        const { app_id, is_favorite } = req.body;

        if (!app_id || is_favorite === undefined) {
            return res.status(400).json({ error: 'Missing required fields (app_id, is_favorite)' });
        }

        try {
            // Upsert: Insert or Update
            // constraint 'user_apps_pkey' or unique index on (user_uid, app_id) is expected
            // If the table doesn't have a unique constraint on these two columns, upsert might require explicit conflict target
            const { error } = await db
                .from('user_apps')
                .upsert({
                    user_uid,
                    app_id,
                    is_favorite: is_favorite ? true : false,
                    // We don't explicitly set created_at, relying on DB default for new rows
                    // It won't update created_at for existing rows unless specified
                }, { onConflict: 'user_uid, app_id' });

            if (error) throw error;

            return res.status(200).json({ success: true });
        } catch (e: unknown) {
            return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
        }
    }
    else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
}
