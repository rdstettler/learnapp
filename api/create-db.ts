import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();

    try {
        await db.execute("ALTER TABLE users ADD COLUMN avatar_config TEXT");
        console.log("Added avatar_config column");
    } catch (e: any) {
        // console.log("avatar_config error (likely exists):", e.message);
    }

    try {
        await db.execute("ALTER TABLE users ADD COLUMN avatar_svg TEXT");
        console.log("Added avatar_svg column");
    } catch (e: any) {
        // console.log("avatar_svg error (likely exists):", e.message);
    }

    try {
        await db.execute("ALTER TABLE users ADD COLUMN skill_level REAL");
        console.log("Added skill_level column");
    } catch (e: any) {
        // console.log("skill_level error (likely exists):", e.message);
    }

    try {
        await db.execute("ALTER TABLE users ADD COLUMN learn_level INTEGER");
        console.log("Added learn_level column");
    } catch (e: any) {
        // console.log("learn_level error (likely exists):", e.message);
    }

    /* New columns for AI Logic */
    try {
        await db.execute("ALTER TABLE apps ADD COLUMN type TEXT DEFAULT 'tool'");
        console.log("Added apps.type column");
    } catch (e: any) {
        // console.log("apps.type error (likely exists):", e.message);
    }

    try {
        await db.execute("ALTER TABLE apps ADD COLUMN data_structure TEXT");
        console.log("Added apps.data_structure column");
    } catch (e: any) {
        // console.log("apps.data_structure error (likely exists):", e.message);
    }

    try {
        await db.execute("ALTER TABLE app_results ADD COLUMN processed BOOLEAN DEFAULT 0");
        console.log("Added app_results.processed column");
    } catch (e: any) {
        // console.log("app_results.processed error (likely exists):", e.message);
    }


    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS app_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id TEXT NOT NULL,
                user_uid TEXT NOT NULL,
                session_id TEXT,
                content TEXT,
                processed BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Created app_results table (if not exists)");
    } catch (e: any) {
        console.error("Error creating app_results table:", e.message);
    }

    /* Learning Session Table */
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS learning_session (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT NOT NULL,
                session_id TEXT NOT NULL,
                app_id TEXT NOT NULL,
                content TEXT,
                order_index INTEGER,
                pristine BOOLEAN DEFAULT 1,
                topic TEXT,
                text TEXT,
                theory TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Created learning_session table (if not exists)");
    } catch (e: any) {
        console.error("Error creating learning_session table:", e.message);
    }

    /* Add theory column if missing */
    try {
        await db.execute("ALTER TABLE learning_session ADD COLUMN theory TEXT");
        console.log("Added learning_session.theory column");
    } catch (e: any) {
        // ignore
    }

    // Create apps table
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS apps (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                category TEXT,
                route TEXT,
                icon TEXT,
                tags TEXT,
                featured BOOLEAN DEFAULT 0,
                min_age INTEGER,
                min_skill_level INTEGER,
                type TEXT DEFAULT 'tool',
                data_structure TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Created apps table (if not exists)");
    } catch (e: any) {
        console.error("Error creating apps table:", e.message);
        return res.status(500).json({ error: e.message });
    }

    // Create user_apps table (favorites)
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS user_apps (
                user_uid TEXT NOT NULL,
                app_id TEXT NOT NULL,
                is_favorite BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_uid, app_id)
            )
        `);
        console.log("Created user_apps table (if not exists)");
    } catch (e: any) {
        console.error("Error creating user_apps table:", e.message);
    }

    // Create app_content table
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS app_content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id TEXT NOT NULL,
                data TEXT NOT NULL,
                level INTEGER,
                skill_level REAL,
                ai_generated BOOLEAN DEFAULT 0,
                human_verified BOOLEAN DEFAULT 0,
                flag_counter INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Created app_content table (if not exists)");
    } catch (e: any) {
        console.error("Error creating app_content table:", e.message);
    }

    try {
        await db.execute("ALTER TABLE app_content ADD COLUMN ai_reviewed_counter INTEGER DEFAULT 0");
        console.log("Added ai_reviewed_counter column to app_content");
    } catch (e: any) { }

    // Create ai_logs table
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS ai_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT,
                session_id TEXT,
                prompt TEXT,
                system_prompt TEXT,
                response TEXT,
                provider TEXT,
                model TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Created ai_logs table (if not exists)");
    } catch (e: any) {
        console.error("Error creating ai_logs table:", e.message);
    }


    // Create feedback table
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uid TEXT,
                app_id TEXT NOT NULL,
                session_id TEXT,
                content TEXT,
                comment TEXT,
                error_type TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Created feedback table (if not exists)");
    } catch (e: any) {
        console.error("Error creating feedback table:", e.message);
    }

    // Create user_question_progress table
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS user_question_progress (
                user_uid TEXT NOT NULL,
                app_id TEXT NOT NULL,
                question_hash TEXT NOT NULL,
                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_uid, question_hash)
            )
        `);
        console.log("Created user_question_progress table (if not exists)");
    } catch (e: any) {
        console.error("Error creating user_question_progress table:", e.message);
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

    } catch (e: any) {
        console.error("Error seeding apps:", e.message);
    }

    // V2 Updates (Target ID, Admin, Resolved, Seed Admin)
    try {
        await db.execute("ALTER TABLE feedback ADD COLUMN target_id TEXT");
        console.log("Added target_id column to feedback");
    } catch (e: any) { }

    try {
        await db.execute("ALTER TABLE feedback ADD COLUMN resolved BOOLEAN DEFAULT 0");
        console.log("Added resolved column to feedback");
    } catch (e: any) { }

    try {
        await db.execute("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0");
        console.log("Added is_admin column to users");
    } catch (e: any) { }

    try {
        await db.execute("UPDATE users SET is_admin = 1 WHERE uid = 'IMv3Vu3lPWNG419VdOoXxvyn5DK2'");
        console.log("Promoted Robert to Admin");
    } catch (e: any) { }

    try {
        await db.execute("ALTER TABLE feedback ADD COLUMN resolution_reason TEXT");
        console.log("Added resolution_reason column to feedback");
    } catch (e: any) { }

    try {
        await db.execute("ALTER TABLE users ADD COLUMN language_variant TEXT DEFAULT 'swiss'");
        console.log("Added language_variant column to users");
    } catch (e: any) { }

    res.status(200).json({ message: "DB setup/migration complete." });
}
