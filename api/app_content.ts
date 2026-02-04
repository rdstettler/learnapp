
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { app_id, skill_level, level } = req.query;

    if (!app_id || typeof app_id !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid app_id' });
    }

    const db = getTursoClient();

    try {
        let sql = "SELECT * FROM app_content WHERE app_id = ?";
        const args: any[] = [app_id];

        // Filter by skill_level if provided
        // Logic: specific skill_level match OR null (all levels)
        // Or if skill_level is a "user capability", maybe show items suitable?
        // User request: "filter for the user skill level ... If nullable, then it applies to all levels"
        // Let's assume exact match or range. For now, let's implement inclusive logic:
        // if user has skill_level X, show content where content.skill_level IS NULL OR content.skill_level <= X?
        // OR content.skill_level is close to X?
        // Given complexity, let's start with: if param provided, try to filter.
        // Assuming 'nullable -> applies to all'.

        if (skill_level) {
            const skillVal = parseFloat(skill_level as string);
            if (!isNaN(skillVal)) {
                // Show content compatible with this skill level.
                // Assuming content.skill_level is the REQUIRED level.
                // So UserLevel >= ContentLevel.
                // AND include NULL.
                sql += " AND (skill_level IS NULL OR skill_level <= ?)";
                args.push(skillVal);
            }
        }

        // Also allow explicit level filter (integer) if app uses levels (e.g. game levels)
        if (level) {
            const levelVal = parseInt(level as string);
            if (!isNaN(levelVal)) {
                sql += " AND (level IS NULL OR level = ?)";
                args.push(levelVal);
            }
        }

        // Limit results to avoid massive payloads?
        // sql += " LIMIT 100"; 

        const result = await db.execute({ sql, args });

        const content = result.rows.map(row => {
            // Parse the data JSON string back to object
            let data = null;
            try {
                data = JSON.parse(row.data as string);
            } catch (e) {
                console.error("Error parsing content data", row.id);
            }
            return {
                ...row,
                data
            };
        });

        return res.status(200).json({ content });
    } catch (e: any) {
        console.error("Error fetching app content:", e);
        return res.status(500).json({ error: e.message });
    }
}
