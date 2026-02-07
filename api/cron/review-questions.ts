import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../_lib/turso.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Only allow GET requests (for Cron)
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Cron security check (optional but recommended)
    // if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    //     return res.status(401).json({ error: 'Unauthorized' });
    // }

    const db = getTursoClient();
    const limit = parseInt(req.query.limit as string) || 1;

    try {
        const updates = [];
        const appContents = await db.execute({
            sql: `
            SELECT * FROM app_content 
            WHERE ai_generated = 1 AND human_verified = 0 AND app_id NOT IN ('kopfrechnen', 'zeitrechnen', 'umrechnen', 'zahlen-raten', 'flaeche-umfang')
            ORDER BY ai_reviewed_counter ASC, flag_counter DESC, RANDOM()
            LIMIT ?
        `,
            args: [limit]
        });

        for (const row of appContents.rows) {
            let content = null;
            try { content = JSON.parse(row.data as string); } catch (e) { }
            const app_id = row.app_id as string;

            // Always increment review counter
            await db.execute({
                sql: "UPDATE app_content SET ai_reviewed_counter = COALESCE(ai_reviewed_counter, 0) + 1 WHERE id = ?",
                args: [row.id]
            });

            if (!content) continue;

            const result = await reviewItem(app_id, content);

            if (result.status === "FAILED") {
                console.warn(`[Quality Check] Flagging app_content ${row.id}: ${result.reason}`);

                // Increment flag_counter
                await db.execute({
                    sql: "UPDATE app_content SET flag_counter = flag_counter + 1 WHERE id = ?",
                    args: [row.id]
                });

                // Log the correction/issue for human review
                await db.execute({
                    sql: `INSERT INTO feedback (user_uid, app_id, session_id, target_id, content, comment, error_type, resolved)
                          VALUES ('system', ?, ?, ?, ?, ?, 'ai_review_flag', 0)`,
                    args: [app_id, 'cron-job', `app_content:${row.id}`, JSON.stringify(content), `AI Review: ${result.reason}. Suggestion: ${JSON.stringify(result.correction)}`]
                });

                updates.push({ source: 'app_content', id: row.id, status: "FAILED", reason: result.reason });
            } else {
                updates.push({ source: 'app_content', id: row.id, status: "PASS" });
            }
        }

        return res.status(200).json({
            checked_count: appContents.rows.length,
            results: updates
        });

    } catch (e: any) {
        console.error("Error in generic review:", e.message);
        return res.status(500).json({ error: e.message });
    }
}

async function reviewItem(appId: string, content: any, languageVariant: 'swiss' | 'standard' = 'swiss'): Promise<{ status: string, reason?: string, correction?: string }> {
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
    } catch (e: any) {
        console.error("AI Generation Failed", e);
        return { status: "ERROR", reason: e.message };
    }
}
