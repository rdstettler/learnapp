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

    const { method, language } = req.body;
    const apiKey = process.env.XAI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Missing XAI_API_KEY' });
    }

    try {
        if (method === 'stt') {
            const { audioBase64 } = req.body;
            if (!audioBase64) {
                return res.status(400).json({ error: 'Missing audioBase64 for stt' });
            }

            const audioBuffer = Buffer.from(audioBase64, 'base64');
            const file = new File([audioBuffer], 'recording.wav', { type: 'audio/wav' });

            const formData = new FormData();
            formData.append('file', file);
            formData.append('format', 'true');
            if (language) {
                formData.append('language', language);
            }

            const response = await fetch('https://api.x.ai/v1/stt', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                body: formData as any
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`x.ai STT API returned ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            return res.status(200).json({ text: data.text || JSON.stringify(data) });

        } else if (method === 'tts') {
            const { text } = req.body;
            if (!text) {
                return res.status(400).json({ error: 'Missing text for tts' });
            }

            const response = await fetch('https://api.x.ai/v1/tts', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text,
                    voice_id: "Eve",
                    output_format: { codec: "mp3", sample_rate: 44100, bit_rate: 128000 },
                    language: language || "en"
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`x.ai TTS API returned ${response.status}: ${errorText}`);
            }

            const audioArrayBuffer = await response.arrayBuffer();
            res.setHeader('Content-Type', 'audio/mpeg');
            return res.status(200).send(Buffer.from(audioArrayBuffer));

        } else {
            return res.status(400).json({ error: 'Invalid method. Use "stt" or "tts"' });
        }
    } catch (e: any) {
        console.error(`Error in audio endpoint (${method}):`, e);
        return res.status(500).json({ error: e.message || 'Unknown error' });
    }
}
