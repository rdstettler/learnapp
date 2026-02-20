
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from '../_lib/supabase.js';
import { requireAuth, handleCors } from '../_lib/auth.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const user_uid = decoded.uid;
    const db = getSupabaseClient();

    // Check Admin Status (all operations require admin)
    const { data: user, error: userError } = await db
        .from('users')
        .select('is_admin')
        .eq('uid', user_uid)
        .single();

    if (userError || !user || !user.is_admin) {
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

async function handleGetContent(req: VercelRequest, res: VercelResponse, db: any) {
    const app_id = req.query.app_id as string;
    console.log(`[GET content] app_id=${app_id}, page=${req.query.page}, limit=${req.query.limit}`);
    if (!app_id) {
        return res.status(400).json({ error: 'app_id query param required' });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    try {
        // Fetch content
        const { data: items, count: totalCount, error } = await db
            .from('app_content')
            .select('*', { count: 'exact' })
            .eq('app_id', app_id)
            .order('id', { ascending: true })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        // Fetch stats for these items
        const itemIds = items.map((i: any) => i.id);
        const { data: statsRows } = await db
            .from('user_question_progress')
            .select('app_content_id, success_count, failure_count, user_uid')
            .in('app_content_id', itemIds);

        // Aggregate stats in memory
        const statsMap = new Map<number, { attempts: number, correct: number, wrong: number, users: Set<string> }>();
        if (statsRows) {
            for (const s of statsRows) {
                const cid = s.app_content_id;
                const entry = statsMap.get(cid) || { attempts: 0, correct: 0, wrong: 0, users: new Set() };
                entry.attempts += (s.success_count + s.failure_count);
                entry.correct += s.success_count;
                entry.wrong += s.failure_count;
                if (s.user_uid) entry.users.add(s.user_uid); // Count distinct users
                statsMap.set(cid, entry);
            }
        }

        const enrichedItems = items.map((row: any) => {
            let data = {};
            try { data = JSON.parse(row.data as string); } catch { }
            const stats = statsMap.get(row.id) || { attempts: 0, correct: 0, wrong: 0, users: new Set() };

            return {
                id: row.id,
                appId: row.app_id,
                data,
                level: row.level,
                skillLevel: row.skill_level,
                aiGenerated: Boolean(row.ai_generated),
                humanVerified: Boolean(row.human_verified),
                flagCounter: row.flag_counter,
                createdAt: row.created_at,
                stats: {
                    totalAttempts: stats.attempts,
                    totalCorrect: stats.correct,
                    totalWrong: stats.wrong,
                    uniqueUsers: stats.users.size,
                    accuracy: stats.attempts > 0 ? Math.round((stats.correct / stats.attempts) * 100) : null
                }
            };
        });

        return res.status(200).json({
            items: enrichedItems,
            pagination: {
                page,
                limit,
                totalCount: totalCount || 0,
                totalPages: Math.ceil((totalCount || 0) / limit)
            }
        });
    } catch (e: unknown) {
        console.error("Error listing content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleAddContent(req: VercelRequest, res: VercelResponse, db: any) {
    const { app_id, content, level } = req.body;

    if (!app_id || !content) {
        return res.status(400).json({ error: 'Missing required fields (app_id, content)' });
    }

    try {
        const { data, error } = await db.from('app_content').insert({
            app_id,
            data: JSON.stringify(content),
            level: level || null,
            ai_generated: false,
            human_verified: true
        }).select('id').single();

        if (error) throw error;

        return res.status(200).json({
            success: true,
            id: data.id,
            message: 'Content added successfully'
        });
    } catch (e: unknown) {
        console.error("Error adding content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleUpdateContent(req: VercelRequest, res: VercelResponse, db: any) {
    const { id, data, level, human_verified } = req.body;

    if (!id || data === undefined) {
        return res.status(400).json({ error: 'Missing required fields (id, data)' });
    }

    try {
        const { error } = await db.from('app_content')
            .update({
                data: typeof data === 'string' ? data : JSON.stringify(data),
                level: level ?? null,
                human_verified: human_verified !== undefined ? human_verified : true,
                flag_counter: 0
            })
            .eq('id', id);

        if (error) throw error;
        return res.status(200).json({ success: true });
    } catch (e: unknown) {
        console.error("Error updating content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleDeleteContent(req: VercelRequest, res: VercelResponse, db: any) {
    const id = req.query.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    try {
        const { error } = await db.from('app_content').delete().eq('id', id);
        if (error) throw error;
        return res.status(200).json({ success: true });
    } catch (e: unknown) {
        console.error("Error deleting content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleGenerateContent(req: VercelRequest, res: VercelResponse, db: any) {
    const { app_id, count: rawCount, customPrompt } = req.body;
    if (!app_id) return res.status(400).json({ error: 'app_id is required' });

    const count = Math.min(20, Math.max(1, parseInt(rawCount) || 5));

    try {
        const { data: existing, error } = await db.from('app_content')
            .select('id, data')
            .eq('app_id', app_id)
            .limit(100);

        if (error) throw error;

        const allItems = (existing || []).map((row: any) => {
            try { return { id: row.id, data: JSON.parse(row.data as string) }; }
            catch { return null; }
        }).filter(Boolean) as { id: number; data: Record<string, unknown> }[];

        if (allItems.length === 0) {
            return res.status(400).json({ error: 'Keine bestehenden Einträge gefunden als Vorlage.' });
        }

        const fullExamples = allItems.slice(0, 3);
        const condensedList = allItems.map(item => condenseSummary(item.data, app_id));

        const systemPrompt = `You are an educational content creator for a Swiss/German learning platform. You generate new learning content based on provided examples. Always use Standard German spelling (with ß). Return ONLY valid JSON, no markdown fences.`;

        const userPrompt = `
App: ${app_id}

STRUCTURE EXAMPLES (follow this exact JSON structure):
${fullExamples.map((ex, i) => `Example ${i + 1}:\n${JSON.stringify(ex.data, null, 2)}`).join('\n\n')}

EXISTING ENTRIES (DO NOT duplicate):
${condensedList.join('\n')}

${customPrompt ? `ADMIN INSTRUCTIONS:\n${customPrompt}\n` : ''}
TASK: Generate exactly ${count} NEW and UNIQUE learning entries.
Return a JSON array of exactly ${count} new entries.`;

        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: systemPrompt,
            prompt: userPrompt
        });

        const text = aiRes.text.replace(/```json\n?|```/g, '').trim();
        const newEntries: unknown[] = JSON.parse(text);

        if (!Array.isArray(newEntries)) return res.status(500).json({ error: 'AI hat kein gültiges Array zurückgegeben' });

        return res.status(200).json({
            generated_count: newEntries.length,
            existing_count: existing?.length,
            entries: newEntries
        });
    } catch (e: unknown) {
        console.error("[GENERATE] Error:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleEnhanceBatch(req: VercelRequest, res: VercelResponse, db: any) {
    const { template, entries, customPrompt, appId } = req.body;
    console.log(`[POST enhance] appId=${appId}, entries=${entries?.length}, hasCustomPrompt=${!!customPrompt}`);

    if (!template || !entries || !Array.isArray(entries) || entries.length === 0 || !appId) {
        return res.status(400).json({ error: 'Missing required fields (template, entries[], appId)' });
    }

    if (entries.length > 10) {
        return res.status(400).json({ error: 'Max 10 entries per batch' });
    }

    const results: { id: number; original: object; enhanced: object | null; error?: string }[] = [];

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

async function handleAiReview(req: VercelRequest, res: VercelResponse, db: any) {
    const { app_id, customPrompt, mode } = req.body;
    console.log(`[AI-REVIEW] mode=${mode}, app_id=${app_id || 'ALL'}, hasCustomPrompt=${!!customPrompt}`);

    const MAX_BATCH = 50;
    const validModes = ['review', 'update', 'extend'];

    if (!mode || !validModes.includes(mode)) {
        return res.status(400).json({ error: `mode must be one of: ${validModes.join(', ')}` });
    }

    try {
        let query = db.from('app_content')
            .select('*')
            .order('ai_reviewed_counter', { ascending: true })
            .order('flag_counter', { ascending: false });

        const excludedApps = ['kopfrechnen', 'zeitrechnen', 'umrechnen', 'zahlen-raten', 'flaeche-umfang'];

        if (app_id) {
            query = query.eq('app_id', app_id);
        } else {
            query = query.eq('ai_generated', true)
                .eq('human_verified', false)
                .not('app_id', 'in', `(${excludedApps.join(',')})`)
                .limit(10);
        }

        const { data: rows, error } = await query;
        if (error) throw error;

        const totalCount = rows.length;
        if (totalCount === 0) {
            return res.status(200).json({ mode, checked_count: 0, flagged_count: 0, results: [] });
        }

        if (totalCount > MAX_BATCH) {
            // Note: Supabase limit handles this, but if logic changed...
        }

        if (mode === 'extend') {
            return await handleExtendMode(req, res, db, app_id, rows, customPrompt);
        }

        // Build items list
        const skipped: any[] = [];
        const batchItems = [];

        for (const row of rows) {
            let content = null;
            try { content = JSON.parse(row.data as string); } catch { }

            if (!content) {
                skipped.push({ id: row.id, app_id: row.app_id, status: 'SKIP', reason: 'Invalid JSON' });
                continue;
            }
            batchItems.push({ id: row.id, app_id: row.app_id, data: content, ai_reviewed_counter: row.ai_reviewed_counter });
        }

        if (batchItems.length === 0) {
            return res.status(200).json({ mode, checked_count: 0, flagged_count: 0, results: skipped });
        }

        // AI Call
        const aiResults = await batchReviewItems(batchItems[0]?.app_id || app_id || 'unknown', batchItems, customPrompt);
        const results = [...skipped];

        for (const item of batchItems) {
            const aiResult = aiResults.find((r: any) => r.id === item.id);

            // Increment review counter (read-modify-write as we have old value)
            const newCounter = (item.ai_reviewed_counter || 0) + 1;
            await db.from('app_content').update({ ai_reviewed_counter: newCounter }).eq('id', item.id);

            if (!aiResult) {
                results.push({ id: item.id, app_id: item.app_id, status: 'PASS' });
                continue;
            }

            if (aiResult.status === 'FAILED') {
                if (mode === 'update' && aiResult.correction) {
                    await db.from('app_content')
                        .update({ data: JSON.stringify(aiResult.correction) })
                        .eq('id', item.id);

                    results.push({
                        id: item.id,
                        app_id: item.app_id,
                        status: 'UPDATED',
                        reason: aiResult.reason,
                        original: item.data,
                        correction: aiResult.correction
                    });
                } else {
                    // Flag
                    const { data: current } = await db.from('app_content').select('flag_counter').eq('id', item.id).single();
                    const newFlag = (current?.flag_counter || 0) + 1;

                    await db.from('app_content').update({ flag_counter: newFlag }).eq('id', item.id);

                    await db.from('feedback').insert({
                        user_uid: 'system',
                        app_id: item.app_id,
                        session_id: 'admin-review',
                        target_id: `app_content:${item.id}`,
                        content: JSON.stringify(item.data),
                        comment: `AI Review: ${aiResult.reason}. Suggestion: ${JSON.stringify(aiResult.correction)}`,
                        error_type: 'ai_review_flag',
                        resolved: false
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

async function handleExtendMode(req: VercelRequest, res: VercelResponse, db: any, app_id: string | undefined, rows: any[], customPrompt: string | undefined) {
    const count = Math.min(10, Math.max(1, rows.length));
    if (!app_id) return res.status(400).json({ error: 'app_id is required' });

    const examples = rows.slice(0, 5).map((row: any) => {
        try { return JSON.parse(row.data as string); } catch { return null; }
    }).filter(Boolean);

    if (examples.length === 0) return res.status(400).json({ error: 'No examples found' });

    const systemPrompt = `You are an educational content creator for a Swiss German learning platform. You generate new learning content based on provided examples. Always use Standard German spelling (with ß). Return ONLY valid JSON, no markdown fences.`;
    const userPrompt = `
App: ${app_id}
EXAMPLES:
${examples.map((ex: any, i: number) => `Example ${i + 1}:\n${JSON.stringify(ex, null, 2)}`).join('\n\n')}

${customPrompt ? `ADMIN INSTRUCTIONS:\n${customPrompt}\n` : ''}

TASK: Generate ${count} NEW and UNIQUE learning entries.
Return a JSON array of ${count} new entries.`;

    try {
        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: systemPrompt,
            prompt: userPrompt
        });

        const text = aiRes.text.replace(/```json\n?|```/g, '').trim();
        const newEntries: unknown[] = JSON.parse(text);

        if (!Array.isArray(newEntries)) throw new Error('AI did not return array');

        const insertedIds = [];
        for (const entry of newEntries) {
            const { data, error } = await db.from('app_content').insert({
                app_id,
                data: JSON.stringify(entry),
                ai_generated: true,
                human_verified: false
            }).select('id').single();
            if (!error && data) insertedIds.push(data.id);
        }

        return res.status(200).json({
            mode: 'extend',
            app_id,
            generated_count: newEntries.length,
            inserted_ids: insertedIds,
            entries: newEntries
        });

    } catch (e: unknown) {
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Error' });
    }
}

function condenseSummary(data: Record<string, unknown>, appId: string): string {
    switch (appId) {
        case 'verben': return `- ${data['verb'] || '?'}`;
        case 'wortfamilie': return `- ${data['nomen'] || '?'} / ${data['verb'] || '?'} / ${data['adjektiv'] || '?'}`;
        case 'wortstaemme': return `- Stamm: ${data['stem'] || '?'}`;
        case 'oberbegriffe': return `- ${data['category'] || '?'}`;
        default: return `- ${JSON.stringify(data).slice(0, 100)}`;
    }
}

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

async function enhanceEntry(appId: string, template: object, entry: object, missingKeys: string[], customPrompt?: string): Promise<object> {
    const systemPrompt = `You are an educational content enhancer. Add missing properties based on a template. Standard German spelling. Return JSON.`;
    const userPrompt = `App: ${appId}\nTEMPLATE: ${JSON.stringify(template)}\nENTRY: ${JSON.stringify(entry)}\nMISSING: ${missingKeys.join(', ')}\n${customPrompt || ''}`;

    const aiRes = await generateText({
        model: xai('grok-4-1-fast-reasoning'),
        system: systemPrompt,
        prompt: userPrompt
    });
    return JSON.parse(aiRes.text.replace(/```json\n?|```/g, '').trim());
}

async function batchReviewItems(appId: string, items: any[], customPrompt?: string): Promise<any[]> {
    const prompt = `Review ${items.length} items for ${appId}. Return ONLY JSON array of FAILED items with corrections. ID refer to _review_id.
    ITEMS: ${JSON.stringify(items.map(i => ({ _review_id: i.id, data: i.data })))}
    ${customPrompt || ''}`;

    try {
        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: "Data Quality Auditor. Standard German.",
            prompt
        });
        const res = JSON.parse(aiRes.text.replace(/```json\n?|```/g, '').trim());
        return Array.isArray(res) ? res : [];
    } catch {
        return [];
    }
}
