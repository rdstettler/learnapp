import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from '../_lib/supabase.js';
import { requireAuth, handleCors } from '../_lib/auth.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const LANG_MAP: Record<string, string> = {
    'en': 'English',
    'fr': 'French',
    'it': 'Italian',
    'es': 'Spanish'
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    // Auth Check
    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const db = getSupabaseClient();
    const user_uid = decoded.uid;

    try {
        const { lang_code, mode, previous_iteration } = req.body;
        if (!lang_code) {
            return res.status(400).json({ error: 'Missing lang_code' });
        }

        const langName = LANG_MAP[lang_code] || lang_code;
        const currentMode = mode || 'translation';

        // 1. Fetch current progress from DB
        let { data: skillData, error: skillError } = await db
            .from('user_language_skills')
            .select('skill_summary')
            .eq('user_uid', user_uid)
            .eq('lang_code', lang_code)
            .maybeSingle();

        if (skillError) {
            console.error("Error fetching skill:", skillError);
            throw skillError;
        }

        let progressSoFar = skillData?.skill_summary || "Beginner. Knows basic greetings but needs to learn basic vocabulary.";

        // 2. Build the prompt
        let prevIterationText = "no previous iteration";
        if (previous_iteration && Array.isArray(previous_iteration) && previous_iteration.length > 0) {
            prevIterationText = `In the previous iteration the user was given the following sentences and translated them as:\n` +
                JSON.stringify(previous_iteration, null, 2);
        }

        const systemPrompt = `You are an AI language learning tutor.
The German speaking user is learning the ${langName} language. Your job is to create an example sentence that is in line with the users skills.

[Progress so far]
${progressSoFar}

[Previous iteration]
${prevIterationText}

[Task] 
Create EXACTLY 5 sentences (text items) based on the progress so far. 
- For each sentence, provide a unique ID (1, 2, 3, 4, 5).
- If you need to add "difficult" words, create a hint in German.
- Validate the user input from the [Previous iteration] (if provided).
- Return a detailed update for [Progress so far] in the "ProgressSoFar" field.

[Current mode]
${currentMode}

[Input mode]
${req.body.input_mode || 'typing'}

[Correction instructions]
- If [Input mode] is "typing": also check for correct punctuation and case-sensitivity.
- If [Input mode] is "speech": ignore minor punctuation or case errors from the transcribed text.

[Format] 
Return ONLY valid JSON. No markdown wrapping.
{
  "ProgressSoFar": "string (The updated progress summary for the user)",
  "feedback": [
    {
      "id": number, 
      "pass": 1|0|-1, 
      "hint": "string (optional feedback in German)",
      "correction": "string (the perfect answer in the target language, only if pass < 1)."
    }
  ],
  "text": [{"id": number, "text": "string (sentence in ${langName})", "hint": "string|null"}]
}
`;

        const userPrompt = "Please generate the next learning batch according to the system prompt and format.";

        // 3. Call x.ai
        if (!process.env.XAI_API_KEY) {
            return res.status(500).json({ error: "Missing XAI_API_KEY" });
        }

        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: systemPrompt,
            prompt: userPrompt,
        });

        // 4. Parse output
        const cleanText = aiRes.text.replace(/```json\n?|```/g, '').trim();
        let aiOutput;
        try {
            aiOutput = JSON.parse(cleanText);
        } catch (e) {
            console.error("AI Output parse error:", cleanText);
            throw new Error("AI returned invalid JSON");
        }

        // 5. Update user progress if AI suggested an update
        if (aiOutput.ProgressSoFar && typeof aiOutput.ProgressSoFar === 'string' && aiOutput.ProgressSoFar !== "update" && aiOutput.ProgressSoFar !== "null") {
            const { error: upsertError } = await db.from('user_language_skills').upsert({
                user_uid,
                lang_code,
                skill_summary: aiOutput.ProgressSoFar,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_uid, lang_code' });

            if (upsertError) {
                console.error("Failed to update user_language_skills:", upsertError);
            }
        }

        // Return generated data
        return res.status(200).json(aiOutput);

    } catch (e: unknown) {
        console.error("Error in AI Voci generate:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}
