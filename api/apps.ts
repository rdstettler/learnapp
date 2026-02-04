import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const db = getTursoClient();

    try {
        const result = await db.execute("SELECT * FROM apps");

        const apps = result.rows.map(row => {
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

        return res.status(200).json({ apps });
    } catch (e: any) {
        console.error("Error fetching apps:", e.message);
        return res.status(500).json({ error: e.message });
    }
}
