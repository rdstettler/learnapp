import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from '../_lib/supabase.js';
import { requireAuth, handleCors } from '../_lib/auth.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const db = getSupabaseClient();

    if (process.env.NODE_ENV !== 'development') {
        const { data: user, error: userError } = await db
            .from('users')
            .select('is_admin')
            .eq('uid', decoded.uid)
            .single();

        if (userError || !user || !user.is_admin) {
            return res.status(403).json({ error: "Forbidden: Admins only" });
        }
    }

    if (req.method === 'GET') {
        return handleGet(req, res, db);
    } else if (req.method === 'POST') {
        const action = req.body?.action;
        if (action === 'generate') {
            return handleGenerate(req, res, db);
        }
        return handleSave(req, res, db); // Insert/Update
    } else if (req.method === 'DELETE') {
        return handleDelete(req, res, db);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: VercelRequest, res: VercelResponse, db: any) {
    const { topic } = req.query;

    try {
        let query = db.from('voci').select('*');
        if (topic && topic !== 'all') {
            query = query.eq('topic', topic);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Group by de_word and topic
        const groupedMap = new Map<string, any>();
        for (const row of (data || [])) {
            const key = `${row.topic}||${row.de_word}`;
            if (!groupedMap.has(key)) {
                groupedMap.set(key, {
                    id: key, // Pseudo ID for the grouped entry
                    de_word: row.de_word,
                    topic: row.topic,
                    fr_word: '',
                    en_word: ''
                });
            }
            const entry = groupedMap.get(key);
            if (row.lang_code === 'fr') entry.fr_word = row.target_word;
            if (row.lang_code === 'en') entry.en_word = row.target_word;
        }

        const items = Array.from(groupedMap.values()).sort((a, b) => a.topic.localeCompare(b.topic) || a.de_word.localeCompare(b.de_word));

        return res.status(200).json({ items });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}

async function handleSave(req: VercelRequest, res: VercelResponse, db: any) {
    const { old_de_word, old_topic, de_word, topic, fr_word, en_word } = req.body;

    if (!de_word || !topic || (!fr_word && !en_word)) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // If updating existing (maybe de_word or topic changed), delete the old ones first
        if (old_de_word && old_topic && (old_de_word !== de_word || old_topic !== topic)) {
            await db.from('voci').delete().eq('de_word', old_de_word).eq('topic', old_topic);
        }

        // Upsert logic: delete existing for the given language then insert
        // Since we don't have a unique constraint on (lang_code, de_word, topic), we delete and insert.
        await db.from('voci').delete().eq('de_word', de_word).eq('topic', topic);

        const inserts = [];
        if (fr_word) {
            inserts.push({ lang_code: 'fr', de_word, target_word: fr_word, topic });
        }
        if (en_word) {
            inserts.push({ lang_code: 'en', de_word, target_word: en_word, topic });
        }

        const { error } = await db.from('voci').insert(inserts);
        if (error) throw error;

        return res.status(200).json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}

async function handleDelete(req: VercelRequest, res: VercelResponse, db: any) {
    const { de_word, topic } = req.body;

    if (!de_word || !topic) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const { error } = await db.from('voci').delete().eq('de_word', de_word).eq('topic', topic);
        if (error) throw error;
        return res.status(200).json({ success: true });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}

async function handleGenerate(req: VercelRequest, res: VercelResponse, db: any) {
    const { topic, count } = req.body;
    
    if (!topic) return res.status(400).json({ error: 'Topic is required' });
    const num = Math.min(20, Math.max(1, count || 5));

    try {
        // Fetch existing to avoid duplicates
        const { data: existing } = await db.from('voci').select('de_word').eq('topic', topic);
        const existingWords = (existing || []).map((e: any) => e.de_word);
        
        const systemPrompt = `You are an educational vocabulary generator. Generate appropriate vocabulary words for a Swiss/German learning platform. Follow standard German spelling. Return ONLY valid JSON array.`;
        const userPrompt = `
Generate exactly ${num} NEW vocabulary words for the topic: "${topic}".
DO NOT include any of these existing words: ${existingWords.join(', ')}.

Return a JSON array of objects with this format:
[
  {
    "de_word": "das Haus",
    "fr_word": "la maison",
    "en_word": "the house"
  }
]
IMPORTANT: Include the definite article (der/die/das / le/la/l') for nouns!`;

        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: systemPrompt,
            prompt: userPrompt
        });

        const text = aiRes.text.replace(/```json\n?|```/g, '').trim();
        const newEntries = JSON.parse(text);

        return res.status(200).json({ entries: newEntries });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
}
