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
        const { audioBase64, language } = req.body;
        if (!audioBase64) {
            return res.status(400).json({ error: 'Missing audioBase64 in request body' });
        }

        const apiKey = process.env.XAI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Missing XAI_API_KEY' });
        }

        // Convert base64 to File object
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const file = new File([audioBuffer], 'recording.wav', { type: 'audio/wav' });

        const formData = new FormData();
        formData.append('file', file);
        formData.append('format', 'true');
        if (language) {
            formData.append('language', language);
        }

        // Make STT request to x.ai
        const response = await fetch('https://api.x.ai/v1/stt', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData as any
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`x.ai STT API returned ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        
        let parsedText = '';
        try {
            // According to the user's snippet, the STT output might be stringified JSON
            // json.loads(data["output"][0]["content"][0]["text"])
            if (data.output && data.output[0] && data.output[0].content && data.output[0].content[0]) {
                const innerText = data.output[0].content[0].text;
                try {
                    const innerJson = JSON.parse(innerText);
                    parsedText = innerJson.text || innerText; // fallback to full if no .text property
                } catch {
                    parsedText = innerText;
                }
            } else if (data.text) {
                // OpenAI whisper compatibility
                parsedText = data.text;
            } else {
                parsedText = JSON.stringify(data);
            }
        } catch (e) {
            console.error("Error parsing STT response format:", e);
            parsedText = JSON.stringify(data);
        }

        return res.status(200).json({ text: parsedText });
    } catch (e: unknown) {
        console.error("Error in STT:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}
