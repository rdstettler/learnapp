import { createClient } from '@libsql/client';

// Singleton Turso client
let client: ReturnType<typeof createClient> | null = null;

export function getTursoClient() {
    if (!client) {
        client = createClient({
            url: process.env.TURSO_DATABASE_URL!,
            authToken: process.env.TURSO_AUTH_TOKEN!,
        });
    }
    return client;
}

// Initialize database schema
export async function initSchema() {
    const db = getTursoClient();

    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            uid TEXT PRIMARY KEY,
            email TEXT NOT NULL,
            display_name TEXT,
            photo_url TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS learn_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_uid TEXT NOT NULL,
            app_id TEXT NOT NULL,
            score INTEGER NOT NULL,
            max_score INTEGER NOT NULL,
            completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            duration_seconds INTEGER,
            details TEXT,
            FOREIGN KEY (user_uid) REFERENCES users(uid)
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS telemetry_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_uid TEXT NOT NULL,
            app_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            metadata TEXT,
            FOREIGN KEY (user_uid) REFERENCES users(uid)
        )
    `);

    // Create indexes for common queries
    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_results_user ON learn_results(user_uid)
    `);
    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_results_app ON learn_results(app_id)
    `);
    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_telemetry_user ON telemetry_events(user_uid)
    `);
}
