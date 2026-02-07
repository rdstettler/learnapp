import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';
import { handleCors } from './_lib/auth.js';
import { replaceEszett } from './_lib/text-utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (handleCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Route: if app_id is provided, serve content for that app; otherwise list all apps
    const { app_id } = req.query;
    if (app_id && typeof app_id === 'string') {
        return handleAppContent(req, res, app_id);
    }
    return handleAppsList(req, res);
}

async function handleAppsList(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();

    // Cache for 1 hour, reuse stale for 10 mins
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

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

async function handleAppContent(req: VercelRequest, res: VercelResponse, app_id: string) {
    const db = getTursoClient();
    const { skill_level, level } = req.query;

    try {
        let sql = "SELECT * FROM app_content WHERE app_id = ?";
        const args: any[] = [app_id];

        if (skill_level) {
            const skillVal = parseFloat(skill_level as string);
            if (!isNaN(skillVal)) {
                sql += " AND (skill_level IS NULL OR skill_level <= ?)";
                args.push(skillVal);
            }
        }

        if (level) {
            const levelVal = parseInt(level as string);
            if (!isNaN(levelVal)) {
                sql += " AND (level IS NULL OR level = ?)";
                args.push(levelVal);
            }
        }

        const result = await db.execute({ sql, args });

        const content = result.rows.map(row => {
            let data = null;
            try {
                data = JSON.parse(row.data as string);
            } catch (e) {
                console.error("Error parsing content data", row.id);
            }
            return { ...row, data };
        });

        const langFormat = req.query['language-format'];
        if (langFormat === 'swiss') {
            return res.status(200).json({ content: replaceEszett(content) });
        }

        return res.status(200).json({ content });
    } catch (e: any) {
        console.error("Error fetching app content:", e);
        return res.status(500).json({ error: e.message });
    }
}
