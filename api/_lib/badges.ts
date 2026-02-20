/**
 * Badge definitions — single source of truth for the entire app.
 * 
 * Each badge has:
 *  - id: unique key stored in user_badges table
 *  - name: display name (German)
 *  - description: short explanation of how to earn it
 *  - icon: emoji icon
 *  - category: grouping for UI display
 *  - tier: visual tier (bronze | silver | gold | diamond)
 *  - check: async function + threshold (used server-side only)
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface BadgeDefinition {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: 'first-steps' | 'streak' | 'mastery' | 'explorer' | 'special';
    tier: 'bronze' | 'silver' | 'gold' | 'diamond';
    check: {
        fn: (db: SupabaseClient, uid: string) => Promise<number>;
        threshold: number;
    };
}

// --- Helper: count rows with simple filters ---
async function countRows(db: SupabaseClient, table: string, uid: string, extraFilters?: (q: any) => any): Promise<number> {
    let query = db.from(table).select('*', { count: 'exact', head: true }).eq('user_uid', uid);
    if (extraFilters) query = extraFilters(query);
    const { count } = await query;
    return count || 0;
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
    // ═══════════════════════════════════════
    //  FIRST STEPS
    // ═══════════════════════════════════════
    {
        id: 'first_question',
        name: 'Erste Frage',
        description: 'Beantworte deine allererste Frage',
        icon: '🌱',
        category: 'first-steps',
        tier: 'bronze',
        check: {
            fn: (db, uid) => countRows(db, 'user_question_progress', uid),
            threshold: 1
        }
    },
    {
        id: 'first_perfect',
        name: 'Perfekter Start',
        description: 'Beantworte eine Frage beim ersten Versuch richtig',
        icon: '⭐',
        category: 'first-steps',
        tier: 'bronze',
        check: {
            fn: (db, uid) => countRows(db, 'user_question_progress', uid, q => q.gte('success_count', 1).eq('failure_count', 0)),
            threshold: 1
        }
    },
    {
        id: 'first_session',
        name: 'Erste Lernsession',
        description: 'Schliesse deine erste KI-Lernsession ab',
        icon: '🎓',
        category: 'first-steps',
        tier: 'bronze',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_count_distinct_sessions', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 1
        }
    },

    // ═══════════════════════════════════════
    //  MASTERY — question counts
    // ═══════════════════════════════════════
    {
        id: 'questions_10',
        name: 'Fleissig',
        description: 'Beantworte 10 Fragen',
        icon: '📝',
        category: 'mastery',
        tier: 'bronze',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_total_answers', { p_user_uid: uid });
                return Number(data) || 0;
            },
            threshold: 10
        }
    },
    {
        id: 'questions_50',
        name: 'Wissensdurst',
        description: 'Beantworte 50 Fragen',
        icon: '📚',
        category: 'mastery',
        tier: 'silver',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_total_answers', { p_user_uid: uid });
                return Number(data) || 0;
            },
            threshold: 50
        }
    },
    {
        id: 'questions_200',
        name: 'Bücherwurm',
        description: 'Beantworte 200 Fragen',
        icon: '🐛',
        category: 'mastery',
        tier: 'gold',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_total_answers', { p_user_uid: uid });
                return Number(data) || 0;
            },
            threshold: 200
        }
    },
    {
        id: 'questions_500',
        name: 'Meisterhirn',
        description: 'Beantworte 500 Fragen',
        icon: '🧠',
        category: 'mastery',
        tier: 'diamond',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_total_answers', { p_user_uid: uid });
                return Number(data) || 0;
            },
            threshold: 500
        }
    },

    // ═══════════════════════════════════════
    //  MASTERY — correct answers
    // ═══════════════════════════════════════
    {
        id: 'correct_10',
        name: 'Treffsicher',
        description: '10 richtige Antworten',
        icon: '🎯',
        category: 'mastery',
        tier: 'bronze',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_total_correct', { p_user_uid: uid });
                return Number(data) || 0;
            },
            threshold: 10
        }
    },
    {
        id: 'correct_100',
        name: 'Scharfschütze',
        description: '100 richtige Antworten',
        icon: '🏹',
        category: 'mastery',
        tier: 'gold',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_total_correct', { p_user_uid: uid });
                return Number(data) || 0;
            },
            threshold: 100
        }
    },

    // ═══════════════════════════════════════
    //  EXPLORER — app variety
    // ═══════════════════════════════════════
    {
        id: 'explorer_3',
        name: 'Entdecker',
        description: 'Probiere 3 verschiedene Lern-Apps aus',
        icon: '🗺️',
        category: 'explorer',
        tier: 'bronze',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_count_distinct_apps', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 3
        }
    },
    {
        id: 'explorer_7',
        name: 'Weltreisender',
        description: 'Probiere 7 verschiedene Lern-Apps aus',
        icon: '🌍',
        category: 'explorer',
        tier: 'silver',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_count_distinct_apps', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 7
        }
    },
    {
        id: 'explorer_all',
        name: 'Universalgenie',
        description: 'Probiere alle Lern-Apps aus',
        icon: '🦄',
        category: 'explorer',
        tier: 'diamond',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_count_distinct_apps', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 12
        }
    },

    // ═══════════════════════════════════════
    //  STREAK — consecutive active days
    // ═══════════════════════════════════════
    {
        id: 'streak_3',
        name: 'Dranbleiber',
        description: '3 Tage hintereinander gelernt',
        icon: '🔥',
        category: 'streak',
        tier: 'bronze',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_max_streak', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 3
        }
    },
    {
        id: 'streak_7',
        name: 'Wochenläufer',
        description: '7 Tage hintereinander gelernt',
        icon: '🔥',
        category: 'streak',
        tier: 'silver',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_max_streak', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 7
        }
    },
    {
        id: 'streak_14',
        name: 'Unaufhaltsam',
        description: '14 Tage hintereinander gelernt',
        icon: '🚀',
        category: 'streak',
        tier: 'gold',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_max_streak', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 14
        }
    },
    {
        id: 'streak_30',
        name: 'Monatsmeister',
        description: '30 Tage hintereinander gelernt',
        icon: '💎',
        category: 'streak',
        tier: 'diamond',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_max_streak', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 30
        }
    },
    {
        id: 'sessions_5',
        name: 'Am Ball',
        description: 'Schliesse 5 KI-Lernsessions ab',
        icon: '🎓',
        category: 'streak',
        tier: 'silver',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_count_distinct_sessions', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 5
        }
    },
    {
        id: 'sessions_20',
        name: 'Sessionprofi',
        description: 'Schliesse 20 KI-Lernsessions ab',
        icon: '📖',
        category: 'streak',
        tier: 'gold',
        check: {
            fn: async (db, uid) => {
                const { data } = await db.rpc('fn_count_distinct_sessions', { p_user_uid: uid });
                return (data as number) || 0;
            },
            threshold: 20
        }
    },

    // ═══════════════════════════════════════
    //  SPECIAL
    // ═══════════════════════════════════════
    {
        id: 'feedback_hero',
        name: 'Feedback-Held',
        description: 'Melde einen Fehler oder gib Feedback',
        icon: '💬',
        category: 'special',
        tier: 'bronze',
        check: {
            fn: (db, uid) => countRows(db, 'feedback', uid),
            threshold: 1
        }
    },
    {
        id: 'mastery_5',
        name: 'Meisterlehrling',
        description: 'Beherrsche 5 Fragen vollständig (3+ richtige ohne Fehler)',
        icon: '🏅',
        category: 'mastery',
        tier: 'silver',
        check: {
            fn: (db, uid) => countRows(db, 'user_question_progress', uid, q => q.gte('success_count', 3).eq('failure_count', 0)),
            threshold: 5
        }
    },
    {
        id: 'mastery_25',
        name: 'Grossmeister',
        description: 'Beherrsche 25 Fragen vollständig (3+ richtige ohne Fehler)',
        icon: '👑',
        category: 'mastery',
        tier: 'diamond',
        check: {
            fn: (db, uid) => countRows(db, 'user_question_progress', uid, q => q.gte('success_count', 3).eq('failure_count', 0)),
            threshold: 25
        }
    }
];

/**
 * Batched badge checking.
 * Instead of N separate queries, we fetch all necessary stats in one go
 * and then evaluate the badges in memory.
 */
export async function checkAllBadges(db: SupabaseClient, uid: string, existingBadgeIds: Set<string>): Promise<string[]> {
    // 1. Fetch all stats in parallel
    const [
        totalAnswersRes,
        totalCorrectRes,
        distinctAppsRes,
        maxStreakRes,
        distinctSessionsRes,
        feedbackCountRes, // countRows(db, 'feedback', uid)
        perfectQuestionsRes, // countRows(db, 'user_question_progress', uid, q => q.gte('success_count', 1).eq('failure_count', 0))
        masteredQuestionsRes, // countRows(db, 'user_question_progress', uid, q => q.gte('success_count', 3).eq('failure_count', 0))
        totalQuestionsRes // countRows(db, 'user_question_progress', uid)
    ] = await Promise.all([
        db.rpc('fn_total_answers', { p_user_uid: uid }),
        db.rpc('fn_total_correct', { p_user_uid: uid }),
        db.rpc('fn_count_distinct_apps', { p_user_uid: uid }),
        db.rpc('fn_max_streak', { p_user_uid: uid }),
        db.rpc('fn_count_distinct_sessions', { p_user_uid: uid }),
        db.from('feedback').select('*', { count: 'exact', head: true }).eq('user_uid', uid),
        db.from('user_question_progress').select('*', { count: 'exact', head: true }).eq('user_uid', uid).gte('success_count', 1).eq('failure_count', 0),
        db.from('user_question_progress').select('*', { count: 'exact', head: true }).eq('user_uid', uid).gte('success_count', 3).eq('failure_count', 0),
        db.from('user_question_progress').select('*', { count: 'exact', head: true }).eq('user_uid', uid)
    ]);

    const stats = {
        totalAnswers: Number(totalAnswersRes.data) || 0,
        totalCorrect: Number(totalCorrectRes.data) || 0,
        distinctApps: Number(distinctAppsRes.data) || 0,
        maxStreak: Number(maxStreakRes.data) || 0,
        distinctSessions: Number(distinctSessionsRes.data) || 0,
        feedbackCount: feedbackCountRes.count || 0,
        perfectQuestions: perfectQuestionsRes.count || 0,
        masteredQuestions: masteredQuestionsRes.count || 0,
        totalQuestions: totalQuestionsRes.count || 0
    };

    const newlyAwarded: string[] = [];

    // 2. Evaluators (sync)
    const EVALUATORS: Record<string, (s: typeof stats) => boolean> = {
        'first_question': s => s.totalQuestions >= 1,
        'first_perfect': s => s.perfectQuestions >= 1,
        'first_session': s => s.distinctSessions >= 1,
        'questions_10': s => s.totalAnswers >= 10,
        'questions_50': s => s.totalAnswers >= 50,
        'questions_200': s => s.totalAnswers >= 200,
        'questions_500': s => s.totalAnswers >= 500,
        'correct_10': s => s.totalCorrect >= 10,
        'correct_100': s => s.totalCorrect >= 100,
        'explorer_3': s => s.distinctApps >= 3,
        'explorer_7': s => s.distinctApps >= 7,
        'explorer_all': s => s.distinctApps >= 12, // TODO: Dynamic app count?
        'streak_3': s => s.maxStreak >= 3,
        'streak_7': s => s.maxStreak >= 7,
        'streak_14': s => s.maxStreak >= 14,
        'streak_30': s => s.maxStreak >= 30,
        'sessions_5': s => s.distinctSessions >= 5,
        'sessions_20': s => s.distinctSessions >= 20,
        'feedback_hero': s => s.feedbackCount >= 1,
        'mastery_5': s => s.masteredQuestions >= 5,
        'mastery_25': s => s.masteredQuestions >= 25
    };

    // 3. Check all badges
    for (const badge of BADGE_DEFINITIONS) {
        if (existingBadgeIds.has(badge.id)) continue;

        const evaluator = EVALUATORS[badge.id];
        if (evaluator && evaluator(stats)) {
            newlyAwarded.push(badge.id);
        }
    }

    return newlyAwarded;
}

/**
 * Lightweight badge info for the frontend (no SQL queries).
 */
export interface BadgeInfo {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    tier: string;
}

export function getBadgeInfoList(): BadgeInfo[] {
    return BADGE_DEFINITIONS.map(({ id, name, description, icon, category, tier }) => ({
        id, name, description, icon, category, tier
    }));
}
