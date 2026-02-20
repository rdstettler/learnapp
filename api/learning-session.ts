import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from './_lib/supabase.js';
import { requireAuth, handleCors } from './_lib/auth.js';
import { replaceEszett } from './_lib/text-utils.js';
import crypto from 'node:crypto';

interface AISessionResponse {
    topic: string;
    text: string;
    theory?: { title: string; content: string }[];
    tasks?: { app_id: string; content: Record<string, unknown> }[];
}

interface AIPlanResponse {
    title: string;
    description: string;
    days: {
        day: number;
        focus: string;
        task_ids: number[];
    }[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const db = getSupabaseClient();
    const user_uid = decoded.uid;

    // Route: plan vs session
    const type = req.query.type || req.body?.type;
    if (type === 'plan') {
        return handlePlan(req, res, user_uid);
    }

    if (req.method === 'GET') {
        try {
            // 1. Find the active session (latest session that has at least one pristine task)
            const { data: activeSessionData } = await db
                .from('learning_session')
                .select('session_id')
                .eq('user_uid', user_uid)
                .eq('pristine', true)
                .order('created_at', { ascending: false })
                .limit(1);

            if (activeSessionData && activeSessionData.length > 0) {
                const sessionId = activeSessionData[0].session_id;

                // 2. Fetch ALL tasks for this session (both done and todo)
                const { data: sessionRows, error: sessionError } = await db
                    .from('learning_session')
                    .select('*')
                    .eq('session_id', sessionId)
                    .order('order_index', { ascending: true });

                if (sessionError) throw sessionError;

                const firstRow = sessionRows[0];
                const sessionData = {
                    session_id: sessionId,
                    topic: firstRow.topic,
                    text: firstRow.text,
                    theory: firstRow.theory ? JSON.parse(firstRow.theory as string) : [],
                    created_at: firstRow.created_at,
                    tasks: sessionRows.map(row => ({
                        id: row.id, // ID needed for completion
                        app_id: row.app_id,
                        pristine: row.pristine,
                        content: JSON.parse(row.content as string)
                    }))
                };

                const langFormat = req.query['language-format'] || req.body['language-format'];
                if (langFormat === 'swiss') {
                    // Recursive replace
                    return res.status(200).json(replaceEszett(sessionData));
                }

                return res.status(200).json(sessionData);
            }

            // Check if user has enough question progress data to generate a session
            const { count, error: countError } = await db
                .from('user_question_progress')
                .select('*', { count: 'exact', head: true })
                .eq('user_uid', user_uid);

            if (countError) throw countError;

            if ((count || 0) < 3) {
                // Determine suggested apps: fetch all learning apps and pick 5 random
                const { data: learningApps } = await db
                    .from('apps')
                    .select('*')
                    .eq('type', 'learning');

                let suggestedApps: any[] = [];
                if (learningApps) {
                    // Shuffle and take 5
                    suggestedApps = learningApps
                        .sort(() => 0.5 - Math.random())
                        .slice(0, 5)
                        .map(row => {
                            let tags = [];
                            try {
                                tags = JSON.parse(row.tags as string);
                            } catch (e) {
                                // ignore
                            }
                            return { ...row, tags, featured: Boolean(row.featured) };
                        });
                }

                return res.status(404).json({
                    message: "Not enough data",
                    suggestedApps: suggestedApps
                });
            }

            // Ready to generate
            return res.status(200).json(null);

        } catch (e: unknown) {
            console.error("Error in GET /api/learning-session:", e);
            return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
        }
    }

    if (req.method === 'PUT') {
        const { taskId, taskIds } = req.body;

        if (!taskId && (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0)) {
            return res.status(400).json({ error: "Missing taskId or taskIds" });
        }

        try {
            if (taskIds && Array.isArray(taskIds) && taskIds.length > 0) {
                const { error } = await db.from('learning_session')
                    .update({ pristine: false })
                    .in('id', taskIds)
                    .eq('user_uid', user_uid);
                if (error) throw error;
            } else {
                const { error } = await db.from('learning_session')
                    .update({ pristine: false })
                    .eq('id', taskId)
                    .eq('user_uid', user_uid);
                if (error) throw error;
            }

            return res.status(200).json({ success: true });
        } catch (e: unknown) {
            console.error("Error in PUT /api/learning-session:", e);
            return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
        }
    }

    if (req.method === 'POST') {
        try {
            // 1-2. Fetch progress, apps, and language preference in parallel
            const [progressResult, appsResult, userLangRes] = await Promise.all([
                db.from('user_question_progress')
                    .select(`
                    app_id, app_content_id, success_count, failure_count,
                    app_content!inner(data)
                  `)
                    .eq('user_uid', user_uid)
                    .order('failure_count', { ascending: false })
                    .order('success_count', { ascending: true }),

                db.from('apps').select('id, name, description, data_structure').eq('type', 'learning'),

                db.from('users').select('language_variant').eq('uid', user_uid).single()
            ]);

            const progressRows = progressResult.data || [];
            const appsRows = appsResult.data || [];

            if (progressRows.length === 0) {
                return res.status(400).json({ error: "Keine Lerndaten vorhanden. Beantworte zuerst ein paar Fragen in den Apps." });
            }
            const appsMap = new Map(appsRows.map(a => [a.id, a]));

            // 3. Analyze weak areas from question progress
            const weakAreas: { app_id: string; app_name: string; failures: number; successes: number; preview: string }[] = [];
            for (const row of progressRows) {
                const failures = row.failure_count as number;
                const successes = row.success_count as number;
                const app = appsMap.get(row.app_id as string);
                if (!app) continue;

                // Include questions where user struggles or hasn't mastered yet
                if (failures > 0 || successes < 3) {
                    let preview = '';
                    try {
                        const contentData = (row.app_content as any)?.data;
                        const parsed = JSON.parse(contentData as string);
                        preview = JSON.stringify(parsed).slice(0, 120);
                    } catch { }

                    weakAreas.push({
                        app_id: row.app_id as string,
                        app_name: app.name as string,
                        failures,
                        successes,
                        preview
                    });
                }
            }

            // Summarize per-app stats
            const appStats = new Map<string, { total: number; weak: number; mastered: number }>();
            for (const row of progressRows) {
                const appId = row.app_id as string;
                const stats = appStats.get(appId) || { total: 0, weak: 0, mastered: 0 };
                stats.total++;
                const f = row.failure_count as number;
                const s = row.success_count as number;
                if (f > s) stats.weak++;
                if (s >= 3 && f === 0) stats.mastered++;
                appStats.set(appId, stats);
            }

            const performanceSummary = Array.from(appStats.entries()).map(([appId, stats]) => {
                const app = appsMap.get(appId);
                return `- ${app?.name || appId}: ${stats.total} questions attempted, ${stats.weak} struggling, ${stats.mastered} mastered`;
            }).join("\n");

            const weakSamples = weakAreas.slice(0, 15).map((w, i) =>
                `${i + 1}. App: ${w.app_name} (${w.app_id}), Failures: ${w.failures}, Successes: ${w.successes}, Content: ${w.preview}`
            ).join("\n");

            const availableApps = appsRows.map(a =>
                `- ID: ${a.id}, Name: ${a.name}, Description: ${a.description}, Target Structure JSON Schema: ${a.data_structure || '{}'}`
            ).join("\n");

            // 4. Use pre-fetched language preference
            let languageInstruction = "IMPORTANT: Use Swiss German spelling conventions (e.g., 'ss' instead of 'ß').";
            if (userLangRes.data && userLangRes.data.language_variant === 'standard') {
                languageInstruction = "IMPORTANT: Use Standard German spelling conventions (e.g., use 'ß' where appropriate).";
            }

            const systemPrompt = `You are an educational AI assistant creating a personalized learning session.
${languageInstruction}
Available Apps:
${availableApps}

You will receive the user's performance summary and their weak areas.
Create a learning session with 3-5 tasks that target their weaknesses.
Generate NEW content (not copies) that practices the same skills where the user struggles.

IMPORTANT: Return ONLY valid JSON matching the following structure.
{
    "topic": "string (motivating session title)",
    "text": "string (short explanation of what this session focuses on)",
    "theory": [
        {
            "title": "string",
            "content": "string (markdown allowed, explain concepts the user struggles with)"
        }
    ],
    "tasks": [
        {
            "app_id": "string (must be one of the available app IDs)",
            "content": { ... object matching the app's Target Structure JSON Schema exactly ... }
        }
    ]
}`;

            const userPrompt = `Here is the user's learning performance:

${performanceSummary}

Here are specific questions the user is struggling with (for reference — generate SIMILAR but NEW content):
${weakSamples}

Create a personalized learning session with 3-5 tasks targeting their weak areas.
For each task, generate SPECIFIC content that follows the app's Target Structure JSON Schema exactly.
Create a motivating header (topic) and a short explanation (text).
ADDITIONALLY, provide "theory" cards that explain the concepts the user struggles with.`;

            // 5. Call AI (xAI Grok) — lazy import to avoid cold-start tax on GET/PUT
            if (!process.env.XAI_API_KEY) {
                console.error("Missing XAI_API_KEY");
                return res.status(500).json({ error: "Server Configuration Error: Missing API Key" });
            }

            const [{ xai }, { generateText }] = await Promise.all([
                import('@ai-sdk/xai'),
                import('ai')
            ]);

            let text = "";
            try {
                const aiRes = await generateText({
                    // DO NOT CHANGE THE MODEL!!!!!
                    model: xai('grok-4-1-fast-reasoning'),
                    system: systemPrompt,
                    prompt: userPrompt,
                });
                text = aiRes.text;
            } catch (aiError: unknown) {
                console.error("AI Generation Failed:", aiError);
                return res.status(500).json({ error: `AI Provider Error: ${aiError instanceof Error ? aiError.message : 'Unknown error'}` });
            }

            // 6. Parse JSON
            let object: AISessionResponse;
            try {
                const cleanText = text.replace(/```json\n?|```/g, '').trim();
                object = JSON.parse(cleanText);
            } catch (parseError) {
                console.error("AI returned invalid JSON:", text);
                return res.status(500).json({ error: "Failed to parse AI response" });
            }

            // 7. Save Tasks (batched — single round-trip instead of N)
            const sessionId = crypto.randomUUID();
            const theoryStr = JSON.stringify(object.theory || []);
            const validTasks = (object.tasks || []).filter(t => t.content);

            let taskIds: number[] = [];
            if (validTasks.length > 0) {
                const tasksToInsert = validTasks.map((task, idx) => ({
                    user_uid,
                    session_id: sessionId,
                    app_id: task.app_id,
                    content: JSON.stringify(task.content),
                    order_index: idx + 1,
                    pristine: true,
                    topic: object.topic,
                    text: object.text,
                    theory: theoryStr
                }));

                const { data: insertedTasks, error } = await db
                    .from('learning_session')
                    .insert(tasksToInsert)
                    .select('id');

                if (error) throw error;
                taskIds = insertedTasks.map(r => r.id);
            }

            // 8. Log to ai_logs
            try {
                await db.from('ai_logs').insert({
                    user_uid,
                    session_id: sessionId,
                    prompt: userPrompt,
                    system_prompt: systemPrompt,
                    response: text,
                    provider: 'xai',
                    model: 'grok-4-1-fast-reasoning'
                });
            } catch (logError) {
                console.error("Failed to log AI interaction:", logError);
            }

            // 9. Build response from in-memory data (no redundant re-fetch)
            if (validTasks.length === 0) {
                return res.status(200).json({
                    session_id: sessionId,
                    tasks: [],
                    topic: "No new tasks",
                    text: "You have mastered all proposed topics! Great job."
                });
            }

            const finalData = {
                session_id: sessionId,
                topic: object.topic,
                text: object.text,
                theory: object.theory || [],
                created_at: new Date().toISOString(),
                tasks: validTasks.map((task, idx) => ({
                    id: taskIds[idx] != null ? Number(taskIds[idx]) : null,
                    app_id: task.app_id,
                    pristine: 1,
                    content: task.content
                }))
            };

            const langFormat = req.query['language-format'] || req.body['language-format'];
            if (langFormat === 'swiss') {
                return res.status(200).json(replaceEszett(finalData));
            }
            return res.status(200).json(finalData);

        } catch (e: unknown) {
            console.error("Error generating session:", e);
            const msg = e instanceof Error ? e.message : String(e);
            return res.status(500).json({ error: `Server Error: ${msg}` });
        }
    }

    res.status(405).json({ error: "Method not allowed" });
}

// ═══════════════════════════════════════════════════════════════
//  LEARNING PLAN — AI-curated plan from EXISTING questions
// ═══════════════════════════════════════════════════════════════

async function handlePlan(req: VercelRequest, res: VercelResponse, user_uid: string) {
    const db = getSupabaseClient();
    // GET  → fetch active plan (or return null / not-enough-data)
    // POST → generate a new plan via AI
    // PUT  → mark task(s) as completed

    if (req.method === 'GET') {
        try {
            // 1. Find active plan
            const { data: activePlanData } = await db
                .from('learning_plans')
                .select('*')
                .eq('user_uid', user_uid)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1);

            if (!activePlanData || activePlanData.length === 0) {
                // Check if there's enough data to generate
                const { count } = await db
                    .from('user_question_progress')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_uid', user_uid);

                if ((count || 0) < 5) {
                    return res.status(404).json({
                        message: "not_enough_data",
                        hint: "Beantworte mindestens 5 Fragen in verschiedenen Apps, damit ein Lernplan erstellt werden kann."
                    });
                }

                return res.status(200).json(null); // Ready to generate
            }

            const plan = activePlanData[0];
            const planId = plan.plan_id as string;

            // 2. Parallel Fetch: Plan tasks and underlying content/apps
            const [tasksResult] = await Promise.all([
                db.from('learning_plan_tasks')
                    .select(`
                    *,
                    app_content!inner(data, app_id),
                    apps!inner(name, icon, route)
                `)
                    .eq('plan_id', planId)
                    .order('day_number', { ascending: true })
                    .order('order_index', { ascending: true })
            ]);

            const tasksRows = tasksResult.data;
            const tasksError = tasksResult.error;

            if (tasksError) throw tasksError;

            if (!tasksRows) return res.status(200).json({ plan_id: planId, days: [] }); // Start with empty if no tasks? Or handle gracefully.

            // 3. Group by day
            const days: Record<number, unknown[]> = {};
            for (const row of tasksRows) {
                const day = row.day_number as number;
                if (!days[day]) days[day] = [];

                let contentData = {};
                const appContentData = (row.app_content as any)?.data;
                try { contentData = JSON.parse(appContentData as string); } catch { }

                // Apps join data
                const appData = row.apps as any;

                days[day].push({
                    id: row.id,
                    day_number: day,
                    order_index: row.order_index,
                    app_id: row.app_id,
                    app_content_id: row.app_content_id,
                    completed: Boolean(row.completed),
                    completed_at: row.completed_at,
                    content: contentData,
                    app_name: appData?.name,
                    app_icon: appData?.icon,
                    app_route: appData?.route
                });
            }

            let planData = {};
            try { planData = JSON.parse(plan.plan_data as string); } catch { }

            const result = {
                plan_id: planId,
                title: plan.title,
                description: plan.description,
                status: plan.status,
                total_days: plan.total_days,
                created_at: plan.created_at,
                plan_data: planData,
                days: Object.entries(days).map(([dayNum, dayTasks]) => ({
                    day: parseInt(dayNum),
                    tasks: dayTasks
                }))
            };

            const langFormat = req.query['language-format'] || req.body?.['language-format'];
            if (langFormat === 'swiss') {
                return res.status(200).json(replaceEszett(result));
            }
            return res.status(200).json(result);

        } catch (e: unknown) {
            console.error("Error in GET plan:", e);
            return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
        }
    }

    if (req.method === 'PUT') {
        // Mark task(s) as completed
        const { taskId, taskIds } = req.body;
        const ids = taskIds && Array.isArray(taskIds) ? taskIds : (taskId ? [taskId] : []);

        if (ids.length === 0) {
            return res.status(400).json({ error: "Missing taskId or taskIds" });
        }

        try {
            // First get active plan ID to ensure ownership
            const { data: activePlan } = await db
                .from('learning_plans')
                .select('plan_id')
                .eq('user_uid', user_uid)
                .eq('status', 'active')
                .limit(1)
                .single();

            if (activePlan) {
                // Update tasks
                await db.from('learning_plan_tasks')
                    .update({ completed: true, completed_at: new Date().toISOString() })
                    .in('id', ids)
                    .eq('plan_id', activePlan.plan_id);

                // Check remaining
                const { count } = await db
                    .from('learning_plan_tasks')
                    .select('*', { count: 'exact', head: true })
                    .eq('plan_id', activePlan.plan_id)
                    .eq('completed', false);

                if ((count || 0) === 0) {
                    await db.from('learning_plans')
                        .update({ status: 'completed', completed_at: new Date().toISOString() })
                        .eq('plan_id', activePlan.plan_id);
                }
            }
            return res.status(200).json({ success: true });
        } catch (e: unknown) {
            console.error("Error in PUT plan:", e);
            return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
        }
    }

    if (req.method === 'DELETE') {
        // Archive (abandon) the active plan
        try {
            await db.from('learning_plans')
                .update({ status: 'abandoned' })
                .eq('user_uid', user_uid)
                .eq('status', 'active');

            return res.status(200).json({ success: true });
        } catch (e: unknown) {
            console.error("Error in DELETE plan:", e);
            return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
        }
    }

    if (req.method === 'POST') {
        try {
            // 0. Abandon any existing active plan
            await db.from('learning_plans')
                .update({ status: 'abandoned' })
                .eq('user_uid', user_uid)
                .eq('status', 'active');

            // 1. Fetch user progress
            const { data: progressRows } = await db
                .from('user_question_progress')
                .select(`
                    app_id, app_content_id, success_count, failure_count,
                    app_content!inner(data)
                `)
                .eq('user_uid', user_uid)
                .order('failure_count', { ascending: false })
                .order('success_count', { ascending: true });

            // 2. Fetch apps
            const { data: appsRows } = await db
                .from('apps')
                .select('id, name, description')
                .eq('type', 'learning');

            const appsMap = new Map((appsRows || []).map(a => [a.id, { name: a.name, description: a.description }]));

            // 3. Fetch unseen content
            // Need to fetch random content that is NOT in user_question_progress
            // Strategy: Get all seen IDs from progress, then fetch random content excluding those
            const seenIds = (progressRows || []).map(p => p.app_content_id);

            let unseenContentQuery = db
                .from('app_content')
                .select('id, app_id, data')
                .not('id', 'in', seenIds.length > 0 ? `(${seenIds.join(',')})` : '(-1)'); // empty list workaround

            // Supabase doesn't support random() sort standardly. 
            // We'll fetch a batch (e.g. 200) and pick random 30 in JS if needed, or just fetch first 30?
            // Since we want random unseen, and app_content is not huge, we can fetch all and shuffle.
            // Or use a limit and assume index randomization.
            // Let's fetch more and shuffle in memory.
            const { data: allUnseen } = await unseenContentQuery.limit(200);

            let unseenRows: any[] = [];
            if (allUnseen) {
                // Filter ensuring app is learning type (joined in original query, but we can filter by app_id in memory since we have apps list)
                const learningAppIds = new Set((appsRows || []).map(a => a.id));
                unseenRows = allUnseen
                    .filter(r => learningAppIds.has(r.app_id))
                    .sort(() => 0.5 - Math.random()) // Shuffle
                    .slice(0, 30);
            }

            // 4. Fetch user language
            const { data: userLangData } = await db.from('users').select('language_variant').eq('uid', user_uid).single();

            // 4. Build candidate pool with scoring
            interface Candidate {
                app_content_id: number;
                app_id: string;
                app_name: string;
                priority: 'weak' | 'unseen' | 'review';
                failure_count: number;
                success_count: number;
                content_preview: string;
            }

            const candidates: Candidate[] = [];

            // Weak questions (failed a lot, or low success rate)
            for (const row of (progressRows || [])) {
                const failures = row.failure_count as number;
                const successes = row.success_count as number;
                const appInfo = appsMap.get(row.app_id as string);
                if (!appInfo) continue;

                let priority: 'weak' | 'review' = 'review';
                if (failures > successes || (failures > 0 && successes < 3)) {
                    priority = 'weak';
                }

                let preview = '';
                try {
                    const contentData = (row.app_content as any)?.data;
                    const parsed = JSON.parse(contentData as string);
                    preview = JSON.stringify(parsed).slice(0, 100);
                } catch { }

                candidates.push({
                    app_content_id: row.app_content_id as number,
                    app_id: row.app_id as string,
                    app_name: appInfo.name,
                    priority,
                    failure_count: failures,
                    success_count: successes,
                    content_preview: preview
                });
            }

            // Unseen questions
            for (const row of unseenRows) {
                const appInfo = appsMap.get(row.app_id as string);
                if (!appInfo) continue;

                let preview = '';
                try {
                    const parsed = JSON.parse(row.data as string);
                    preview = JSON.stringify(parsed).slice(0, 100);
                } catch { }

                candidates.push({
                    app_content_id: row.id as number,
                    app_id: row.app_id as string,
                    app_name: appInfo.name,
                    priority: 'unseen',
                    failure_count: 0,
                    success_count: 0,
                    content_preview: preview
                });
            }

            if (candidates.length < 5) {
                return res.status(400).json({ error: "Nicht genügend Fragen vorhanden, um einen Lernplan zu erstellen." });
            }

            // 5. Use pre-fetched language preference
            let languageInstruction = "IMPORTANT: Use Swiss German spelling conventions (e.g., 'ss' instead of 'ß').";
            if (userLangData && userLangData.language_variant === 'standard') {
                languageInstruction = "IMPORTANT: Use Standard German spelling conventions (e.g., use 'ß' where appropriate).";
            }

            // 6. Prepare AI prompt
            const candidateSummary = candidates.slice(0, 50).map((c, i) =>
                `${i + 1}. [ID:${c.app_content_id}] App: ${c.app_name} (${c.app_id}), Priority: ${c.priority}, Failures: ${c.failure_count}, Successes: ${c.success_count}, Preview: ${c.content_preview}`
            ).join("\n");

            const appsList = (appsRows || []).map(a => `- ${a.name} (${a.id}): ${a.description}`).join("\n");

            // Get requested number of days (default 3)
            const requestedDays = Math.min(Math.max(req.body.days || 3, 1), 7);

            const systemPrompt = `You are an educational AI assistant creating a personalized learning plan.
${languageInstruction}
Available Apps:
${appsList}

You will receive a list of question candidates with their IDs, app names, priority levels, and performance data.
Create a structured learning plan spread across ${requestedDays} days.

RULES:
- Pick 3-6 questions per day from the candidate list
- Prioritize "weak" questions first (high failure, low success)
- Mix in some "unseen" questions for variety
- Group questions from the same app together within a day when possible
- Create a motivating title and description for the plan
- For each day, provide a short "focus" description

Return ONLY valid JSON:
{
    "title": "string (motivating plan name)",
    "description": "string (1-2 sentences explaining what this plan focuses on)",
    "days": [
        {
            "day": 1,
            "focus": "string (what this day focuses on)",
            "task_ids": [integer list of app_content_ids from the candidate list]
        }
    ]
}`;

            const userPrompt = `Create a ${requestedDays}-day learning plan from these question candidates:\n\n${candidateSummary}`;

            // 7. Call AI — lazy import to avoid cold-start tax on GET/PUT
            if (!process.env.XAI_API_KEY) {
                console.error("Missing XAI_API_KEY");
                return res.status(500).json({ error: "Server Configuration Error: Missing API Key" });
            }

            const [{ xai }, { generateText }] = await Promise.all([
                import('@ai-sdk/xai'),
                import('ai')
            ]);

            let text = "";
            try {
                const aiRes = await generateText({
                    // DO NOT CHANGE THE MODEL!!!!!
                    model: xai('grok-4-1-fast-reasoning'),
                    system: systemPrompt,
                    prompt: userPrompt,
                });
                text = aiRes.text;
            } catch (aiError: unknown) {
                console.error("AI Plan Generation Failed:", aiError);
                return res.status(500).json({ error: `AI Provider Error: ${aiError instanceof Error ? aiError.message : 'Unknown error'}` });
            }

            // 8. Parse AI response
            let planResponse: AIPlanResponse;
            try {
                const cleanText = text.replace(/```json\n?|```/g, '').trim();
                planResponse = JSON.parse(cleanText);
            } catch (parseError) {
                console.error("AI returned invalid JSON for plan:", text);
                return res.status(500).json({ error: "Failed to parse AI response" });
            }

            // 9. Validate that referenced task_ids exist in our candidate pool
            const candidateIds = new Set(candidates.map(c => c.app_content_id));
            const candidateMap = new Map(candidates.map(c => [c.app_content_id, c]));

            for (const day of planResponse.days) {
                day.task_ids = day.task_ids.filter(id => candidateIds.has(id));
            }

            // Remove empty days
            planResponse.days = planResponse.days.filter(d => d.task_ids.length > 0);

            if (planResponse.days.length === 0) {
                return res.status(500).json({ error: "AI generated an empty plan. Please try again." });
            }

            // 10. Save plan
            const planId = crypto.randomUUID();

            await db.from('learning_plans').insert({
                user_uid,
                plan_id: planId,
                title: planResponse.title,
                description: planResponse.description,
                status: 'active',
                total_days: planResponse.days.length,
                plan_data: JSON.stringify(planResponse.days.map(d => ({ day: d.day, focus: d.focus })))
            });

            // 11. Save individual tasks (batched)
            const tasksToInsert = [];
            for (const day of planResponse.days) {
                let orderIdx = 1;
                for (const contentId of day.task_ids) {
                    const candidate = candidateMap.get(contentId);
                    if (!candidate) continue;

                    tasksToInsert.push({
                        plan_id: planId,
                        day_number: day.day,
                        order_index: orderIdx++,
                        app_id: candidate.app_id,
                        app_content_id: contentId
                    });
                }
            }
            if (tasksToInsert.length > 0) {
                await db.from('learning_plan_tasks').insert(tasksToInsert);
            }

            // 12-13. Log AI interaction
            const { error: aiLogError } = await db.from('ai_logs').insert({
                user_uid,
                session_id: planId,
                prompt: userPrompt,
                system_prompt: systemPrompt,
                response: text,
                provider: 'xai',
                model: 'grok-4-1-fast-reasoning'
            });
            if (aiLogError) console.error("Failed to log AI plan interaction", aiLogError);

            // Re-fetch plan for return (Supabase could have returned it on insert, but we need tasks too)
            const { data: savedPlanData } = await db.from('learning_plans').select('*').eq('plan_id', planId).single();
            const savedPlan = savedPlanData;

            const { data: returnedTasksRows } = await db
                .from('learning_plan_tasks')
                .select(`
                    *,
                    app_content!inner(data, app_id),
                    apps!inner(name, icon, route)
                `)
                .eq('plan_id', planId)
                .order('day_number', { ascending: true })
                .order('order_index', { ascending: true });

            const days: Record<number, unknown[]> = {};
            for (const row of (returnedTasksRows || [])) {
                const day = row.day_number as number;
                if (!days[day]) days[day] = [];

                let contentData = {};
                const appContentData = (row.app_content as any)?.data;
                try { contentData = JSON.parse(appContentData as string); } catch { }

                // Apps join data
                const appData = row.apps as any;

                days[day].push({
                    id: row.id,
                    day_number: day,
                    order_index: row.order_index,
                    app_id: row.app_id,
                    app_content_id: row.app_content_id,
                    completed: Boolean(row.completed),
                    completed_at: row.completed_at,
                    content: contentData,
                    app_name: appData?.name,
                    app_icon: appData?.icon,
                    app_route: appData?.route
                });
            }

            let planData = {};
            try { planData = JSON.parse(savedPlan?.plan_data as string); } catch { }

            const result = {
                plan_id: savedPlan?.plan_id,
                title: savedPlan?.title,
                description: savedPlan?.description,
                status: savedPlan?.status,
                total_days: savedPlan?.total_days,
                created_at: savedPlan?.created_at,
                plan_data: planData,
                days: Object.entries(days).map(([dayNum, dayTasks]) => ({
                    day: parseInt(dayNum),
                    tasks: dayTasks
                }))
            };

            const langFormat = req.query['language-format'] || req.body?.['language-format'];
            if (langFormat === 'swiss') {
                return res.status(200).json(replaceEszett(result));
            }
            return res.status(200).json(result);

        } catch (e: unknown) {
            console.error("Error in POST plan:", e);
            return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
        }
    }
}
