import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';
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

    const db = getTursoClient();
    const user_uid = decoded.uid;

    // Route: plan vs session
    const type = req.query.type || req.body?.type;
    if (type === 'plan') {
        return handlePlan(req, res, db, user_uid);
    }

    if (req.method === 'GET') {
        try {
            // 1. Find the active session (latest session that has at least one pristine task)
            const activeSessionResult = await db.execute({
                sql: `SELECT session_id FROM learning_session 
                      WHERE user_uid = ? AND pristine = 1 
                      ORDER BY created_at DESC LIMIT 1`,
                args: [user_uid as string]
            });

            if (activeSessionResult.rows.length > 0) {
                const sessionId = activeSessionResult.rows[0].session_id;

                // 2. Fetch ALL tasks for this session (both done and todo)
                const sessionRows = await db.execute({
                    sql: "SELECT * FROM learning_session WHERE session_id = ? ORDER BY order_index ASC",
                    args: [sessionId]
                });

                const firstRow = sessionRows.rows[0];
                const sessionData = {
                    session_id: sessionId,
                    topic: firstRow.topic,
                    text: firstRow.text,
                    theory: firstRow.theory ? JSON.parse(firstRow.theory as string) : [],
                    created_at: firstRow.created_at,
                    tasks: sessionRows.rows.map(row => ({
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

                // TODO: Verify if we should also check user.language_variant from DB here. 
                // For now, adhering strictly to "if query param... is set" as per user request, 
                // but checking DB is safer for consistent user experience.
                // However, fetching user prefs here might be an extra DB call. 
                // Let's stick to the explicit param for now as requested.

                return res.status(200).json(sessionData);
            }

            // Check if user has enough question progress data to generate a session
            const progressCount = await db.execute({
                sql: "SELECT COUNT(*) as count FROM user_question_progress WHERE user_uid = ?",
                args: [user_uid as string]
            });

            const count = progressCount.rows[0].count as number;

            if (count < 3) {
                const learningApps = await db.execute({
                    sql: "SELECT * FROM apps WHERE type = 'learning' ORDER BY RANDOM() LIMIT 5",
                    args: []
                });

                const suggestedApps = learningApps.rows.map(row => {
                    let tags = [];
                    try {
                        tags = JSON.parse(row.tags as string);
                    } catch (e) {
                        // ignore
                    }
                    return { ...row, tags, featured: Boolean(row.featured) };
                });

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
                const placeholders = taskIds.map(() => '?').join(',');
                await db.execute({
                    sql: `UPDATE learning_session SET pristine = 0 WHERE id IN (${placeholders}) AND user_uid = ?`,
                    args: [...taskIds, user_uid as string]
                });
            } else {
                await db.execute({
                    sql: "UPDATE learning_session SET pristine = 0 WHERE id = ? AND user_uid = ?",
                    args: [taskId, user_uid as string]
                });
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
            const [progress, apps, userLangRes] = await Promise.all([
                db.execute({
                    sql: `SELECT uqp.app_id, uqp.app_content_id, uqp.success_count, uqp.failure_count,
                                 ac.data as content_data
                          FROM user_question_progress uqp
                          JOIN app_content ac ON uqp.app_content_id = ac.id
                          WHERE uqp.user_uid = ?
                          ORDER BY uqp.failure_count DESC, uqp.success_count ASC`,
                    args: [user_uid as string]
                }),
                db.execute("SELECT id, name, description, data_structure FROM apps WHERE type = 'learning'"),
                db.execute({ sql: "SELECT language_variant FROM users WHERE uid = ?", args: [user_uid] })
            ]);

            if (progress.rows.length === 0) {
                return res.status(400).json({ error: "Keine Lerndaten vorhanden. Beantworte zuerst ein paar Fragen in den Apps." });
            }
            const appsMap = new Map(apps.rows.map(a => [a.id, a]));

            // 3. Analyze weak areas from question progress
            const weakAreas: { app_id: string; app_name: string; failures: number; successes: number; preview: string }[] = [];
            for (const row of progress.rows) {
                const failures = row.failure_count as number;
                const successes = row.success_count as number;
                const app = appsMap.get(row.app_id as string);
                if (!app) continue;

                // Include questions where user struggles or hasn't mastered yet
                if (failures > 0 || successes < 3) {
                    let preview = '';
                    try {
                        const parsed = JSON.parse(row.content_data as string);
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
            for (const row of progress.rows) {
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

            const availableApps = apps.rows.map(a =>
                `- ID: ${a.id}, Name: ${a.name}, Description: ${a.description}, Target Structure JSON Schema: ${a.data_structure || '{}'}`
            ).join("\n");

            // 4. Use pre-fetched language preference
            let languageInstruction = "IMPORTANT: Use Swiss German spelling conventions (e.g., 'ss' instead of 'ß').";
            if (userLangRes.rows.length > 0 && userLangRes.rows[0].language_variant === 'standard') {
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

            let taskIds: (bigint | undefined)[] = [];
            if (validTasks.length > 0) {
                const batchResults = await db.batch(
                    validTasks.map((task, idx) => ({
                        sql: `INSERT INTO learning_session (user_uid, session_id, app_id, content, order_index, pristine, topic, text, theory)
                              VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
                        args: [
                            user_uid,
                            sessionId,
                            task.app_id,
                            JSON.stringify(task.content),
                            idx + 1,
                            object.topic,
                            object.text,
                            theoryStr
                        ]
                    }))
                );
                taskIds = batchResults.map(r => r.lastInsertRowid);
            }

            // 8. Log to ai_logs
            try {
                await db.execute({
                    sql: `INSERT INTO ai_logs (user_uid, session_id, prompt, system_prompt, response, provider, model)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    args: [
                        user_uid,
                        sessionId,
                        userPrompt,
                        systemPrompt,
                        text,
                        'xai',
                        'grok-4-1-fast-reasoning'
                    ]
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

async function handlePlan(req: VercelRequest, res: VercelResponse, db: ReturnType<typeof getTursoClient>, user_uid: string) {
    // GET  → fetch active plan (or return null / not-enough-data)
    // POST → generate a new plan via AI
    // PUT  → mark task(s) as completed

    if (req.method === 'GET') {
        try {
            // 1. Find active plan
            const activePlan = await db.execute({
                sql: `SELECT * FROM learning_plans WHERE user_uid = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
                args: [user_uid]
            });

            if (activePlan.rows.length === 0) {
                // Check if there's enough data to generate
                const progressCount = await db.execute({
                    sql: `SELECT COUNT(*) as count FROM user_question_progress WHERE user_uid = ?`,
                    args: [user_uid]
                });
                const count = progressCount.rows[0].count as number;

                if (count < 5) {
                    return res.status(404).json({
                        message: "not_enough_data",
                        hint: "Beantworte mindestens 5 Fragen in verschiedenen Apps, damit ein Lernplan erstellt werden kann."
                    });
                }

                return res.status(200).json(null); // Ready to generate
            }

            const plan = activePlan.rows[0];
            const planId = plan.plan_id as string;

            // 2. Fetch all tasks for this plan, joined with app_content for the actual data
            const tasks = await db.execute({
                sql: `SELECT lpt.*, ac.data as content_data, ac.app_id as content_app_id, a.name as app_name, a.icon as app_icon, a.route as app_route
                      FROM learning_plan_tasks lpt
                      JOIN app_content ac ON lpt.app_content_id = ac.id
                      JOIN apps a ON lpt.app_id = a.id
                      WHERE lpt.plan_id = ?
                      ORDER BY lpt.day_number ASC, lpt.order_index ASC`,
                args: [planId]
            });

            // 3. Group by day
            const days: Record<number, unknown[]> = {};
            for (const row of tasks.rows) {
                const day = row.day_number as number;
                if (!days[day]) days[day] = [];

                let contentData = {};
                try { contentData = JSON.parse(row.content_data as string); } catch { }

                days[day].push({
                    id: row.id,
                    day_number: day,
                    order_index: row.order_index,
                    app_id: row.app_id,
                    app_content_id: row.app_content_id,
                    completed: Boolean(row.completed),
                    completed_at: row.completed_at,
                    content: contentData,
                    app_name: row.app_name,
                    app_icon: row.app_icon,
                    app_route: row.app_route
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
            const placeholders = ids.map(() => '?').join(',');
            await db.execute({
                sql: `UPDATE learning_plan_tasks SET completed = 1, completed_at = CURRENT_TIMESTAMP 
                      WHERE id IN (${placeholders})
                      AND plan_id IN (SELECT plan_id FROM learning_plans WHERE user_uid = ?)`,
                args: [...ids, user_uid]
            });

            // Check if all tasks in the plan are completed → mark plan completed
            const activePlan = await db.execute({
                sql: `SELECT plan_id FROM learning_plans WHERE user_uid = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
                args: [user_uid]
            });

            if (activePlan.rows.length > 0) {
                const planId = activePlan.rows[0].plan_id as string;
                const remaining = await db.execute({
                    sql: `SELECT COUNT(*) as count FROM learning_plan_tasks WHERE plan_id = ? AND completed = 0`,
                    args: [planId]
                });
                if ((remaining.rows[0].count as number) === 0) {
                    await db.execute({
                        sql: `UPDATE learning_plans SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE plan_id = ?`,
                        args: [planId]
                    });
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
            await db.execute({
                sql: `UPDATE learning_plans SET status = 'abandoned' WHERE user_uid = ? AND status = 'active'`,
                args: [user_uid]
            });
            return res.status(200).json({ success: true });
        } catch (e: unknown) {
            console.error("Error in DELETE plan:", e);
            return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
        }
    }

    if (req.method === 'POST') {
        try {
            // 0. Abandon any existing active plan
            await db.execute({
                sql: `UPDATE learning_plans SET status = 'abandoned' WHERE user_uid = ? AND status = 'active'`,
                args: [user_uid]
            });

            // 1-3. Fetch progress, unseen questions, apps, and language preference in parallel
            const [progress, unseenQuestions, apps, planUserLangRes] = await Promise.all([
                db.execute({
                    sql: `SELECT uqp.app_id, uqp.app_content_id, uqp.success_count, uqp.failure_count,
                                 ac.data as content_data
                          FROM user_question_progress uqp
                          JOIN app_content ac ON uqp.app_content_id = ac.id
                          WHERE uqp.user_uid = ?
                          ORDER BY uqp.failure_count DESC, uqp.success_count ASC`,
                    args: [user_uid]
                }),
                db.execute({
                    sql: `SELECT ac.id, ac.app_id, ac.data as content_data
                          FROM app_content ac
                          JOIN apps a ON ac.app_id = a.id
                          WHERE a.type = 'learning'
                            AND ac.id NOT IN (
                                SELECT app_content_id FROM user_question_progress WHERE user_uid = ?
                            )
                          ORDER BY RANDOM()
                          LIMIT 30`,
                    args: [user_uid]
                }),
                db.execute("SELECT id, name, description FROM apps WHERE type = 'learning'"),
                db.execute({ sql: "SELECT language_variant FROM users WHERE uid = ?", args: [user_uid] })
            ]);
            const appsMap = new Map(apps.rows.map(a => [a.id as string, { name: a.name as string, description: a.description as string }]));

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
            for (const row of progress.rows) {
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
                    const parsed = JSON.parse(row.content_data as string);
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
            for (const row of unseenQuestions.rows) {
                const appInfo = appsMap.get(row.app_id as string);
                if (!appInfo) continue;

                let preview = '';
                try {
                    const parsed = JSON.parse(row.content_data as string);
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
            if (planUserLangRes.rows.length > 0 && planUserLangRes.rows[0].language_variant === 'standard') {
                languageInstruction = "IMPORTANT: Use Standard German spelling conventions (e.g., use 'ß' where appropriate).";
            }

            // 6. Prepare AI prompt
            const candidateSummary = candidates.slice(0, 50).map((c, i) =>
                `${i + 1}. [ID:${c.app_content_id}] App: ${c.app_name} (${c.app_id}), Priority: ${c.priority}, Failures: ${c.failure_count}, Successes: ${c.success_count}, Preview: ${c.content_preview}`
            ).join("\n");

            const appsList = apps.rows.map(a => `- ${a.name} (${a.id}): ${a.description}`).join("\n");

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

            await db.execute({
                sql: `INSERT INTO learning_plans (user_uid, plan_id, title, description, status, total_days, plan_data)
                      VALUES (?, ?, ?, ?, 'active', ?, ?)`,
                args: [
                    user_uid,
                    planId,
                    planResponse.title,
                    planResponse.description,
                    planResponse.days.length,
                    JSON.stringify(planResponse.days.map(d => ({ day: d.day, focus: d.focus })))
                ]
            });

            // 11. Save individual tasks (batched — single round-trip)
            const planTaskInserts: { sql: string; args: (string | number)[] }[] = [];
            for (const day of planResponse.days) {
                let orderIdx = 1;
                for (const contentId of day.task_ids) {
                    const candidate = candidateMap.get(contentId);
                    if (!candidate) continue;

                    planTaskInserts.push({
                        sql: `INSERT INTO learning_plan_tasks (plan_id, day_number, order_index, app_id, app_content_id)
                              VALUES (?, ?, ?, ?, ?)`,
                        args: [planId, day.day, orderIdx++, candidate.app_id, contentId]
                    });
                }
            }
            if (planTaskInserts.length > 0) {
                await db.batch(planTaskInserts);
            }

            // 12-13. Log AI interaction and re-fetch plan + tasks in parallel
            const [, savedPlan, savedTasks] = await Promise.all([
                db.execute({
                    sql: `INSERT INTO ai_logs (user_uid, session_id, prompt, system_prompt, response, provider, model)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    args: [user_uid, planId, userPrompt, systemPrompt, text, 'xai', 'grok-4-1-fast-reasoning']
                }).catch(logError => { console.error("Failed to log AI plan interaction:", logError); return null; }),
                db.execute({
                    sql: `SELECT * FROM learning_plans WHERE plan_id = ?`,
                    args: [planId]
                }),
                db.execute({
                    sql: `SELECT lpt.*, ac.data as content_data, a.name as app_name, a.icon as app_icon, a.route as app_route
                          FROM learning_plan_tasks lpt
                          JOIN app_content ac ON lpt.app_content_id = ac.id
                          JOIN apps a ON lpt.app_id = a.id
                          WHERE lpt.plan_id = ?
                          ORDER BY lpt.day_number ASC, lpt.order_index ASC`,
                    args: [planId]
                })
            ]);

            const daysMap: Record<number, unknown[]> = {};
            for (const row of savedTasks.rows) {
                const dayNum = row.day_number as number;
                if (!daysMap[dayNum]) daysMap[dayNum] = [];

                let contentData = {};
                try { contentData = JSON.parse(row.content_data as string); } catch { }

                daysMap[dayNum].push({
                    id: row.id,
                    day_number: dayNum,
                    order_index: row.order_index,
                    app_id: row.app_id,
                    app_content_id: row.app_content_id,
                    completed: false,
                    completed_at: null,
                    content: contentData,
                    app_name: row.app_name,
                    app_icon: row.app_icon,
                    app_route: row.app_route
                });
            }

            const sp = savedPlan.rows[0];
            let savedPlanData = {};
            try { savedPlanData = JSON.parse(sp.plan_data as string); } catch { }

            const finalResult = {
                plan_id: planId,
                title: sp.title,
                description: sp.description,
                status: sp.status,
                total_days: sp.total_days,
                created_at: sp.created_at,
                plan_data: savedPlanData,
                days: Object.entries(daysMap).map(([dayNum, dayTasks]) => ({
                    day: parseInt(dayNum),
                    tasks: dayTasks
                }))
            };

            const langFormat = req.query['language-format'] || req.body?.['language-format'];
            if (langFormat === 'swiss') {
                return res.status(200).json(replaceEszett(finalResult));
            }
            return res.status(200).json(finalResult);

        } catch (e: unknown) {
            console.error("Error generating plan:", e);
            const msg = e instanceof Error ? e.message : String(e);
            return res.status(500).json({ error: `Server Error: ${msg}` });
        }
    }

    return res.status(405).json({ error: "Method not allowed" });
}
