import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth, handleCors } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;
    
    // Auth Check
    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { text, language } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Missing text in request body' });
        }

        const apiKey = process.env.XAI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Missing XAI_API_KEY' });
        }

        const payload = {
            text,
            voice_id: "Eve",
            output_format: { codec: "mp3", sample_rate: 44100, bit_rate: 128000 },
            language: language || "en"
        };

        const response = await fetch('https://api.x.ai/v1/tts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`x.ai TTS API returned ${response.status}: ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', buffer.length.toString());
        return res.status(200).send(buffer);
    } catch (e: unknown) {
        console.error("Error in TTS:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}
