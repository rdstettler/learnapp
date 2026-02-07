import { createClient, type Client } from '@libsql/client';

export type TursoClient = Client;

// Singleton Turso client
let client: TursoClient | null = null;

export function getTursoClient() {
    if (!client) {
        const url = process.env.TURSO_DATABASE_URL;
        const authToken = process.env.TURSO_AUTH_TOKEN;

        if (!url || !authToken) {
            throw new Error('Missing Turso credentials. Please set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables.');
        }

        client = createClient({
            url,
            authToken,
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
            avatar_config TEXT,
            avatar_svg TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS user_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_uid TEXT NOT NULL,
            app_id TEXT NOT NULL,
            open_count INTEGER DEFAULT 0,
            last_opened DATETIME,
            UNIQUE(user_uid, app_id),
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
        CREATE INDEX IF NOT EXISTS idx_telemetry_user ON telemetry_events(user_uid)
    `);
    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_metrics_user ON user_metrics(user_uid)
    `);
}
