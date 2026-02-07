import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';
import crypto from 'node:crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();

    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { user_uid } = req.method === 'GET' ? req.query : req.body;

    if (!user_uid) {
        return res.status(400).json({ error: "Missing user_uid" });
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

            // ... (rest of logic for suggesting apps) ...
            const resultsCount = await db.execute({
                sql: "SELECT COUNT(*) as count FROM app_results WHERE user_uid = ? AND processed = 0",
                args: [user_uid as string]
            });

            const count = resultsCount.rows[0].count as number;

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

        } catch (e: any) {
            console.error("Error in GET /api/learning-session:", e.message);
            return res.status(500).json({ error: e.message });
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
        } catch (e: any) {
            console.error("Error in PUT /api/learning-session:", e.message);
            return res.status(500).json({ error: e.message });
        }
    }

    if (req.method === 'POST') {
        try {
            // 1. Fetch unprocessed results
            const results = await db.execute({
                sql: "SELECT * FROM app_results WHERE user_uid = ? AND processed = 0",
                args: [user_uid as string]
            });

            if (results.rows.length === 0) {
                return res.status(400).json({ error: "No new results to process" });
            }

            // 2. Fetch app definitions
            const apps = await db.execute("SELECT id, name, description, data_structure FROM apps WHERE type = 'learning'");
            const appsMap = new Map(apps.rows.map(a => [a.id, a]));

            // 3. Prepare Prompt for Analysis AND Generation
            const userResults = results.rows.map(r => {
                const app = appsMap.get(r.app_id);
                return `Result ID: ${r.id}\nApp: ${app ? app.name : r.app_id}\nResult Content: ${r.content}`;
            }).join("\n\n");

            const availableApps = apps.rows.map(a =>
                `- ID: ${a.id}, Name: ${a.name}, Description: ${a.description}, Target Structure JSON Schema: ${a.data_structure || '{}'}`
            ).join("\n");

            // 2b. Fetch User Language Preference
            let languageInstruction = "IMPORTANT: Use Swiss German spelling conventions (e.g., 'ss' instead of 'ß').";
            try {
                const userRes = await db.execute({
                    sql: "SELECT language_variant FROM users WHERE uid = ?",
                    args: [user_uid]
                });
                if (userRes.rows.length > 0 && userRes.rows[0].language_variant === 'standard') {
                    languageInstruction = "IMPORTANT: Use Standard German spelling conventions (e.g., use 'ß' where appropriate).";
                }
            } catch (e) { console.warn("Failed to fetch user language preference", e); }

            const systemPrompt = `You are an educational AI assistant.
${languageInstruction}
Available Apps:
${availableApps}

IMPORTANT: Return ONLY valid JSON matching the following structure.
{
    "result_analysis": [
        {
            "result_id": "integer (match from input)",
            "is_correct": "boolean (true if the user answered correctly/mastered this specific question)",
            "question_hash_content": "string (the exact unique identifier content of the question, e.g. the specific sentence or math problem, so we can hash it)"
        }
    ],
    "topic": "string",
    "text": "string",
    "theory": [
        {
            "title": "string",
            "content": "string (markdown allowed)"
        }
    ],
    "tasks": [
        {
            "app_id": "string (must be one of the IDs above)",
            "content": { ... object matching the apps data_structure ... }
        }
    ]
}`;

            const userPrompt = `Step 1: Analyze the following user learning results. determine if they answered correctly.
${userResults}

Step 2: Create a personalized learning session with 3 to 5 tasks.
Choose the most appropriate apps from the available list.
For each task, generate SPECIFIC content that follows the app's Target Structure JSON Schema exactly.
Create a motivating header (topic) and a short explanation (text).
ADDITIONALLY, provide a list of "theory" cards that explain the concepts used in the tasks.`;

            // 4. Call AI (xAI Grok)
            if (!process.env.XAI_API_KEY) {
                console.error("Missing XAI_API_KEY");
                return res.status(500).json({ error: "Server Configuration Error: Missing API Key" });
            }

            let text = "";
            try {
                const aiRes = await generateText({
                    // DO NOT CHANGE THE MODEL!!!!!
                    model: xai('grok-4-1-fast-reasoning'),
                    system: systemPrompt,
                    prompt: userPrompt,
                });
                text = aiRes.text;
            } catch (aiError: any) {
                console.error("AI Generation Failed:", aiError);
                return res.status(500).json({ error: `AI Provider Error: ${aiError.message}` });
            }

            // 5. Parse JSON
            let object: any;
            try {
                const cleanText = text.replace(/```json\n?|```/g, '').trim();
                object = JSON.parse(cleanText);
            } catch (parseError) {
                console.error("AI returned invalid JSON:", text);
                return res.status(500).json({ error: "Failed to parse AI response" });
            }

            // 6. Process Analysis & Update Progress
            if (object.result_analysis && Array.isArray(object.result_analysis)) {
                for (const analysis of object.result_analysis) {
                    if (!analysis.question_hash_content) continue;

                    // Create a simple hash of the content to identify the question consistently
                    const hash = crypto.createHash('md5').update(analysis.question_hash_content.trim()).digest('hex');
                    const isSuccess = analysis.is_correct;

                    try {
                        const col = isSuccess ? 'success_count' : 'failure_count';
                        await db.execute({
                            sql: `INSERT INTO user_question_progress (user_uid, app_id, question_hash, success_count, failure_count, last_attempt_at)
                                  VALUES (?, 'unknown', ?, ?, ?, CURRENT_TIMESTAMP)
                                  ON CONFLICT(user_uid, question_hash) DO UPDATE SET
                                  ${col} = ${col} + 1,
                                  last_attempt_at = CURRENT_TIMESTAMP`,
                            args: [user_uid, hash, isSuccess ? 1 : 0, isSuccess ? 0 : 1]
                        });
                    } catch (e: any) {
                        console.error("Error updating question progress:", e.message);
                    }
                }
            }

            // 7. Filter & Save Tasks
            const sessionId = crypto.randomUUID();
            let taskOrder = 1;

            if (object.tasks && Array.isArray(object.tasks)) {
                for (const task of object.tasks) {
                    // Skip empty
                    if (!task.content) continue;

                    // Check Mastery
                    const contentStr = JSON.stringify(task.content);
                    const taskHash = crypto.createHash('md5').update(contentStr).digest('hex');

                    // Check if mastered
                    const progress = await db.execute({
                        sql: "SELECT success_count FROM user_question_progress WHERE user_uid = ? AND question_hash = ?",
                        args: [user_uid as string, taskHash]
                    });

                    if (progress.rows.length > 0 && (progress.rows[0].success_count as number) >= 3) {
                        console.log(`Skipping mastered task: ${taskHash}`);
                        continue; // SKIP this task
                    }

                    await db.execute({
                        sql: `INSERT INTO learning_session (user_uid, session_id, app_id, content, order_index, pristine, topic, text, theory)
                              VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
                        args: [
                            user_uid,
                            sessionId,
                            task.app_id,
                            contentStr,
                            taskOrder++,
                            object.topic,
                            object.text,
                            JSON.stringify(object.theory || [])
                        ]
                    });
                }
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
                // Don't fail the request just because logging failed
            }

            // 9. Mark results processed
            const resultIds = results.rows.map(r => r.id).join(',');
            await db.execute(`UPDATE app_results SET processed = 1 WHERE id IN (${resultIds})`);

            // 10. Return 
            const refetchedSession = await db.execute({
                sql: "SELECT * FROM learning_session WHERE session_id = ? ORDER BY order_index ASC",
                args: [sessionId]
            });

            if (refetchedSession.rows.length === 0) {
                return res.status(200).json({
                    session_id: sessionId,
                    tasks: [],
                    topic: "No new tasks",
                    text: "You have mastered all proposed topics! Great job."
                });
            }

            const firstRow = refetchedSession.rows[0];
            const finalData = {
                session_id: sessionId,
                topic: firstRow.topic,
                text: firstRow.text,
                theory: firstRow.theory ? JSON.parse(firstRow.theory as string) : [],
                created_at: firstRow.created_at,
                tasks: refetchedSession.rows.map(row => ({
                    id: row.id,
                    app_id: row.app_id,
                    pristine: row.pristine,
                    content: JSON.parse(row.content as string)
                }))
            };

            const langFormat = req.query['language-format'] || req.body['language-format'];
            if (langFormat === 'swiss') {
                return res.status(200).json(replaceEszett(finalData));
            }
            return res.status(200).json(finalData);

        } catch (e: any) {
            console.error("Error generating session:", e);
            const msg = e.message || e.toString();
            return res.status(500).json({ error: `Server Error: ${msg}` });
        }
    }

    res.status(405).json({ error: "Method not allowed" });
}

function replaceEszett(obj: any): any {
    if (typeof obj === 'string') {
        return obj.replace(/ß/g, 'ss');
    } else if (Array.isArray(obj)) {
        return obj.map(item => replaceEszett(item));
    } else if (obj !== null && typeof obj === 'object') {
        const newObj: any = {};
        for (const key in obj) {
            newObj[key] = replaceEszett(obj[key]);
        }
        return newObj;
    }
    return obj;
}
