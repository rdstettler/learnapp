import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
dotenv.config();

const db = getTursoClient();

async function verify() {
    const lines: string[] = [];

    // Total links
    const total = await db.execute('SELECT COUNT(*) as cnt FROM app_content_curriculum');
    lines.push(`Total links: ${total.rows[0].cnt}`);

    // Content per Kompetenz
    const verify = await db.execute(`
        SELECT cn.code, cn.title, COUNT(acc.app_content_id) as content_count
        FROM curriculum_nodes cn
        LEFT JOIN app_content_curriculum acc ON cn.id = acc.curriculum_node_id
        WHERE cn.level = 'kompetenz'
        GROUP BY cn.id
        ORDER BY cn.code
    `);
    lines.push('\nContent per Kompetenz:');
    let covered = 0;
    let uncovered = 0;
    for (const r of verify.rows) {
        const cc = r.content_count as number;
        const marker = cc > 0 ? '✅' : '❌';
        lines.push(`  ${marker} ${r.code}: ${cc} items — ${r.title}`);
        if (cc > 0) covered++; else uncovered++;
    }
    lines.push(`\nCovered: ${covered}, Uncovered: ${uncovered}`);

    // Content per app showing links
    const perApp = await db.execute(`
        SELECT ac.app_id, COUNT(DISTINCT acc.curriculum_node_id) as node_count, COUNT(acc.app_content_id) as link_count
        FROM app_content ac
        LEFT JOIN app_content_curriculum acc ON ac.id = acc.app_content_id
        GROUP BY ac.app_id
        ORDER BY link_count DESC
    `);
    lines.push('\nLinks per app:');
    for (const r of perApp.rows) {
        lines.push(`  ${r.app_id}: ${r.link_count} links to ${r.node_count} nodes`);
    }

    fs.writeFileSync('scripts/verify-results.txt', lines.join('\n'), 'utf8');
    console.log('Results written to scripts/verify-results.txt');
}

verify().catch(console.error);
