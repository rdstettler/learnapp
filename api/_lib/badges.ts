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
 *  - check: SQL query + threshold logic (used server-side only)
 */

export interface BadgeDefinition {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: 'first-steps' | 'streak' | 'mastery' | 'explorer' | 'special';
    tier: 'bronze' | 'silver' | 'gold' | 'diamond';
    /** 
     * Server-side check descriptor.
     * - query: SQL with ? placeholder for user_uid
     * - threshold: the count value the query result must reach (>=)
     */
    check: {
        query: string;
        threshold: number;
    };
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
            query: `SELECT COUNT(*) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `SELECT COUNT(*) as count FROM user_question_progress WHERE user_uid = ? AND success_count >= 1 AND failure_count = 0`,
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
            query: `SELECT COUNT(DISTINCT session_id) as count FROM learning_session WHERE user_uid = ? AND pristine = 0`,
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
            query: `SELECT COALESCE(SUM(success_count + failure_count), 0) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `SELECT COALESCE(SUM(success_count + failure_count), 0) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `SELECT COALESCE(SUM(success_count + failure_count), 0) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `SELECT COALESCE(SUM(success_count + failure_count), 0) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `SELECT COALESCE(SUM(success_count), 0) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `SELECT COALESCE(SUM(success_count), 0) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `SELECT COUNT(DISTINCT app_id) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `SELECT COUNT(DISTINCT app_id) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `SELECT COUNT(DISTINCT app_id) as count FROM user_question_progress WHERE user_uid = ?`,
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
            query: `WITH dates AS (
                SELECT activity_date, ROW_NUMBER() OVER (ORDER BY activity_date) as rn
                FROM user_daily_activity WHERE user_uid = ?
            ),
            groups AS (
                SELECT activity_date, DATE(activity_date, '-' || rn || ' days') as grp FROM dates
            )
            SELECT MAX(cnt) as count FROM (SELECT COUNT(*) as cnt FROM groups GROUP BY grp)`,
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
            query: `WITH dates AS (
                SELECT activity_date, ROW_NUMBER() OVER (ORDER BY activity_date) as rn
                FROM user_daily_activity WHERE user_uid = ?
            ),
            groups AS (
                SELECT activity_date, DATE(activity_date, '-' || rn || ' days') as grp FROM dates
            )
            SELECT MAX(cnt) as count FROM (SELECT COUNT(*) as cnt FROM groups GROUP BY grp)`,
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
            query: `WITH dates AS (
                SELECT activity_date, ROW_NUMBER() OVER (ORDER BY activity_date) as rn
                FROM user_daily_activity WHERE user_uid = ?
            ),
            groups AS (
                SELECT activity_date, DATE(activity_date, '-' || rn || ' days') as grp FROM dates
            )
            SELECT MAX(cnt) as count FROM (SELECT COUNT(*) as cnt FROM groups GROUP BY grp)`,
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
            query: `WITH dates AS (
                SELECT activity_date, ROW_NUMBER() OVER (ORDER BY activity_date) as rn
                FROM user_daily_activity WHERE user_uid = ?
            ),
            groups AS (
                SELECT activity_date, DATE(activity_date, '-' || rn || ' days') as grp FROM dates
            )
            SELECT MAX(cnt) as count FROM (SELECT COUNT(*) as cnt FROM groups GROUP BY grp)`,
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
            query: `SELECT COUNT(DISTINCT session_id) as count FROM learning_session WHERE user_uid = ? AND pristine = 0`,
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
            query: `SELECT COUNT(DISTINCT session_id) as count FROM learning_session WHERE user_uid = ? AND pristine = 0`,
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
            query: `SELECT COUNT(*) as count FROM feedback WHERE user_uid = ?`,
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
            query: `SELECT COUNT(*) as count FROM user_question_progress WHERE user_uid = ? AND success_count >= 3 AND failure_count = 0`,
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
            query: `SELECT COUNT(*) as count FROM user_question_progress WHERE user_uid = ? AND success_count >= 3 AND failure_count = 0`,
            threshold: 25
        }
    }
];

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
