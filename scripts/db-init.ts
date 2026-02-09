
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function initDB() {
    const db = getTursoClient();

    console.log("Starting Database Initialization...");

    const tables = [
        {
            name: "users",
            sql: `CREATE TABLE IF NOT EXISTS users (
                uid TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                display_name TEXT,
                photo_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                avatar_config TEXT,
                avatar_svg TEXT,
                skill_level REAL,
                learn_level INTEGER,
                is_admin BOOLEAN DEFAULT 0,
                language_variant TEXT DEFAULT 'swiss'
            )`
        },
        {
            name: "telemetry_events",
            sql: `CREATE TABLE IF NOT EXISTS telemetry_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT NOT NULL,
                app_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                metadata TEXT,
                FOREIGN KEY (user_uid) REFERENCES users(uid)
            )`
        },
        {
            name: "user_metrics",
            sql: `CREATE TABLE IF NOT EXISTS user_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT NOT NULL,
                app_id TEXT NOT NULL,
                open_count INTEGER DEFAULT 0,
                last_opened DATETIME,
                UNIQUE(user_uid, app_id),
                FOREIGN KEY (user_uid) REFERENCES users(uid)
            )`
        },
        {
            name: "apps",
            sql: `CREATE TABLE IF NOT EXISTS apps (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT,
                route TEXT,
                icon TEXT,
                tags TEXT,
                featured BOOLEAN DEFAULT 0,
                min_learn_level INTEGER,
                min_skill_level INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                type TEXT DEFAULT 'tool',
                data_structure TEXT
            )`
        },
        {
            name: "app_results",
            sql: `CREATE TABLE IF NOT EXISTS app_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id TEXT NOT NULL,
                user_uid TEXT NOT NULL,
                session_id TEXT,
                content TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                processed BOOLEAN DEFAULT 0
            )`
        },
        {
            name: "user_apps",
            sql: `CREATE TABLE IF NOT EXISTS user_apps (
                user_uid TEXT NOT NULL,
                app_id TEXT NOT NULL,
                is_favorite BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_uid, app_id)
            )`
        },
        {
            name: "app_content",
            sql: `CREATE TABLE IF NOT EXISTS app_content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id TEXT NOT NULL,
                data TEXT NOT NULL,
                level INTEGER,
                skill_level REAL,
                ai_generated BOOLEAN DEFAULT 0,
                human_verified BOOLEAN DEFAULT 0,
                flag_counter INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                ai_reviewed_counter INTEGER DEFAULT 0
            )`
        },
        {
            name: "learning_session",
            sql: `CREATE TABLE IF NOT EXISTS learning_session (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT NOT NULL,
                session_id TEXT NOT NULL,
                app_id TEXT NOT NULL,
                content TEXT,
                order_index INTEGER,
                pristine BOOLEAN DEFAULT 1,
                topic TEXT,
                text TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                theory TEXT
            )`
        },
        {
            name: "learn_results",
            sql: `CREATE TABLE IF NOT EXISTS learn_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT NOT NULL,
                app_id TEXT NOT NULL,
                score INTEGER NOT NULL,
                max_score INTEGER NOT NULL,
                completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                duration_seconds INTEGER,
                details TEXT,
                FOREIGN KEY (user_uid) REFERENCES users(uid)
            )`
        },
        {
            name: "ai_logs",
            sql: `CREATE TABLE IF NOT EXISTS ai_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT,
                session_id TEXT,
                prompt TEXT,
                system_prompt TEXT,
                response TEXT,
                provider TEXT,
                model TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        },
        {
            name: "feedback",
            sql: `CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT,
                app_id TEXT NOT NULL,
                session_id TEXT,
                content TEXT,
                comment TEXT,
                error_type TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                target_id TEXT,
                resolved BOOLEAN DEFAULT 0,
                resolution_reason TEXT
            )`
        },
        {
            name: "user_question_progress",
            sql: `CREATE TABLE IF NOT EXISTS user_question_progress (
                user_uid TEXT NOT NULL,
                app_id TEXT NOT NULL,
                app_content_id INTEGER NOT NULL,
                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_uid, app_content_id)
            )`
        },
        {
            name: "user_badges",
            sql: `CREATE TABLE IF NOT EXISTS user_badges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT NOT NULL,
                badge_id TEXT NOT NULL,
                awarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_uid, badge_id),
                FOREIGN KEY (user_uid) REFERENCES users(uid)
            )`
        },
        {
            name: "learning_plans",
            sql: `CREATE TABLE IF NOT EXISTS learning_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT NOT NULL,
                plan_id TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT DEFAULT 'active',
                total_days INTEGER DEFAULT 1,
                plan_data TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME,
                FOREIGN KEY (user_uid) REFERENCES users(uid)
            )`
        },
        {
            name: "learning_plan_tasks",
            sql: `CREATE TABLE IF NOT EXISTS learning_plan_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id TEXT NOT NULL,
                day_number INTEGER NOT NULL,
                order_index INTEGER NOT NULL,
                app_id TEXT NOT NULL,
                app_content_id INTEGER NOT NULL,
                completed BOOLEAN DEFAULT 0,
                completed_at DATETIME,
                FOREIGN KEY (plan_id) REFERENCES learning_plans(plan_id),
                FOREIGN KEY (app_content_id) REFERENCES app_content(id)
            )`
        }
    ];

    for (const table of tables) {
        try {
            await db.execute(table.sql);
            console.log(`Verified/Created table: ${table.name}`);
        } catch (e) {
            console.error(`Error creating table ${table.name}:`, e.message);
        }
    }

    // Seed apps
    try {
        const appsConfig = {
            "apps": [
                {
                    "id": "aehnlichewoerter",
                    "name": "Ähnliche Wörter",
                    "description": "Lerne den Unterschied zwischen ähnlich klingenden Wörtern wie viel/fiel, seid/seit, wieder/wider",
                    "category": "Deutsch",
                    "route": "/aehnlichewoerter",
                    "icon": "🔤",
                    "type": "learning",
                    "tags": ["deutsch", "rechtschreibung", "synonyme", "ähnliche wörter"],
                    "data_structure": "{ \"pairs\": [{\"word1\": \"string\", \"word2\": \"string\", \"explanation\": \"string\"}] }"
                },
                {
                    "id": "oberbegriffe",
                    "name": "Oberbegriffe",
                    "description": "Finde den passenden Oberbegriff für eine Gruppe von Wörtern",
                    "category": "Deutsch",
                    "route": "/oberbegriffe",
                    "icon": "🏷️",
                    "type": "learning",
                    "tags": ["deutsch", "wortschatz", "kategorien", "oberbegriffe"],
                    "data_structure": "{ \"question\": \"string\", \"options\": [\"string\"], \"answer\": \"string\" }"
                },
                {
                    "id": "wortfamilie",
                    "name": "Wortfamilie",
                    "description": "Ergänze die fehlenden Wortarten: Nomen, Verb und Adjektiv einer Wortfamilie",
                    "category": "Deutsch",
                    "route": "/wortfamilie",
                    "icon": "👨‍👩‍👧",
                    "type": "learning",
                    "tags": ["deutsch", "grammatik", "wortarten", "wortfamilie"],
                    "data_structure": "{ \"nomen\": \"string\", \"verb\": \"string\", \"adjektiv\": \"string\" }"
                },
                {
                    "id": "symmetry",
                    "name": "Symmetry Drawing",
                    "description": "Kreatives Zeichnen mit rotierender Symmetrie - male Mandalas und mehr!",
                    "category": "Geometrie",
                    "route": "/symmetry",
                    "icon": "✨",
                    "type": "tool",
                    "tags": ["drawing", "geometry", "symmetry", "creative"]
                },
                {
                    "id": "symmetrien",
                    "name": "Symmetrien an Punkt und Strich",
                    "description": "Zeichne Polygone und spiegle sie an Punkt und Gerade",
                    "category": "Geometrie",
                    "route": "/symmetrien",
                    "icon": "🔀",
                    "type": "learning",
                    "tags": ["geometry", "symmetry", "mirroring", "polygon"]
                },
                {
                    "id": "wortstaemme",
                    "name": "Wortstamm-Quiz",
                    "description": "Deutsches Wortstamm-Lernquiz zum Entdecken von Wortfamilien",
                    "category": "Deutsch",
                    "route": "/wortstaemme",
                    "icon": "📝",
                    "type": "learning",
                    "tags": ["deutsch", "sprache", "quiz"]
                },
                {
                    "id": "verben",
                    "name": "Verben-Quiz",
                    "description": "Teste dein Wissen über deutsche Verbkonjugation",
                    "category": "Deutsch",
                    "route": "/verben",
                    "icon": "✍️",
                    "type": "learning",
                    "tags": ["deutsch", "grammatik", "verben"]
                },
                {
                    "id": "kasus",
                    "name": "Kasus-Quiz",
                    "description": "Lerne die deutschen Fälle - Nominativ, Akkusativ, Dativ und Genitiv",
                    "category": "Deutsch",
                    "route": "/kasus",
                    "icon": "📖",
                    "type": "learning",
                    "tags": ["deutsch", "grammatik", "kasus", "fälle"],
                    "data_structure": "{ \"sentences\": [\"string\"] }"
                },
                {
                    "id": "redewendungen",
                    "name": "Redewendungen-Quiz",
                    "description": "Lerne deutsche Redewendungen und ihre Bedeutungen",
                    "category": "Deutsch",
                    "route": "/redewendungen",
                    "icon": "🎭",
                    "type": "learning",
                    "tags": ["deutsch", "redewendungen", "idiome", "sprache"]
                },
                {
                    "id": "satzzeichen",
                    "name": "Satzzeichen-Quiz",
                    "description": "Setze die fehlenden Satzzeichen in Texte mit wörtlicher Rede ein",
                    "category": "Deutsch",
                    "route": "/satzzeichen",
                    "icon": "✏️",
                    "type": "learning",
                    "tags": ["deutsch", "grammatik", "satzzeichen", "zeichensetzung"]
                },
                {
                    "id": "fehler",
                    "name": "Fehler finden",
                    "description": "Finde und korrigiere die Rechtschreib- und Grammatikfehler im Text",
                    "category": "Deutsch",
                    "route": "/fehler",
                    "icon": "🔍",
                    "type": "learning",
                    "tags": ["deutsch", "rechtschreibung", "grammatik", "korrektur"]
                },
                {
                    "id": "dasdass",
                    "name": "Das/Dass-Quiz",
                    "description": "Lerne den Unterschied zwischen 'das' und 'dass' kennen",
                    "category": "Deutsch",
                    "route": "/dasdass",
                    "icon": "🎯",
                    "type": "learning",
                    "tags": ["deutsch", "grammatik", "rechtschreibung", "das", "dass"],
                    "data_structure": "{ \"sentences\": [\"string\"] }"
                },
                {
                    "id": "textaufgaben",
                    "name": "Textaufgaben",
                    "description": "Löse mathematische Textaufgaben aus verschiedenen Themengebieten",
                    "category": "Mathematik",
                    "route": "/textaufgaben",
                    "icon": "🧮",
                    "type": "learning",
                    "tags": ["mathematik", "textaufgaben", "proportionalität", "rechnen"],
                    "data_structure": "{ \"question\": \"string\", \"answers\": [\"string\"], \"explanation\": \"string\" }"
                },
                {
                    "id": "kopfrechnen",
                    "name": "Kopfrechnen",
                    "description": "Trainiere dein Kopfrechnen mit Addition und Division",
                    "category": "Mathematik",
                    "route": "/kopfrechnen",
                    "icon": "🧠",
                    "type": "learning",
                    "tags": ["mathematik", "kopfrechnen", "addition", "division"]
                },
                {
                    "id": "umrechnen",
                    "name": "Umrechnen",
                    "description": "Übe das Umrechnen von Einheiten: Längen, Flächen, Volumen, Hohlmasse und Gewicht",
                    "category": "Mathematik",
                    "route": "/umrechnen",
                    "icon": "📐",
                    "type": "learning",
                    "tags": ["mathematik", "umrechnen", "einheiten", "masse", "gewicht"]
                },
                {
                    "id": "zeitrechnen",
                    "name": "Zeitrechnen",
                    "description": "Rechne mit Stunden, Minuten und Sekunden - auch als Brüche!",
                    "category": "Mathematik",
                    "route": "/zeitrechnen",
                    "icon": "⏱️",
                    "type": "learning",
                    "tags": ["mathematik", "zeit", "umrechnen", "brüche", "stunden", "minuten"]
                },
                {
                    "id": "isolation",
                    "name": "Isolation",
                    "description": "Strategisches Brettspiel - bewege deine Figur und isoliere deine Gegner!",
                    "category": "Spiele",
                    "route": "/isolation",
                    "icon": "♟️",
                    "type": "game",
                    "tags": ["spiel", "strategie", "brettspiel", "multiplayer"]
                },
                {
                    "id": "quarto",
                    "name": "Quarto 3D",
                    "description": "3D-Strategiespiel - sei der Erste mit 4 Steinen in einer Reihe mit gemeinsamen Attributen!",
                    "category": "Spiele",
                    "route": "/quarto",
                    "icon": "🎲",
                    "type": "game",
                    "tags": ["spiel", "strategie", "brettspiel", "3d", "quarto"]
                }
            ]
        };

        for (const app of appsConfig.apps) {
            await db.execute({
                sql: `INSERT INTO apps (id, name, description, category, route, icon, tags, type, data_structure) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET
                      name=excluded.name, description=excluded.description, category=excluded.category,
                      route=excluded.route, icon=excluded.icon, tags=excluded.tags, type=excluded.type, data_structure=excluded.data_structure`,
                args: [
                    app.id,
                    app.name,
                    app.description,
                    app.category,
                    app.route,
                    app.icon,
                    JSON.stringify(app.tags),
                    app.type || 'tool',
                    app.data_structure || null
                ]
            });
        }
        console.log("Seeded/Updated apps data");

    } catch (e) {
        console.error("Error seeding apps:", e.message);
    }

    try {
        await db.execute("UPDATE users SET is_admin = 1 WHERE uid = 'IMv3Vu3lPWNG419VdOoXxvyn5DK2'");
        console.log("Promoted Robert to Admin");
    } catch (e) { }

    console.log("DB setup/migration complete.");
}

initDB().catch(console.error);
