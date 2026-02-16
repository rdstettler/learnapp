
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from '../_lib/turso.js';
import { requireAuth, handleCors } from '../_lib/auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    const db = getTursoClient();

    // Check Admin Status
    const user = await db.execute({
        sql: "SELECT is_admin FROM users WHERE uid = ?",
        args: [decoded.uid as string]
    });
    if (user.rows.length === 0 || !user.rows[0].is_admin) {
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

type DB = ReturnType<typeof getTursoClient>;

// GET — List texts with their questions, grouped by text
async function handleGetQuestions(req: VercelRequest, res: VercelResponse, db: DB) {
    const filterReviewed = req.query.reviewed; // 'all', '0', '1'
    const textId = req.query.text_id ? parseInt(req.query.text_id as string) : null;

    // Get all texts with question counts
    const textsResult = await db.execute(
        `SELECT rt.*, 
                COUNT(rq.id) as total_questions,
                SUM(CASE WHEN rq.reviewed = 1 THEN 1 ELSE 0 END) as approved_questions,
                SUM(CASE WHEN rq.reviewed = 0 THEN 1 ELSE 0 END) as pending_questions
         FROM reading_texts rt
         LEFT JOIN reading_questions rq ON rt.id = rq.text_id
         GROUP BY rt.id
         ORDER BY rt.id`
    );

    // Get questions (optionally filtered)
    let questionsSql = `SELECT rq.*, rt.title as text_title 
                         FROM reading_questions rq 
                         JOIN reading_texts rt ON rq.text_id = rt.id`;
    const args: (string | number)[] = [];

    const conditions: string[] = [];
    if (filterReviewed === '0' || filterReviewed === '1') {
        conditions.push('rq.reviewed = ?');
        args.push(parseInt(filterReviewed as string));
    }
    if (textId) {
        conditions.push('rq.text_id = ?');
        args.push(textId);
    }
    if (conditions.length > 0) {
        questionsSql += ' WHERE ' + conditions.join(' AND ');
    }
    questionsSql += ' ORDER BY rq.text_id, rq.paragraph_index, rq.tier, rq.id';

    const questionsResult = await db.execute({ sql: questionsSql, args });

    return res.status(200).json({
        texts: textsResult.rows.map(t => ({
            id: t.id,
            title: t.title,
            autor: t.autor,
            zyklus: t.zyklus,
            minAge: t.min_age,
            wordCount: t.word_count,
            totalQuestions: t.total_questions,
            approvedQuestions: t.approved_questions,
            pendingQuestions: t.pending_questions,
        })),
        questions: questionsResult.rows.map(q => ({
            id: q.id,
            textId: q.text_id,
            textTitle: q.text_title,
            tier: q.tier,
            questionType: q.question_type,
            question: q.question,
            options: q.options ? JSON.parse(q.options as string) : null,
            correctAnswer: q.correct_answer,
            explanation: q.explanation,
            paragraphIndex: q.paragraph_index,
            aiGenerated: q.ai_generated,
            reviewed: q.reviewed,
            createdAt: q.created_at,
        })),
    });
}

// PUT — Update a question (edit text, approve, etc.)
async function handleUpdateQuestion(req: VercelRequest, res: VercelResponse, db: DB) {
    const { id, question, options, correctAnswer, explanation, reviewed, tier, questionType } = req.body;

    if (!id) {
        return res.status(400).json({ error: 'Missing id' });
    }

    const updates: string[] = [];
    const args: (string | number | null)[] = [];

    if (question !== undefined) { updates.push('question = ?'); args.push(question); }
    if (options !== undefined) { updates.push('options = ?'); args.push(JSON.stringify(options)); }
    if (correctAnswer !== undefined) { updates.push('correct_answer = ?'); args.push(correctAnswer); }
    if (explanation !== undefined) { updates.push('explanation = ?'); args.push(explanation); }
    if (reviewed !== undefined) { updates.push('reviewed = ?'); args.push(reviewed); }
    if (tier !== undefined) { updates.push('tier = ?'); args.push(tier); }
    if (questionType !== undefined) { updates.push('question_type = ?'); args.push(questionType); }

    if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    args.push(id);

    await db.execute({
        sql: `UPDATE reading_questions SET ${updates.join(', ')} WHERE id = ?`,
        args
    });

    return res.status(200).json({ success: true });
}

// DELETE — Remove a question
async function handleDeleteQuestion(req: VercelRequest, res: VercelResponse, db: DB) {
    const id = req.query.id ? parseInt(req.query.id as string) : req.body?.id;
    if (!id) {
        return res.status(400).json({ error: 'Missing id' });
    }

    await db.execute({ sql: 'DELETE FROM reading_questions WHERE id = ?', args: [id] });
    return res.status(200).json({ success: true });
}

// POST — Bulk actions (approve all, reject all, regenerate)
async function handleBulkAction(req: VercelRequest, res: VercelResponse, db: DB) {
    const { action, textId, questionIds } = req.body;

    switch (action) {
        case 'approve-all': {
            const sql = textId
                ? 'UPDATE reading_questions SET reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE text_id = ? AND reviewed = 0'
                : 'UPDATE reading_questions SET reviewed = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (' + (questionIds || []).map(() => '?').join(',') + ')';
            const args = textId ? [textId] : (questionIds || []);
            const result = await db.execute({ sql, args });
            return res.status(200).json({ success: true, affected: result.rowsAffected });
        }

        case 'reject-all': {
            const sql = textId
                ? 'DELETE FROM reading_questions WHERE text_id = ? AND reviewed = 0'
                : 'DELETE FROM reading_questions WHERE id IN (' + (questionIds || []).map(() => '?').join(',') + ')';
            const args = textId ? [textId] : (questionIds || []);
            const result = await db.execute({ sql, args });
            return res.status(200).json({ success: true, affected: result.rowsAffected });
        }

        default:
            return res.status(400).json({ error: `Unknown action: ${action}` });
    }
}
