import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type DbClient = SupabaseClient;

// Singleton Supabase client
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
    if (!client) {
        const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!url || !key) {
            throw new Error('Missing Supabase credentials. Please set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY environment variables.');
        }

        client = createClient(url, key, {
            auth: { persistSession: false }
        });
    }
    return client;
}
