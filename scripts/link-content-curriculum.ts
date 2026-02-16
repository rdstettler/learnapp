/**
 * Links existing app_content to curriculum_nodes via the app_content_curriculum table.
 * 
 * Strategy: Use the CURRICULUM_APP_MAP (same as in apps.ts) to find which
 * Handlungsaspekt codes each app covers. Then link every content item
 * to the matching Kompetenz nodes (not Kompetenzstufen, which are too granular
 * without knowing the specific level of each content item).
 */
import { getTursoClient } from '../api/_lib/turso.js';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

// Same mapping as in apps.ts — app IDs per Handlungsaspekt code
const CURRICULUM_APP_MAP: Record<string, string[]> = {
    'D.5.E': ['dasdass', 'fehler'],
    'D.5.D': ['wortarten', 'kasus', 'verben'],
    'D.5.C': ['wortfamilie', 'wortstaemme'],
    'D.5.B': ['aehnlichewoerter', 'synant', 'oberbegriffe'],
    'D.5.A': ['wortfamilie'],
    'D.4.F': ['fehler', 'satzzeichen'],
    'D.4.D': ['fehler'],
    'D.2.B': ['aehnlichewoerter'],
    'D.2.C': ['aehnlichewoerter'],
    'D.2.A': ['redewendungen'],
    'MA.1.A': ['kopfrechnen', 'textaufgaben'],
    'MA.1.C': ['textaufgaben'],
    'MA.2.A': ['symmetrien'],
    'MA.3.A': ['umrechnen', 'zeitrechnen'],
};

// Reverse map: app_id → list of Handlungsaspekt codes
function buildReverseMap(): Map<string, string[]> {
    const reverse = new Map<string, string[]>();
    for (const [code, apps] of Object.entries(CURRICULUM_APP_MAP)) {
        for (const appId of apps) {
            if (!reverse.has(appId)) reverse.set(appId, []);
            reverse.get(appId)!.push(code);
        }
    }
    return reverse;
}

async function linkContent() {
    const reverseMap = buildReverseMap();

    console.log('═══ App → Curriculum Code Mapping ═══');
    for (const [appId, codes] of reverseMap) {
        console.log(`  ${appId} → ${codes.join(', ')}`);
    }

    // Get all curriculum nodes at the Kompetenz level (e.g., D.5.E.1, MA.1.A.3)
    // These are the nodes we link content to — specific enough but not too granular
    const kompetenzNodes = await db.execute(
        `SELECT id, code FROM curriculum_nodes WHERE level = 'kompetenz' ORDER BY code`
    );

    console.log(`\n═══ Found ${kompetenzNodes.rows.length} Kompetenz nodes ═══`);

    // Build lookup: for each app_id, which Kompetenz node IDs apply?
    const appToNodeIds = new Map<string, number[]>();
    for (const [appId, haCodes] of reverseMap) {
        const nodeIds: number[] = [];
        for (const node of kompetenzNodes.rows) {
            const nodeCode = node.code as string;
            // Check if this Kompetenz code starts with any of the app's HA codes
            for (const haCode of haCodes) {
                if (nodeCode.startsWith(haCode)) {
                    nodeIds.push(node.id as number);
                    break;
                }
            }
        }
        appToNodeIds.set(appId, nodeIds);
        console.log(`  ${appId} → ${nodeIds.length} Kompetenz nodes`);
    }

    // Get all app_content items
    const allContent = await db.execute('SELECT id, app_id FROM app_content');
    console.log(`\n═══ Processing ${allContent.rows.length} content items ═══`);

    // Clear any existing links first
    await db.execute('DELETE FROM app_content_curriculum');
    console.log('  Cleared existing links');

    // Build batch insert
    let insertCount = 0;
    let skippedCount = 0;

    // Batch inserts for efficiency
    const BATCH_SIZE = 50;
    let batch: { sql: string, args: (string | number)[] }[] = [];

    for (const content of allContent.rows) {
        const appId = content.app_id as string;
        const contentId = content.id as number;
        const nodeIds = appToNodeIds.get(appId);

        if (!nodeIds || nodeIds.length === 0) {
            skippedCount++;
            continue;
        }

        for (const nodeId of nodeIds) {
            batch.push({
                sql: 'INSERT OR IGNORE INTO app_content_curriculum (app_content_id, curriculum_node_id) VALUES (?, ?)',
                args: [contentId, nodeId]
            });
            insertCount++;

            if (batch.length >= BATCH_SIZE) {
                await db.batch(batch);
                batch = [];
                process.stdout.write('.');
            }
        }
    }

    // Flush remaining batch
    if (batch.length > 0) {
        await db.batch(batch);
    }

    console.log(`\n\n═══ Results ═══`);
    console.log(`  Inserted: ${insertCount} links`);
    console.log(`  Skipped (no curriculum mapping): ${skippedCount} content items`);

    // Verify
    const verify = await db.execute(`
        SELECT cn.code, cn.title, COUNT(acc.app_content_id) as content_count
        FROM curriculum_nodes cn
        LEFT JOIN app_content_curriculum acc ON cn.id = acc.curriculum_node_id
        WHERE cn.level = 'kompetenz'
        GROUP BY cn.id
        ORDER BY cn.code
    `);
    console.log(`\n═══ Content per Kompetenz ═══`);
    for (const r of verify.rows) {
        const marker = (r.content_count as number) > 0 ? '✅' : '❌';
        console.log(`  ${marker} ${r.code}: ${r.content_count} items — ${r.title}`);
    }
}

linkContent().catch(console.error);
