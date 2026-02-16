import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient, type TursoClient } from './_lib/turso.js';
import { handleCors, verifyAuth } from './_lib/auth.js';
import { replaceEszett } from './_lib/text-utils.js';

// Static mapping: LP21 Handlungsaspekt/Kompetenz codes → app IDs
const CURRICULUM_APP_MAP: Record<string, string[]> = {
    // Deutsch
    'D.5.E': ['dasdass', 'fehler'],              // Rechtschreibregeln
    'D.5.D': ['wortarten', 'kasus', 'verben'],   // Grammatikbegriffe
    'D.5.C': ['wortfamilie', 'wortstaemme'],      // Sprachformales untersuchen
    'D.5.B': ['aehnlichewoerter', 'synant', 'oberbegriffe'], // Sprachgebrauch untersuchen
    'D.5.A': ['wortfamilie'],                     // Verfahren und Proben
    'D.4.F': ['fehler', 'satzzeichen'],           // Schreibprozess: sprachformal
    'D.4.D': ['fehler'],                          // Schreibprozess: formulieren
    'D.2.B': ['aehnlichewoerter'],                // Verstehen von Sachtexten
    'D.2.C': ['aehnlichewoerter'],                // Verstehen literarischer Texte
    'D.2.A': ['redewendungen'],                   // Grundfertigkeiten (Wortschatz)
    // Mathematik
    'MA.1.A': ['kopfrechnen', 'textaufgaben'],    // Zahl: Operieren und Benennen
    'MA.1.C': ['textaufgaben'],                   // Zahl: Mathematisieren
    'MA.2.A': ['symmetrien'],                     // Form: Operieren
    'MA.3.A': ['umrechnen', 'zeitrechnen'],       // Grössen: Operieren
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Route: curriculum tree, reading text, app content, or app list
    const { app_id, curriculum } = req.query;
    if (curriculum === 'true') {
        return handleCurriculum(req, res);
    }
    if (app_id === 'textverstaendnis') {
        return handleReadingText(req, res);
    }
    if (app_id && typeof app_id === 'string') {
        return handleAppContent(req, res, app_id);
    }
    return handleAppsList(req, res);
}

async function handleAppsList(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();

    // Cache for 1 hour, reuse stale for 10 mins
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

    try {
        const result = await db.execute("SELECT * FROM apps");

        const apps = result.rows.map(row => {
            // Parse tags from JSON string
            let tags = [];
            try {
                tags = JSON.parse(row.tags as string);
            } catch (e) {
                console.error("Error parsing tags for app", row.id, e);
            }

            return {
                ...row,
                tags,
                // Ensure boolean conversion for featured if needed (SQLite uses 0/1)
                featured: Boolean(row.featured)
            };
        });

        return res.status(200).json({ apps });
    } catch (e: unknown) {
        console.error("Error fetching apps:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleAppContent(req: VercelRequest, res: VercelResponse, app_id: string) {
    const db = getTursoClient();
    const { skill_level, level, curriculum_node_id } = req.query;

    // Optional auth — personalize if logged in, anonymous fallback otherwise
    const decoded = await verifyAuth(req);
    const user_uid = decoded?.uid;

    try {
        // 1. Check for Procedural Config (app_config) if curriculum node is provided
        let appConfig = null;
        if (curriculum_node_id) {
            const nodeId = parseInt(curriculum_node_id as string);
            const configResult = await db.execute({
                sql: "SELECT config_json FROM app_config WHERE app_id = ? AND curriculum_node_id = ?",
                args: [app_id, nodeId]
            });
            if (configResult.rows.length > 0) {
                try {
                    appConfig = JSON.parse(configResult.rows[0].config_json as string);
                } catch (e) {
                    console.error("Error parsing app_config", e);
                }
            }
        }

        // 2. Fetch Content (Static)
        let sql: string;
        const args: (string | number)[] = [];

        if (user_uid) {
            // Personalized query: LEFT JOIN with user progress
            sql = `SELECT ac.*, 
                          uqp.success_count, 
                          uqp.failure_count, 
                          uqp.last_attempt_at
                   FROM app_content ac
                   LEFT JOIN user_question_progress uqp 
                     ON ac.id = uqp.app_content_id AND uqp.user_uid = ?`;

            // Add filtering joins depending on mode
            if (curriculum_node_id) {
                sql += ` JOIN app_content_curriculum acc ON ac.id = acc.app_content_id`;
            }

            sql += ` WHERE ac.app_id = ?`;
            args.push(user_uid); // for join
            // args.push(app_id); // pushed later
        } else {
            sql = "SELECT ac.* FROM app_content ac";
            if (curriculum_node_id) {
                sql += ` JOIN app_content_curriculum acc ON ac.id = acc.app_content_id`;
            }
            sql += ` WHERE ac.app_id = ?`;
        }
        args.push(app_id);

        // Filter by Curriculum Node if provided
        if (curriculum_node_id) {
            sql += " AND acc.curriculum_node_id = ?";
            args.push(parseInt(curriculum_node_id as string));
        }

        if (skill_level) {
            const skillVal = parseFloat(skill_level as string);
            if (!isNaN(skillVal)) {
                sql += " AND (ac.skill_level IS NULL OR ac.skill_level <= ?)";
                args.push(skillVal);
            }
        }

        // Only filter by level if NOT using curriculum node (legacy fallback)
        if (level && !curriculum_node_id) {
            const levelVal = parseInt(level as string);
            if (!isNaN(levelVal)) {
                sql += " AND (ac.level IS NULL OR ac.level = ?)";
                args.push(levelVal);
            }
        }

        const result = await db.execute({ sql, args });

        const content = result.rows.map(row => {
            let data = null;
            try {
                data = JSON.parse(row.data as string);
            } catch (e) {
                console.error("Error parsing content data", row.id);
            }

            if (user_uid) {
                const s = (row.success_count as number) ?? 0;
                const f = (row.failure_count as number) ?? 0;
                const total = s + f;

                let mastery: 'new' | 'struggling' | 'improving' | 'mastered' = 'new';
                let priority = 0.5; // default for unseen

                if (total > 0) {
                    priority = Math.min(1.0, (f + 1) / (total + 1));

                    if (s >= 3 && f === 0) {
                        mastery = 'mastered';
                    } else if (f > s) {
                        mastery = 'struggling';
                    } else {
                        mastery = 'improving';
                    }

                    // Recency boost: questions attempted recently get higher priority
                    if (row.last_attempt_at) {
                        const daysSince = (Date.now() - new Date(row.last_attempt_at as string).getTime()) / 86400000;
                        const recencyBoost = Math.exp(-0.1 * daysSince);
                        priority *= (0.3 + 0.7 * recencyBoost);
                    }
                }

                return {
                    ...row,
                    data,
                    mastery,
                    success_count: s,
                    failure_count: f,
                    _priority: priority
                };
            }

            return { ...row, data };
        });

        // Sort personalized content
        if (user_uid) {
            content.sort((a: any, b: any) => (b._priority ?? 0) - (a._priority ?? 0));
            content.forEach((c: any) => delete c._priority);
        }

        const langFormat = req.query['language-format'];
        const responseData: any = { content };

        if (appConfig) {
            responseData.config = appConfig;
        }

        if (langFormat === 'swiss') {
            responseData.content = replaceEszett(responseData.content);
        }

        return res.status(200).json(responseData);
    } catch (e: unknown) {
        console.error("Error fetching app content:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

/**
 * Returns the LP21 curriculum tree filtered by max Zyklus.
 * Query params:
 *   - max_zyklus (optional, 1|2|3): filter Kompetenzstufen to <= this Zyklus
 *   - fachbereich (optional): 'deutsch' | 'mathematik'
 */
async function handleCurriculum(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();

    // Cache for 24 hours (curriculum doesn't change)
    // Adjusted cache policy: shorter stale time to reflect progress updates faster?
    // Actually, user-specific data makes caching tricky. 
    // IF we are injecting user data, we must vary by user or not cache publicly!
    // Since we now inject user progress, we should remove public caching or cache the base tree only and fetch progress separately.
    // For simplicity, we'll keep it simple: no public cache if personalized, strictly. 
    // But verifyAuth is not called in the original function!
    // We should check auth here.

    const decoded = await verifyAuth(req);
    const user_uid = decoded?.uid;

    if (user_uid) {
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    } else {
        res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
    }

    const maxZyklus = req.query.max_zyklus ? parseInt(req.query.max_zyklus as string) : null;
    const fachbereich = req.query.fachbereich as string | undefined;

    try {
        let sql = `SELECT id, code, fachbereich, level, parent_code, zyklus, title, description
                   FROM curriculum_nodes`;
        const conditions: string[] = [];
        const args: (string | number)[] = [];

        if (fachbereich) {
            conditions.push('fachbereich = ?');
            args.push(fachbereich);
        }

        if (maxZyklus) {
            conditions.push('(zyklus IS NULL OR zyklus <= ?)');
            args.push(maxZyklus);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        sql += ' ORDER BY code';

        // Parallel fetch: nodes + user progress
        const [nodesResult, progressResult] = await Promise.all([
            db.execute({ sql, args }),
            user_uid ? db.execute({
                sql: "SELECT curriculum_node_id, mastery_level, status FROM user_curriculum_progress WHERE user_uid = ?",
                args: [user_uid]
            }) : Promise.resolve({ rows: [] })
        ]);

        const progressMap = new Map();
        if (progressResult.rows) {
            for (const row of progressResult.rows) {
                progressMap.set(row.curriculum_node_id, row);
            }
        }

        // Attach app mappings to nodes
        const nodes = nodesResult.rows.map(row => {
            const code = row.code as string;
            // Find matching apps: check the code itself and parent prefixes
            let apps: string[] = [];
            for (const [mapCode, mapApps] of Object.entries(CURRICULUM_APP_MAP)) {
                if (code.startsWith(mapCode) || mapCode.startsWith(code)) {
                    apps = [...new Set([...apps, ...mapApps])];
                }
            }

            const p = progressMap.get(row.id);

            return {
                id: row.id,
                code,
                fachbereich: row.fachbereich,
                level: row.level,
                parentCode: row.parent_code,
                zyklus: row.zyklus,
                title: row.title,
                description: row.description,
                apps: apps.length > 0 ? apps : undefined,
                mastery: p ? p.mastery_level : 0,
                status: p ? p.status : 'not_started'
            };
        });

        return res.status(200).json({ nodes });
    } catch (e: unknown) {
        console.error("Error fetching curriculum:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleReadingText(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

    const textId = req.query.text_id ? parseInt(req.query.text_id as string) : null;
    const maxZyklus = req.query.max_zyklus ? parseInt(req.query.max_zyklus as string) : 3;

    try {
        let textRow;

        if (textId) {
            // Fetch specific text
            const result = await db.execute({ sql: 'SELECT * FROM reading_texts WHERE id = ?', args: [textId] });
            textRow = result.rows[0];
        } else {
            // Fetch random text for the user's Zyklus level
            const result = await db.execute({
                sql: 'SELECT * FROM reading_texts WHERE zyklus <= ? ORDER BY RANDOM() LIMIT 1',
                args: [maxZyklus]
            });
            textRow = result.rows[0];
        }

        if (!textRow) {
            return res.status(404).json({ error: 'No text found' });
        }

        // Fetch reviewed questions for this text
        const questionsResult = await db.execute({
            sql: `SELECT id, tier, question_type, question, options, correct_answer, explanation, paragraph_index
                  FROM reading_questions 
                  WHERE text_id = ? AND reviewed = 1
                  ORDER BY paragraph_index, tier, id`,
            args: [textRow.id as number]
        });

        const questions = questionsResult.rows.map(q => ({
            id: q.id,
            tier: q.tier,
            questionType: q.question_type,
            question: q.question,
            options: q.options ? JSON.parse(q.options as string) : null,
            correctAnswer: q.correct_answer,
            explanation: q.explanation,
            paragraphIndex: q.paragraph_index,
        }));

        // Get all available text IDs for navigation
        const allTexts = await db.execute({
            sql: 'SELECT id, title, zyklus, word_count FROM reading_texts WHERE zyklus <= ? ORDER BY id',
            args: [maxZyklus]
        });

        return res.status(200).json({
            text: {
                id: textRow.id,
                title: textRow.title,
                text: textRow.text,
                sourceUrl: textRow.source_url,
                thema: textRow.thema,
                minAge: textRow.min_age,
                zyklus: textRow.zyklus,
                wordCount: textRow.word_count,
            },
            questions,
            availableTexts: allTexts.rows.map(t => ({
                id: t.id,
                title: t.title,
                zyklus: t.zyklus,
                wordCount: t.word_count,
            })),
        });
    } catch (e: unknown) {
        console.error("Error fetching reading text:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}
