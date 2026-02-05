import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Migration logic moved to create-db.ts
    res.status(200).json({ message: "Migrations are now handled manually via create-db.ts" });
}
