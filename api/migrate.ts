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

    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS app_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id TEXT NOT NULL,
                user_uid TEXT NOT NULL,
                session_id TEXT,
                content TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Created app_results table (if not exists)");
    } catch (e: any) {
        console.error("Error creating app_results table:", e.message);
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("Created apps table (if not exists)");
    } catch (e: any) {
        console.error("Error creating apps table:", e.message);
        return res.status(500).json({ error: e.message });
    }

    // Seed apps
    try {
        // We import the JSON content. In a Vercel serverless function, reading local files can be tricky.
        // For now, we will assume this runs in a context where we can perform the migration,
        // or we hardcode the initial data if import fails.
        // However, to keep it clean, let's try to fetch it or read it if we are local.
        // Since we are in the 'api' folder and assets are in 'frontend/src/assets',
        // let's try to dynamic import or rely on a hardcoded list for the FIRST migration if file access is tough.
        // Actually, for this specific task, I'll read the file content using fs since I am the agent and I can see it,
        // but the RUNNING script needs access.
        // Let's assume for now we hardcode the data from the known config to ensure it works reliably in the migration script without complex file path resolution in Vercel.

        const appsConfig = {
            "apps": [
                {
                    "id": "aehnlichewoerter",
                    "name": "Ähnliche Wörter",
                    "description": "Lerne den Unterschied zwischen ähnlich klingenden Wörtern wie viel/fiel, seid/seit, wieder/wider",
                    "category": "Deutsch",
                    "route": "/aehnlichewoerter",
                    "icon": "🔤",
                    "tags": [
                        "deutsch",
                        "rechtschreibung",
                        "synonyme",
                        "ähnliche wörter"
                    ]
                },
                {
                    "id": "oberbegriffe",
                    "name": "Oberbegriffe",
                    "description": "Finde den passenden Oberbegriff für eine Gruppe von Wörtern",
                    "category": "Deutsch",
                    "route": "/oberbegriffe",
                    "icon": "🏷️",
                    "tags": [
                        "deutsch",
                        "wortschatz",
                        "kategorien",
                        "oberbegriffe"
                    ]
                },
                {
                    "id": "wortfamilie",
                    "name": "Wortfamilie",
                    "description": "Ergänze die fehlenden Wortarten: Nomen, Verb und Adjektiv einer Wortfamilie",
                    "category": "Deutsch",
                    "route": "/wortfamilie",
                    "icon": "👨‍👩‍👧",
                    "tags": [
                        "deutsch",
                        "grammatik",
                        "wortarten",
                        "wortfamilie"
                    ]
                },
                {
                    "id": "symmetry",
                    "name": "Symmetry Drawing",
                    "description": "Kreatives Zeichnen mit rotierender Symmetrie - male Mandalas und mehr!",
                    "category": "Geometrie",
                    "route": "/symmetry",
                    "icon": "✨",
                    "tags": [
                        "drawing",
                        "geometry",
                        "symmetry",
                        "creative"
                    ]
                },
                {
                    "id": "symmetrien",
                    "name": "Symmetrien an Punkt und Strich",
                    "description": "Zeichne Polygone und spiegle sie an Punkt und Gerade",
                    "category": "Geometrie",
                    "route": "/symmetrien",
                    "icon": "🔀",
                    "tags": [
                        "geometry",
                        "symmetry",
                        "mirroring",
                        "polygon"
                    ]
                },
                {
                    "id": "wortstaemme",
                    "name": "Wortstamm-Quiz",
                    "description": "Deutsches Wortstamm-Lernquiz zum Entdecken von Wortfamilien",
                    "category": "Deutsch",
                    "route": "/wortstaemme",
                    "icon": "📝",
                    "tags": [
                        "deutsch",
                        "sprache",
                        "quiz"
                    ]
                },
                {
                    "id": "verben",
                    "name": "Verben-Quiz",
                    "description": "Teste dein Wissen über deutsche Verbkonjugation",
                    "category": "Deutsch",
                    "route": "/verben",
                    "icon": "✍️",
                    "tags": [
                        "deutsch",
                        "grammatik",
                        "verben"
                    ]
                },
                {
                    "id": "kasus",
                    "name": "Kasus-Quiz",
                    "description": "Lerne die deutschen Fälle - Nominativ, Akkusativ, Dativ und Genitiv",
                    "category": "Deutsch",
                    "route": "/kasus",
                    "icon": "📖",
                    "tags": [
                        "deutsch",
                        "grammatik",
                        "kasus",
                        "fälle"
                    ]
                },
                {
                    "id": "redewendungen",
                    "name": "Redewendungen-Quiz",
                    "description": "Lerne deutsche Redewendungen und ihre Bedeutungen",
                    "category": "Deutsch",
                    "route": "/redewendungen",
                    "icon": "🎭",
                    "tags": [
                        "deutsch",
                        "redewendungen",
                        "idiome",
                        "sprache"
                    ]
                },
                {
                    "id": "satzzeichen",
                    "name": "Satzzeichen-Quiz",
                    "description": "Setze die fehlenden Satzzeichen in Texte mit wörtlicher Rede ein",
                    "category": "Deutsch",
                    "route": "/satzzeichen",
                    "icon": "✏️",
                    "tags": [
                        "deutsch",
                        "grammatik",
                        "satzzeichen",
                        "zeichensetzung"
                    ]
                },
                {
                    "id": "fehler",
                    "name": "Fehler finden",
                    "description": "Finde und korrigiere die Rechtschreib- und Grammatikfehler im Text",
                    "category": "Deutsch",
                    "route": "/fehler",
                    "icon": "🔍",
                    "tags": [
                        "deutsch",
                        "rechtschreibung",
                        "grammatik",
                        "korrektur"
                    ]
                },
                {
                    "id": "dasdass",
                    "name": "Das/Dass-Quiz",
                    "description": "Lerne den Unterschied zwischen 'das' und 'dass' kennen",
                    "category": "Deutsch",
                    "route": "/dasdass",
                    "icon": "🎯",
                    "tags": [
                        "deutsch",
                        "grammatik",
                        "rechtschreibung",
                        "das",
                        "dass"
                    ]
                },
                {
                    "id": "textaufgaben",
                    "name": "Textaufgaben",
                    "description": "Löse mathematische Textaufgaben aus verschiedenen Themengebieten",
                    "category": "Mathematik",
                    "route": "/textaufgaben",
                    "icon": "🧮",
                    "tags": [
                        "mathematik",
                        "textaufgaben",
                        "proportionalität",
                        "rechnen"
                    ]
                },
                {
                    "id": "kopfrechnen",
                    "name": "Kopfrechnen",
                    "description": "Trainiere dein Kopfrechnen mit Addition und Division",
                    "category": "Mathematik",
                    "route": "/kopfrechnen",
                    "icon": "🧠",
                    "tags": [
                        "mathematik",
                        "kopfrechnen",
                        "addition",
                        "division"
                    ]
                },
                {
                    "id": "umrechnen",
                    "name": "Umrechnen",
                    "description": "Übe das Umrechnen von Einheiten: Längen, Flächen, Volumen, Hohlmasse und Gewicht",
                    "category": "Mathematik",
                    "route": "/umrechnen",
                    "icon": "📐",
                    "tags": [
                        "mathematik",
                        "umrechnen",
                        "einheiten",
                        "masse",
                        "gewicht"
                    ]
                },
                {
                    "id": "zeitrechnen",
                    "name": "Zeitrechnen",
                    "description": "Rechne mit Stunden, Minuten und Sekunden - auch als Brüche!",
                    "category": "Mathematik",
                    "route": "/zeitrechnen",
                    "icon": "⏱️",
                    "tags": [
                        "mathematik",
                        "zeit",
                        "umrechnen",
                        "brüche",
                        "stunden",
                        "minuten"
                    ]
                },
                {
                    "id": "isolation",
                    "name": "Isolation",
                    "description": "Strategisches Brettspiel - bewege deine Figur und isoliere deine Gegner!",
                    "category": "Spiele",
                    "route": "/isolation",
                    "icon": "♟️",
                    "tags": [
                        "spiel",
                        "strategie",
                        "brettspiel",
                        "multiplayer"
                    ]
                },
                {
                    "id": "quarto",
                    "name": "Quarto 3D",
                    "description": "3D-Strategiespiel - sei der Erste mit 4 Steinen in einer Reihe mit gemeinsamen Attributen!",
                    "category": "Spiele",
                    "route": "/quarto",
                    "icon": "🎲",
                    "tags": [
                        "spiel",
                        "strategie",
                        "brettspiel",
                        "3d",
                        "quarto"
                    ]
                }
            ]
        };

        for (const app of appsConfig.apps) {
            await db.execute({
                sql: `INSERT INTO apps (id, name, description, category, route, icon, tags) 
                      VALUES (?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET
                      name=excluded.name, description=excluded.description, category=excluded.category,
                      route=excluded.route, icon=excluded.icon, tags=excluded.tags`,
                args: [
                    app.id,
                    app.name,
                    app.description,
                    app.category,
                    app.route,
                    app.icon,
                    JSON.stringify(app.tags)
                ]
            });
        }
        console.log("Seeded/Updated apps data");

    } catch (e: any) {
        console.error("Error seeding apps:", e.message);
        // Continue, don't break strict migration? 
        // Better to report error
    }

    res.status(200).json({ message: "Migration attempted. Check logs for details." });
}
