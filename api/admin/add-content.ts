
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../_lib/turso.js';
import { requireAuth, handleCors } from '../_lib/auth.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const user_uid = decoded.uid;
    const db = getTursoClient();

    // Check Admin Status (all operations require admin)
    const user = await db.execute({
        sql: "SELECT is_admin FROM users WHERE uid = ?",
        args: [user_uid as string]
    });

    if (user.rows.length === 0 || !user.rows[0].is_admin) {
        return res.status(403).json({ error: "Forbidden: Admins only" });
    }

    if (req.method === 'GET') {
        return handleGetContent(req, res, db);
    } else if (req.method === 'POST') {
        // Route by action
        const action = req.body?.action;
        if (action === 'enhance') {
            return handleEnhanceBatch(req, res, db);
        }
        return handleAddContent(req, res, db);
    } else if (req.method === 'PUT') {
        return handleUpdateContent(req, res, db);
    } else if (req.method === 'DELETE') {
        return handleDeleteContent(req, res, db);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}

type DB = ReturnType<typeof getTursoClient>;

/**
 * GET — List content for an app, with per-question stats
 * Query params: app_id (required), page (default 1), limit (default 50)
 */
async function handleGetContent(req: VercelRequest, res: VercelResponse, db: DB) {
    const app_id = req.query.app_id as string;
    if (!app_id) {
        return res.status(400).json({ error: 'app_id query param required' });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    try {
        const [contentResult, countResult] = await Promise.all([
            db.execute({
                sql: `SELECT ac.id, ac.app_id, ac.data, ac.level, ac.skill_level,
                             ac.ai_generated, ac.human_verified, ac.flag_counter, ac.created_at,
                             COALESCE(stats.total_attempts, 0) as total_attempts,
                             COALESCE(stats.total_correct, 0) as total_correct,
                             COALESCE(stats.total_wrong, 0) as total_wrong,
                             COALESCE(stats.unique_users, 0) as unique_users
                      FROM app_content ac
                      LEFT JOIN (
                          SELECT app_content_id,
                                 SUM(success_count + failure_count) as total_attempts,
                                 SUM(success_count) as total_correct,
                                 SUM(failure_count) as total_wrong,
                                 COUNT(DISTINCT user_uid) as unique_users
                          FROM user_question_progress
                          GROUP BY app_content_id
                      ) stats ON ac.id = stats.app_content_id
                      WHERE ac.app_id = ?
                      ORDER BY ac.id ASC
                      LIMIT ? OFFSET ?`,
                args: [app_id, limit, offset]
            }),
            db.execute({
                sql: `SELECT COUNT(*) as count FROM app_content WHERE app_id = ?`,
                args: [app_id]
            })
        ]);

        const totalCount = countResult.rows[0].count as number;

        const items = contentResult.rows.map(row => {
            let data = {};
            try { data = JSON.parse(row.data as string); } catch { }

            return {
                id: row.id as number,
                appId: row.app_id as string,
                data,
                level: row.level as number | null,
                skillLevel: row.skill_level as number | null,
                aiGenerated: Boolean(row.ai_generated),
                humanVerified: Boolean(row.human_verified),
                flagCounter: row.flag_counter as number,
                createdAt: row.created_at as string,
                stats: {
                    totalAttempts: row.total_attempts as number,
                    totalCorrect: row.total_correct as number,
                    totalWrong: row.total_wrong as number,
                    uniqueUsers: row.unique_users as number,
                    accuracy: (row.total_attempts as number) > 0
                        ? Math.round(((row.total_correct as number) / (row.total_attempts as number)) * 100)
                        : null
                }
            };
        });

        return res.status(200).json({
            items,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
    } catch (e: unknown) {
        console.error("Error listing content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * POST — Add new content
 */
async function handleAddContent(req: VercelRequest, res: VercelResponse, db: DB) {
    const { app_id, content, level } = req.body;

    if (!app_id || !content) {
        return res.status(400).json({ error: 'Missing required fields (app_id, content)' });
    }

    try {
        const result = await db.execute({
            sql: `INSERT INTO app_content (app_id, data, level, ai_generated, human_verified)
                  VALUES (?, ?, ?, 0, 1)`,
            args: [app_id, JSON.stringify(content), level || null]
        });

        return res.status(200).json({
            success: true,
            id: Number(result.lastInsertRowid),
            message: 'Content added successfully'
        });
    } catch (e: unknown) {
        console.error("Error adding content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * PUT — Update existing content
 */
async function handleUpdateContent(req: VercelRequest, res: VercelResponse, db: DB) {
    const { id, data, level, human_verified } = req.body;

    if (!id || data === undefined) {
        return res.status(400).json({ error: 'Missing required fields (id, data)' });
    }

    try {
        await db.execute({
            sql: `UPDATE app_content 
                  SET data = ?, level = ?, human_verified = ?, flag_counter = 0
                  WHERE id = ?`,
            args: [
                typeof data === 'string' ? data : JSON.stringify(data),
                level ?? null,
                human_verified !== undefined ? (human_verified ? 1 : 0) : 1,
                id
            ]
        });

        return res.status(200).json({ success: true });
    } catch (e: unknown) {
        console.error("Error updating content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * DELETE — Remove content by id
 */
async function handleDeleteContent(req: VercelRequest, res: VercelResponse, db: DB) {
    const id = req.query.id || req.body?.id;

    if (!id) {
        return res.status(400).json({ error: 'Missing id' });
    }

    try {
        await db.execute({
            sql: `DELETE FROM app_content WHERE id = ?`,
            args: [id]
        });

        return res.status(200).json({ success: true });
    } catch (e: unknown) {
        console.error("Error deleting content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * POST action=enhance — AI-enhance a batch of sparse entries using a template
 * Body: { action: 'enhance', template: object, entries: {id, data}[], customPrompt?: string, appId: string }
 * Returns: { results: { id, original, enhanced, error? }[] }
 */
async function handleEnhanceBatch(req: VercelRequest, res: VercelResponse, db: DB) {
    const { template, entries, customPrompt, appId } = req.body;

    if (!template || !entries || !Array.isArray(entries) || entries.length === 0 || !appId) {
        return res.status(400).json({ error: 'Missing required fields (template, entries[], appId)' });
    }

    if (entries.length > 10) {
        return res.status(400).json({ error: 'Max 10 entries per batch' });
    }

    const results: { id: number; original: object; enhanced: object | null; error?: string }[] = [];

    // Find which keys the template has that each entry is missing
    const templateKeys = collectKeyPaths(template);

    for (const entry of entries) {
        const entryKeys = collectKeyPaths(entry.data);
        const missingKeys = templateKeys.filter(k => !entryKeys.includes(k));

        if (missingKeys.length === 0) {
            results.push({ id: entry.id, original: entry.data, enhanced: null, error: 'Already complete' });
            continue;
        }

        try {
            const enhanced = await enhanceEntry(appId, template, entry.data, missingKeys, customPrompt);
            results.push({ id: entry.id, original: entry.data, enhanced });
        } catch (e: unknown) {
            results.push({
                id: entry.id,
                original: entry.data,
                enhanced: null,
                error: e instanceof Error ? e.message : 'AI enhancement failed'
            });
        }
    }

    return res.status(200).json({ results });
}

/**
 * Recursively collect all key paths from an object (e.g. "typicalMistakes.praeteritum.ich")
 */
function collectKeyPaths(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [];
    const paths: string[] = [];
    for (const key of Object.keys(obj as Record<string, unknown>)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        paths.push(fullPath);
        paths.push(...collectKeyPaths((obj as Record<string, unknown>)[key], fullPath));
    }
    return paths;
}

/**
 * Call Grok to enhance a single entry based on a template
 */
async function enhanceEntry(
    appId: string,
    template: object,
    entry: object,
    missingKeys: string[],
    customPrompt?: string
): Promise<object> {
    const systemPrompt = `You are an educational content enhancer for a Swiss German learning platform. You enhance existing content entries by adding missing properties based on a provided template. Always use Standard German spelling (with ß). Return ONLY valid JSON, no markdown fences.`;

    const userPrompt = `
App: ${appId}

TEMPLATE (gold standard, all desired properties):
${JSON.stringify(template, null, 2)}

ENTRY TO ENHANCE:
${JSON.stringify(entry, null, 2)}

MISSING PROPERTIES (dot-notation):
${missingKeys.join('\n')}

${customPrompt ? `IMPORTANT INSTRUCTIONS FROM ADMIN:\n${customPrompt}\n` : ''}
TASK: Return the enhanced entry as a complete JSON object. Keep all existing properties unchanged. Add the missing properties with correct, educationally accurate values appropriate for this specific entry. If a missing property does NOT make sense for this particular entry (based on the admin instructions or the entry content), you may omit it — do NOT force-add nonsensical data.

Return ONLY the JSON object, nothing else.`;
    console.log("Enhancement prompt:", { systemPrompt, userPrompt });
    const aiRes = await generateText({
        model: xai('grok-4-1-fast-reasoning'),
        system: systemPrompt,
        prompt: userPrompt
    });
    console.log("Raw AI response:", aiRes.text);
    const text = aiRes.text.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(text);
}
