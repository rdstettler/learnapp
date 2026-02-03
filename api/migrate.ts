import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getTursoClient } from './_lib/turso.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const db = getTursoClient();

    try {
        await db.execute("ALTER TABLE users ADD COLUMN avatar_config TEXT");
        console.log("Added avatar_config column");
    } catch (e: any) {
        console.log("avatar_config error (likely exists):", e.message);
    }

    try {
        await db.execute("ALTER TABLE users ADD COLUMN avatar_svg TEXT");
        console.log("Added avatar_svg column");
    } catch (e: any) {
        console.log("avatar_svg error (likely exists):", e.message);
    }

    res.status(200).json({ message: "Migration attempted. Check logs for details." });
}
