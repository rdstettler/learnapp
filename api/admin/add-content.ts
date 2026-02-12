
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

    console.log(`[add-content] ${req.method} action=${req.body?.action || 'none'} uid=${user_uid}`);

    if (req.method === 'GET') {
        return handleGetContent(req, res, db);
    } else if (req.method === 'POST') {
        // Route by action
        const action = req.body?.action;
        if (action === 'enhance') {
            return handleEnhanceBatch(req, res, db);
        }
        if (action === 'ai-review') {
            return handleAiReview(req, res, db);
        }
        if (action === 'generate') {
            return handleGenerateContent(req, res, db);
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
    console.log(`[GET content] app_id=${app_id}, page=${req.query.page}, limit=${req.query.limit}`);
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
    console.log(`[POST add] app_id=${app_id}, level=${level}, content keys=${content ? Object.keys(content).join(',') : 'null'}`);

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
    console.log(`[PUT update] id=${id}, level=${level}, human_verified=${human_verified}`);

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
    console.log(`[DELETE] id=${id}`);

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
    console.log(`[POST enhance] appId=${appId}, entries=${entries?.length}, hasCustomPrompt=${!!customPrompt}`);

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

/**
 * POST action=generate — Generate new content entries using AI (returns without inserting)
 * Body: { action: 'generate', app_id: string, count?: number, customPrompt?: string }
 * Returns: { entries: object[] }
 */
async function handleGenerateContent(req: VercelRequest, res: VercelResponse, db: DB) {
    const { app_id, count: rawCount, customPrompt } = req.body;

    if (!app_id) {
        return res.status(400).json({ error: 'app_id is required' });
    }

    const count = Math.min(20, Math.max(1, parseInt(rawCount) || 5));
    console.log(`[GENERATE] app_id=${app_id}, count=${count}, hasCustomPrompt=${!!customPrompt}`);

    try {
        // Fetch ALL existing content for this app
        const existing = await db.execute({
            sql: `SELECT id, data FROM app_content WHERE app_id = ?`,
            args: [app_id]
        });
        console.log(`[GENERATE] Found ${existing.rows.length} existing entries`);

        const allItems = existing.rows.map(row => {
            try { return { id: row.id, data: JSON.parse(row.data as string) }; }
            catch { return null; }
        }).filter(Boolean) as { id: number; data: Record<string, unknown> }[];

        if (allItems.length === 0) {
            return res.status(400).json({ error: 'Keine bestehenden Einträge gefunden als Vorlage.' });
        }

        // Use first 3 as full structure examples, condense the rest
        const fullExamples = allItems.slice(0, 3);
        const condensedList = allItems.map(item => condenseSummary(item.data, app_id));

        const systemPrompt = `You are an educational content creator for a Swiss/German learning platform. You generate new learning content based on provided examples. Always use Standard German spelling (with ß). Return ONLY valid JSON, no markdown fences.`;

        const userPrompt = `
App: ${app_id}

STRUCTURE EXAMPLES (follow this exact JSON structure for new entries):
${fullExamples.map((ex, i) => `Example ${i + 1}:\n${JSON.stringify(ex.data, null, 2)}`).join('\n\n')}

ALL ${allItems.length} EXISTING ENTRIES (DO NOT duplicate or closely resemble any of these):
${condensedList.join('\n')}

${customPrompt ? `ADMIN INSTRUCTIONS:\n${customPrompt}\n` : ''}
TASK: Generate exactly ${count} NEW and UNIQUE learning entries for this app. They must:
1. Follow the exact same JSON structure as the examples above
2. Be educationally accurate and factually correct
3. NOT duplicate or closely resemble any existing entry listed above
4. Be appropriate for the app's learning context and difficulty level
5. Be diverse in topic/content

Return a JSON array of exactly ${count} new entries. Return ONLY the JSON array, nothing else.`;

        console.log(`[GENERATE] Calling AI... (prompt length: ${userPrompt.length} chars, ${condensedList.length} existing summaries)`);

        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: systemPrompt,
            prompt: userPrompt
        });

        console.log(`[GENERATE] AI response length: ${aiRes.text.length} chars`);
        const text = aiRes.text.replace(/```json\n?|```/g, '').trim();
        const newEntries: unknown[] = JSON.parse(text);

        if (!Array.isArray(newEntries)) {
            console.error(`[GENERATE] AI returned non-array`);
            return res.status(500).json({ error: 'AI hat kein gültiges Array zurückgegeben' });
        }

        console.log(`[GENERATE] Generated ${newEntries.length} new entries (not yet inserted)`);

        return res.status(200).json({
            generated_count: newEntries.length,
            existing_count: allItems.length,
            entries: newEntries
        });
    } catch (e: unknown) {
        console.error("[GENERATE] Error:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * Create a condensed one-line summary of a content item for dedup context
 */
function condenseSummary(data: Record<string, unknown>, appId: string): string {
    switch (appId) {
        case 'verben':
            return `- ${data['verb'] || '?'}`;
        case 'wortfamilie':
            return `- ${data['nomen'] || '?'} / ${data['verb'] || '?'} / ${data['adjektiv'] || '?'}`;
        case 'wortstaemme':
            return `- Stamm: ${data['stem'] || '?'}`;
        case 'oberbegriffe':
            return `- ${data['category'] || '?'}: ${Array.isArray(data['words']) ? (data['words'] as string[]).join(', ') : '?'}`;
        case 'aehnlichewoerter': {
            const pairs = data['pairs'] as { word1: string; word2: string }[] | undefined;
            return `- ${pairs?.map(p => `${p.word1}/${p.word2}`).join(', ') || '?'}`;
        }
        case 'redewendungen':
            return `- ${data['expression'] || data['redewendung'] || '?'}`;
        case 'kasus':
            return `- ${data['sentence'] || data['question'] || '?'}`;
        case 'dasdass':
        case 'satzzeichen':
        case 'fehler':
            return `- ${((data['sentences'] as string[])?.[0] || data['text'] || data['sentence'] || '?').toString().slice(0, 80)}`;
        default:
            return `- ${JSON.stringify(data).slice(0, 100)}`;
    }
}

/**
 * POST action=ai-review — Targeted AI review of content with optional custom prompt
 * Body: {
 *   action: 'ai-review',
 *   app_id?: string,          // Filter to specific app (optional, null = random across all)
 *   customPrompt?: string,    // Additional review instructions for the AI
 *   mode: 'review' | 'update' | 'extend',
 *   limit?: number            // How many items to process (default 5, max 20)
 * }
 * 
 * Modes:
 * - review: Only flag issues (creates feedback entries for human review)
 * - update: AI reviews and directly updates the content in the DB (preserves IDs)
 * - extend: AI generates new content based on existing patterns (new IDs)
 */
async function handleAiReview(req: VercelRequest, res: VercelResponse, db: DB) {
    const { app_id, customPrompt, mode } = req.body;
    console.log(`[AI-REVIEW] mode=${mode}, app_id=${app_id || 'ALL'}, hasCustomPrompt=${!!customPrompt}`);
    if (customPrompt) console.log(`[AI-REVIEW] customPrompt: "${customPrompt.substring(0, 200)}"`);

    const MAX_BATCH = 50;

    const validModes = ['review', 'update', 'extend'];
    if (!mode || !validModes.includes(mode)) {
        return res.status(400).json({ error: `mode must be one of: ${validModes.join(', ')}` });
    }

    try {
        let sql: string;
        let args: (string | number)[];

        const excludedApps = "('kopfrechnen', 'zeitrechnen', 'umrechnen', 'zahlen-raten', 'flaeche-umfang')";

        if (app_id) {
            // Fetch ALL content for this app
            sql = `SELECT * FROM app_content WHERE app_id = ? ORDER BY ai_reviewed_counter ASC, flag_counter DESC`;
            args = [app_id];
        } else {
            // No app selected: grab a reasonable random sample
            sql = `SELECT * FROM app_content 
                   WHERE ai_generated = 1 AND human_verified = 0 
                   AND app_id NOT IN ${excludedApps}
                   ORDER BY ai_reviewed_counter ASC, flag_counter DESC, RANDOM()
                   LIMIT 10`;
            args = [];
        }

        const appContents = await db.execute({ sql, args });
        const totalCount = appContents.rows.length;
        console.log(`[AI-REVIEW] Fetched ${totalCount} items from DB`);

        if (totalCount === 0) {
            return res.status(200).json({ mode, checked_count: 0, flagged_count: 0, results: [] });
        }

        if (totalCount > MAX_BATCH) {
            console.warn(`[AI-REVIEW] Too many items: ${totalCount} > ${MAX_BATCH}`);
            return res.status(400).json({
                error: `Zu viele Einträge (${totalCount}). Maximum ist ${MAX_BATCH}. Wähle eine spezifischere App oder filtere die Daten.`,
                count: totalCount
            });
        }

        if (mode === 'extend') {
            return await handleExtendMode(req, res, db, app_id, appContents, customPrompt);
        }

        // Build items list for batch AI call
        const batchItems: { id: number; app_id: string; data: Record<string, unknown> }[] = [];
        const skipped: AiReviewResult[] = [];

        for (const row of appContents.rows) {
            const contentId = row.id as number;
            const appIdForRow = row.app_id as string;
            let content: Record<string, unknown> | null = null;
            try { content = JSON.parse(row.data as string); } catch { }

            if (!content) {
                skipped.push({ id: contentId, app_id: appIdForRow, status: 'SKIP', reason: 'Invalid JSON data' });
                continue;
            }
            batchItems.push({ id: contentId, app_id: appIdForRow, data: content });
        }

        console.log(`[AI-REVIEW] Sending ${batchItems.length} items to AI (skipped ${skipped.length}). IDs: [${batchItems.map(i => i.id).join(', ')}]`);

        // Single AI call for all items
        const aiResults = await batchReviewItems(batchItems[0]?.app_id || app_id || 'unknown', batchItems, customPrompt);
        console.log(`[AI-REVIEW] AI returned ${aiResults.length} FAILED items`);

        // Process AI results — apply DB changes
        const results: AiReviewResult[] = [...skipped];

        for (const item of batchItems) {
            const aiResult = aiResults.find(r => r.id === item.id);

            // Increment review counter
            await db.execute({
                sql: "UPDATE app_content SET ai_reviewed_counter = COALESCE(ai_reviewed_counter, 0) + 1 WHERE id = ?",
                args: [item.id]
            });

            if (!aiResult) {
                results.push({ id: item.id, app_id: item.app_id, status: 'PASS' });
                continue;
            }

            if (aiResult.status === 'FAILED') {
                console.log(`[AI-REVIEW] FAILED #${item.id}: ${aiResult.reason}`);
                if (mode === 'update' && aiResult.correction) {
                    const correctedData = typeof aiResult.correction === 'string'
                        ? aiResult.correction
                        : JSON.stringify(aiResult.correction);

                    console.log(`[AI-REVIEW] UPDATE #${item.id} in DB`);
                    await db.execute({
                        sql: `UPDATE app_content SET data = ? WHERE id = ?`,
                        args: [correctedData, item.id]
                    });

                    results.push({
                        id: item.id,
                        app_id: item.app_id,
                        status: 'UPDATED',
                        reason: aiResult.reason,
                        original: item.data,
                        correction: aiResult.correction
                    });
                } else {
                    await db.execute({
                        sql: "UPDATE app_content SET flag_counter = flag_counter + 1 WHERE id = ?",
                        args: [item.id]
                    });

                    await db.execute({
                        sql: `INSERT INTO feedback (user_uid, app_id, session_id, target_id, content, comment, error_type, resolved)
                              VALUES ('system', ?, ?, ?, ?, ?, 'ai_review_flag', 0)`,
                        args: [
                            item.app_id,
                            'admin-review',
                            `app_content:${item.id}`,
                            JSON.stringify(item.data),
                            `AI Review: ${aiResult.reason}. Suggestion: ${JSON.stringify(aiResult.correction)}`
                        ]
                    });

                    results.push({
                        id: item.id,
                        app_id: item.app_id,
                        status: 'FLAGGED',
                        reason: aiResult.reason,
                        original: item.data,
                        correction: aiResult.correction
                    });
                }
            } else {
                results.push({ id: item.id, app_id: item.app_id, status: 'PASS' });
            }
        }

        const flaggedCount = results.filter(r => r.status === 'FLAGGED' || r.status === 'UPDATED').length;
        console.log(`[AI-REVIEW] Done. checked=${batchItems.length}, flagged/updated=${flaggedCount}, pass=${results.filter(r => r.status === 'PASS').length}`);

        return res.status(200).json({
            mode,
            checked_count: batchItems.length,
            flagged_count: flaggedCount,
            results
        });
    } catch (e: unknown) {
        console.error("[AI-REVIEW] Error:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

interface AiReviewResult {
    id: number;
    app_id: string;
    status: string;
    reason?: string;
    original?: Record<string, unknown>;
    correction?: unknown;
}

/**
 * Extend mode: Use existing content as examples and generate new content
 */
async function handleExtendMode(
    req: VercelRequest,
    res: VercelResponse,
    db: DB,
    app_id: string | undefined,
    existingContent: Awaited<ReturnType<DB['execute']>>,
    customPrompt: string | undefined
) {
    // Default: generate as many new entries as there are examples (up to 10)
    const count = Math.min(10, Math.max(1, existingContent.rows.length));
    console.log(`[EXTEND] app_id=${app_id}, existing=${existingContent.rows.length}, generating=${count}`);
    if (!app_id) {
        return res.status(400).json({ error: 'app_id is required for extend mode' });
    }

    // Use up to 5 existing items as examples
    const examples = existingContent.rows.slice(0, 5).map(row => {
        try { return JSON.parse(row.data as string); } catch { return null; }
    }).filter(Boolean);

    if (examples.length === 0) {
        return res.status(400).json({ error: 'No existing content found to use as examples' });
    }

    const systemPrompt = `You are an educational content creator for a Swiss German learning platform. You generate new learning content based on provided examples. Always use Standard German spelling (with ß). Return ONLY valid JSON, no markdown fences.`;

    const userPrompt = `
App: ${app_id}

EXISTING EXAMPLES (use these as a template for structure and style):
${examples.map((ex: unknown, i: number) => `Example ${i + 1}:\n${JSON.stringify(ex, null, 2)}`).join('\n\n')}

${customPrompt ? `ADMIN INSTRUCTIONS:\n${customPrompt}\n` : ''}

TASK: Generate ${count} NEW and UNIQUE learning entries for this app. They must:
1. Follow the exact same JSON structure as the examples
2. Be educationally accurate and factually correct
3. NOT duplicate any existing entries
4. Be appropriate for the app's learning context

Return a JSON array of ${count} new entries. Return ONLY the JSON array, nothing else.`;

    try {
        console.log(`[EXTEND] Calling AI to generate ${count} entries...`);
        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: systemPrompt,
            prompt: userPrompt
        });
        console.log(`[EXTEND] AI response length: ${aiRes.text.length} chars`);

        const text = aiRes.text.replace(/```json\n?|```/g, '').trim();
        const newEntries: unknown[] = JSON.parse(text);

        if (!Array.isArray(newEntries)) {
            console.error(`[EXTEND] AI returned non-array:`, text.substring(0, 200));
            return res.status(500).json({ error: 'AI did not return a valid array' });
        }

        console.log(`[EXTEND] Parsed ${newEntries.length} entries, inserting into DB...`);

        // Insert all new entries
        const insertedIds: number[] = [];
        for (const entry of newEntries) {
            const result = await db.execute({
                sql: `INSERT INTO app_content (app_id, data, ai_generated, human_verified)
                      VALUES (?, ?, 1, 0)`,
                args: [app_id, JSON.stringify(entry)]
            });
            insertedIds.push(Number(result.lastInsertRowid));
        }

        console.log(`[EXTEND] Done. Inserted IDs: [${insertedIds.join(', ')}]`);

        return res.status(200).json({
            mode: 'extend',
            app_id,
            generated_count: newEntries.length,
            inserted_ids: insertedIds,
            entries: newEntries
        });
    } catch (e: unknown) {
        console.error("[EXTEND] Error:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * Batch AI review: send ALL items in a single prompt, get back an array of results
 */
async function batchReviewItems(
    appId: string,
    items: { id: number; app_id: string; data: Record<string, unknown> }[],
    customPrompt?: string
): Promise<{ id: number; status: string; reason?: string; correction?: unknown }[]> {
    const languageRule = "IMPORTANT: Verify that the content uses Standard German spelling conventions (e.g., use 'ß' where appropriate). However, do NOT flag spelling errors in JSON property names (keys). Specifically, treat 'ae' vs 'ä', 'ue' vs 'ü', and 'oe' vs 'ö' as valid variations in keys (e.g., 'praeteritum' is acceptable).";

    const customBlock = customPrompt
        ? `\nADMIN INSTRUCTIONS (highest priority — apply these rules to EVERY item):\n${customPrompt}\n`
        : '';

    const itemsBlock = items.map(item =>
        `{ "_review_id": ${item.id}, "data": ${JSON.stringify(item.data)} }`
    ).join(',\n');

    console.log(`[BATCH-REVIEW] Preparing prompt for ${items.length} items (app=${appId})`);

    const prompt = `
You are a Data Quality Auditor.
Review the following ${items.length} learning tasks for correctness.

App ID: ${appId}
${customBlock}

ITEMS TO REVIEW:
[${itemsBlock}]

For EACH item, verify the question statement and the answer key.
If an item contains errors (spelling, factual, semantic, mathematical) or the answer key is wrong, mark it as FAILED.
Otherwise mark it PASS.

Return a JSON array with one result per item. ONLY include FAILED items (skip PASS items to save space).
Each result must include the original _review_id so I can match it back:
[
  {
    "id": <_review_id>,
    "status": "FAILED",
    "reason": "concise explanation",
    "correction": { <the fully corrected content JSON object, exactly as it should be in the database> }
  }
]

If ALL items pass, return an empty array: []
Return ONLY the JSON array, nothing else.`;

    try {
        console.log(`[BATCH-REVIEW] Calling AI... (prompt length: ${prompt.length} chars)`);
        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: `You are a strict educational content reviewer. ${languageRule}`,
            prompt
        });
        console.log(`[BATCH-REVIEW] AI response length: ${aiRes.text.length} chars`);
        console.log(`[BATCH-REVIEW] Raw response (first 500 chars): ${aiRes.text.substring(0, 500)}`);

        const text = aiRes.text.replace(/```json\n?|```/g, '').trim();
        const parsed = JSON.parse(text);
        const results = Array.isArray(parsed) ? parsed : [];
        console.log(`[BATCH-REVIEW] Parsed ${results.length} FAILED results from AI`);
        return results;
    } catch (e: unknown) {
        console.error("[BATCH-REVIEW] AI call failed:", e);
        // On AI failure, return empty (treat all as PASS rather than crashing)
        return [];
    }
}
