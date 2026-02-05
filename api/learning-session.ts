
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

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
                    created_at: firstRow.created_at,
                    tasks: sessionRows.rows.map(row => ({
                        id: row.id, // ID needed for completion
                        app_id: row.app_id,
                        pristine: row.pristine,
                        content: JSON.parse(row.content as string)
                    }))
                };

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
        const { taskId } = req.body;

        if (!taskId) {
            return res.status(400).json({ error: "Missing taskId" });
        }

        try {
            await db.execute({
                sql: "UPDATE learning_session SET pristine = 0 WHERE id = ? AND user_uid = ?",
                args: [taskId, user_uid as string]
            });
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

            // 3. Prepare Prompt
            const userResults = results.rows.map(r => {
                const app = appsMap.get(r.app_id);
                return `App: ${app ? app.name : r.app_id}\nResult Content: ${r.content}`;
            }).join("\n\n");

            const availableApps = apps.rows.map(a =>
                `- ID: ${a.id}, Name: ${a.name}, Description: ${a.description}, Target Structure JSON Schema: ${a.data_structure || '{}'}`
            ).join("\n");

            const prompt = `
                You are an educational AI assistant.
                Analyze the following user learning results (mistakes, successes, patterns):
                ${userResults}

                Based on this analysis, create a personalized learning session with 3 to 5 tasks.
                Choose the most appropriate apps from the following list to address the user's needs.
                For each task, generate SPECIFIC content that follows the app's Target Structure JSON Schema exactly.

                Available Apps:
                ${availableApps}

                Create a motivating header (topic) and a short explanation (text) for why this session was created.

                IMPORTANT: Return ONLY valid JSON mathing the following structure. Do not include markdown formatting or other text.
                {
                    "topic": "string",
                    "text": "string",
                    "tasks": [
                        {
                            "app_id": "string (must be one of the IDs above)",
                            "content": { ... object matching the apps data_structure ... }
                        }
                    ]
                }
            `;

            // 4. Call AI (xAI Grok)
            const { text } = await generateText({
                model: xai('grok-4-1-fast-reasoning'),
                prompt: prompt,
            });

            // 5. Parse JSON
            let object: any;
            try {
                // Strip markdown code blocks if present
                const cleanText = text.replace(/```json\n?|```/g, '').trim();
                object = JSON.parse(cleanText);
            } catch (parseError) {
                console.error("AI returned invalid JSON:", text);
                return res.status(500).json({ error: "Failed to parse AI response" });
            }

            if (!object || !object.tasks || !Array.isArray(object.tasks)) {
                return res.status(500).json({ error: "AI response missing tasks structure" });
            }

            // 5. Save into DB
            const sessionId = crypto.randomUUID();
            const timestamp = new Date().toISOString();

            for (let i = 0; i < object.tasks.length; i++) {
                const task = object.tasks[i];
                await db.execute({
                    sql: `INSERT INTO learning_session (user_uid, session_id, app_id, content, order_index, pristine, topic, text)
                          VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
                    args: [
                        user_uid,
                        sessionId,
                        task.app_id,
                        JSON.stringify(task.content),
                        i + 1,
                        object.topic,
                        object.text
                    ]
                });
            }

            // 6. Mark results as processed
            const resultIds = results.rows.map(r => r.id).join(',');
            await db.execute(`UPDATE app_results SET processed = 1 WHERE id IN (${resultIds})`);

            const sessionData = {
                session_id: sessionId,
                topic: object.topic,
                text: object.text,
                created_at: timestamp,
                tasks: object.tasks
            };

            return res.status(200).json(sessionData);

        } catch (e: any) {
            console.error("Error generating session:", e);
            return res.status(500).json({ error: e.message || "AI Generation Failed" });
        }
    }

    res.status(405).json({ error: "Method not allowed" });
}
