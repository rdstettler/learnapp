import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from './_lib/supabase.js';
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
    const db = getSupabaseClient();

    // Cache for 1 hour, reuse stale for 10 mins
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

    try {
        const { data: apps, error } = await db.from('apps').select('*');
        if (error) throw error;

        const processedApps = apps.map(row => {
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

        return res.status(200).json({ apps: processedApps });
    } catch (e: unknown) {
        console.error("Error fetching apps:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleAppContent(req: VercelRequest, res: VercelResponse, app_id: string) {
    const db = getSupabaseClient();
    const { skill_level, level, curriculum_node_id } = req.query;

    // Optional auth — personalize if logged in, anonymous fallback otherwise
    const decoded = await verifyAuth(req);
    const user_uid = decoded?.uid;

    try {
        // 1. Check for Procedural Config (app_config) if curriculum node is provided
        let appConfig = null;
        // Moved to parallel execution below



        // 2. Prepare Content Query
        let query = db.from('app_content').select('*').eq('app_id', app_id);

        // Filter by mode (for apps with multiple modes sharing the same app_id)
        if (req.query.mode) {
            query = query.eq('mode', req.query.mode as string);
        }

        // Filter by Curriculum Node
        if (curriculum_node_id) {
            const nodeId = parseInt(curriculum_node_id as string);
            query = query.select('*, app_content_curriculum!inner(curriculum_node_id)')
                .eq('app_content_curriculum.curriculum_node_id', nodeId);
        }

        if (skill_level) {
            const skillVal = parseFloat(skill_level as string);
            if (!isNaN(skillVal)) {
                query = query.or(`skill_level.is.null,skill_level.lte.${skillVal}`);
            }
        }

        // Only filter by level if NOT using curriculum node (legacy fallback)
        if (level && !curriculum_node_id) {
            const levelVal = parseInt(level as string);
            if (!isNaN(levelVal)) {
                query = query.or(`level.is.null,level.eq.${levelVal}`);
            }
        }

        // Execute queries in parallel
        const [appConfigData, contentResult, userProgressData] = await Promise.all([
            // Config query
            (curriculum_node_id ? db.from('app_config').select('config_json').eq('app_id', app_id).eq('curriculum_node_id', parseInt(curriculum_node_id as string)).single() : Promise.resolve({ data: null })),

            // Content query
            query,

            // User progress query
            (user_uid ? db.from('user_question_progress').select('app_content_id, success_count, failure_count, last_attempt_at').eq('user_uid', user_uid).eq('app_id', app_id) : Promise.resolve({ data: [] }))
        ]);

        const { data: contentRows, error: contentError } = contentResult;
        if (contentError) throw contentError;

        // Process Config
        if (appConfigData.data) {
            try {
                appConfig = JSON.parse(appConfigData.data.config_json);
            } catch (e) {
                console.error("Error parsing app_config", e);
            }
        }

        // Process Progress
        let userProgressMap = new Map();
        if (userProgressData.data) {
            userProgressData.data.forEach((p: any) => userProgressMap.set(p.app_content_id, p));
        }

        // Fetch User Progress separately if logged in
        // Moved to parallel execution above

        const content = contentRows.map(row => {
            let data = null;
            try {
                data = JSON.parse(row.data as string);
            } catch (e) {
                console.error("Error parsing content data", row.id);
            }

            if (user_uid) {
                const progress = userProgressMap.get(row.id);
                const s = (progress?.success_count as number) ?? 0;
                const f = (progress?.failure_count as number) ?? 0;
                const lastAttempt = progress?.last_attempt_at;

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
                    if (lastAttempt) {
                        const daysSince = (Date.now() - new Date(lastAttempt as string).getTime()) / 86400000;
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
    const db = getSupabaseClient();

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
        let query = db.from('curriculum_nodes').select('id, code, fachbereich, level, parent_code, zyklus, title, description');
        if (fachbereich) query = query.eq('fachbereich', fachbereich);
        if (maxZyklus) query = query.or(`zyklus.is.null,zyklus.lte.${maxZyklus}`);
        query = query.order('code');

        // Parallel fetch: nodes + user progress
        const [nodesResult, progressResult] = await Promise.all([
            query,
            user_uid ? db.from('user_curriculum_progress')
                .select('curriculum_node_id, mastery_level, status')
                .eq('user_uid', user_uid)
                : Promise.resolve({ data: [] })
        ]);

        const nodesRows = nodesResult.data || [];
        const progressRows = progressResult.data || [];

        const progressMap = new Map();
        for (const row of progressRows) {
            progressMap.set(row.curriculum_node_id, row);
        }

        // Attach app mappings to nodes
        const nodes = nodesRows.map(row => {
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
    const db = getSupabaseClient();
    res.setHeader('Cache-Control', 'no-cache');

    const textId = req.query.text_id ? parseInt(req.query.text_id as string) : null;
    const maxZyklus = req.query.max_zyklus ? parseInt(req.query.max_zyklus as string) : 3;

    // Optional auth — if logged in, we can return solved status
    const decoded = await verifyAuth(req);
    const userUid = decoded?.uid || null;

    try {
        // Fetch all texts for this zyklus level (needed for both random selection and available list)
        const { data: allTexts } = await db
            .from('reading_texts')
            .select('*')
            .lte('zyklus', maxZyklus);

        if (!allTexts || allTexts.length === 0) {
            return res.status(404).json({ error: 'No texts found' });
        }

        // Get solved text IDs for this user
        let solvedTextIds: Set<number> = new Set();
        if (userUid) {
            const { data: progress } = await db
                .from('user_reading_progress')
                .select('text_id')
                .eq('user_uid', userUid);
            if (progress) {
                solvedTextIds = new Set(progress.map((p: any) => p.text_id));
            }
        }

        let textRow: any;

        if (textId) {
            // Fetch specific text
            textRow = allTexts.find((t: any) => t.id === textId);
        } else {
            // Prefer unsolved texts for random selection
            const unsolved = allTexts.filter((t: any) => !solvedTextIds.has(t.id));
            const pool = unsolved.length > 0 ? unsolved : allTexts;
            const randomIndex = Math.floor(Math.random() * pool.length);
            textRow = pool[randomIndex];
        }

        if (!textRow) {
            return res.status(404).json({ error: 'No text found' });
        }

        // Fetch reviewed questions for this text
        const { data: questionsData } = await db
            .from('reading_questions')
            .select('id, tier, question_type, question, options, correct_answer, explanation, paragraph_index')
            .eq('text_id', textRow.id)
            .eq('reviewed', true)
            .order('paragraph_index', { ascending: true })
            .order('tier', { ascending: true })
            .order('id', { ascending: true });

        const questions = (questionsData || []).map(q => ({
            id: q.id,
            tier: q.tier,
            questionType: q.question_type,
            question: q.question,
            options: q.options ? JSON.parse(q.options as string) : null,
            correctAnswer: q.correct_answer,
            explanation: q.explanation,
            paragraphIndex: q.paragraph_index,
        }));

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
            availableTexts: allTexts.map((t: any) => ({
                id: t.id,
                title: t.title,
                zyklus: t.zyklus,
                wordCount: t.word_count,
                solved: solvedTextIds.has(t.id),
            })),
        });
    } catch (e: unknown) {
        console.error("Error fetching reading text:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}
