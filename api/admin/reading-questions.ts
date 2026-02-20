
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabaseClient } from '../_lib/supabase.js';
import { requireAuth, handleCors } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const db = getSupabaseClient();

    // Check Admin Status
    const { data: user, error: userError } = await db
        .from('users')
        .select('is_admin')
        .eq('uid', decoded.uid)
        .single();
    if (userError || !user || !user.is_admin) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        switch (req.method) {
            case 'GET':
                return handleGetQuestions(req, res, db);
            case 'PUT':
                return handleUpdateQuestion(req, res, db);
            case 'DELETE':
                return handleDeleteQuestion(req, res, db);
            case 'POST':
                return handleBulkAction(req, res, db);
            default:
                return res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (e: unknown) {
        console.error("Admin reading questions error:", e);
        return res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
    }
}

async function handleGetQuestions(req: VercelRequest, res: VercelResponse, db: any) {
    const filterReviewed = req.query.reviewed; // 'all', '0', '1'
    const textId = req.query.text_id ? parseInt(req.query.text_id as string) : null;

    // Get all texts
    const { data: texts, error: textsError } = await db
        .from('reading_texts')
        .select('*')
        .order('id');

    if (textsError) throw textsError;

    // Get stats for texts (aggregate query workaround)
    // We fetch all questions (lightweight props) to count them, or use a separate stats query if volume is high.
    // Given the admin nature, fetching all questions ID/text_id/reviewed is likely fine.
    const { data: questionStats, error: statsError } = await db
        .from('reading_questions')
        .select('id, text_id, reviewed');

    if (statsError) throw statsError;

    const statsMap = new Map<number, { total: number, approved: number, pending: number }>();
    for (const q of questionStats || []) {
        const tid = q.text_id;
        const entry = statsMap.get(tid) || { total: 0, approved: 0, pending: 0 };
        entry.total++;
        if (q.reviewed) entry.approved++;
        else entry.pending++;
        statsMap.set(tid, entry);
    }

    const enrichedTexts = texts.map((t: any) => {
        const s = statsMap.get(t.id) || { total: 0, approved: 0, pending: 0 };
        return {
            id: t.id,
            title: t.title,
            autor: t.autor,
            zyklus: t.zyklus,
            minAge: t.min_age,
            wordCount: t.word_count,
            totalQuestions: s.total,
            approvedQuestions: s.approved,
            pendingQuestions: s.pending,
        };
    });

    // Get questions filtered
    let query = db.from('reading_questions').select('*, reading_texts(title)');

    if (filterReviewed === '0' || filterReviewed === '1') {
        query = query.eq('reviewed', filterReviewed === '1');
    }
    if (textId) {
        query = query.eq('text_id', textId);
    }

    query = query.order('text_id').order('paragraph_index').order('tier').order('id');

    const { data: questions, error: questionsError } = await query;
    if (questionsError) throw questionsError;

    return res.status(200).json({
        texts: enrichedTexts,
        questions: questions.map((q: any) => ({
            id: q.id,
            textId: q.text_id,
            textTitle: q.reading_texts?.title, // Join result
            tier: q.tier,
            questionType: q.question_type,
            question: q.question,
            options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
            correctAnswer: q.correct_answer,
            explanation: q.explanation,
            paragraphIndex: q.paragraph_index,
            aiGenerated: Boolean(q.ai_generated),
            reviewed: Boolean(q.reviewed),
            createdAt: q.created_at,
        })),
    });
}

async function handleUpdateQuestion(req: VercelRequest, res: VercelResponse, db: any) {
    const { id, question, options, correctAnswer, explanation, reviewed, tier, questionType } = req.body;

    if (!id) return res.status(400).json({ error: 'Missing id' });

    const updates: any = { updated_at: new Date().toISOString() };
    if (question !== undefined) updates.question = question;
    if (options !== undefined) updates.options = JSON.stringify(options);
    if (correctAnswer !== undefined) updates.correct_answer = correctAnswer;
    if (explanation !== undefined) updates.explanation = explanation;
    if (reviewed !== undefined) updates.reviewed = reviewed;
    if (tier !== undefined) updates.tier = tier;
    if (questionType !== undefined) updates.question_type = questionType;

    const { error } = await db.from('reading_questions').update(updates).eq('id', id);
    if (error) throw error;

    return res.status(200).json({ success: true });
}

async function handleDeleteQuestion(req: VercelRequest, res: VercelResponse, db: any) {
    const id = req.query.id ? parseInt(req.query.id as string) : req.body?.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const { error } = await db.from('reading_questions').delete().eq('id', id);
    if (error) throw error;

    return res.status(200).json({ success: true });
}

async function handleBulkAction(req: VercelRequest, res: VercelResponse, db: any) {
    const { action, textId, questionIds } = req.body;

    // Helper to get query builder
    const getQuery = () => db.from('reading_questions');

    try {
        if (action === 'approve-all') {
            let query = getQuery().update({ reviewed: true, updated_at: new Date().toISOString() });

            if (textId) {
                query = query.eq('text_id', textId).eq('reviewed', false);
            } else if (questionIds && questionIds.length > 0) {
                query = query.in('id', questionIds);
            } else {
                return res.status(400).json({ error: 'Missing filter for approve-all' });
            }

            const { error, count } = await query.select('id', { count: 'exact' }); // Select to return count if possible, or just execution
            // update doesn't return count directly in JS client v2 unless select is chained?
            // Actually it just returns data/error. 
            if (error) throw error;
            return res.status(200).json({ success: true, affected: count || 'unknown' });
        }
        else if (action === 'reject-all') {
            let query = getQuery().delete();

            if (textId) {
                query = query.eq('text_id', textId).eq('reviewed', false);
            } else if (questionIds && questionIds.length > 0) {
                query = query.in('id', questionIds);
            } else {
                return res.status(400).json({ error: 'Missing filter for reject-all' });
            }

            const { error, count } = await query.select('id', { count: 'exact' });
            if (error) throw error;
            return res.status(200).json({ success: true, affected: count || 'unknown' });
        }
        else {
            return res.status(400).json({ error: `Unknown action: ${action}` });
        }
    } catch (e: unknown) {
        throw e;
    }
}
