
import { getTursoClient } from '../api/_lib/turso.js';
import { generateText } from 'ai';
import { xai } from '@ai-sdk/xai';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

// Map Handlungsaspekt codes to Apps
// We'll fetch all Kompetenzstufe nodes starting with these codes
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

interface CurriculumNode {
    id: number;
    code: string;
    title: string;
    description: string | null;
}

interface AppContent {
    id: number;
    app_id: string;
    data: any;
    level: number;
}

async function smartLink() {
    console.log('🤖 Starting Smart Content Linking...');

    const args = process.argv.slice(2);
    const appFilter = args.find(a => a.startsWith('--app='))?.split('=')[1];
    const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
    const dryRun = args.includes('--dry-run');

    console.log(`   Options: App=${appFilter || 'ALL'}, Limit=${limit || 'No'}, DryRun=${dryRun}`);

    // 1. Build map: App -> Relevant Handlungsaspekte
    const appToHaCodes = new Map<string, string[]>();
    for (const [haCode, apps] of Object.entries(CURRICULUM_APP_MAP)) {
        for (const appId of apps) {
            if (appFilter && appId !== appFilter) continue;

            if (!appToHaCodes.has(appId)) appToHaCodes.set(appId, []);
            appToHaCodes.get(appId)!.push(haCode);
        }
    }

    // 2. Clear existing links (we're rebuilding them)
    // await db.execute('DELETE FROM app_content_curriculum');
    // console.log('🧹 Cleared existing links');

    // 3. Process each app
    for (const [appId, haCodes] of appToHaCodes) {
        console.log(`\n📦 Processing App: ${appId} (HA: ${haCodes.join(', ')})`);

        // Fetch all relevant Kompetenzstufe nodes (level 4)
        // e.g. MA.1.A.1.a, MA.1.A.1.b...
        const placeholders = haCodes.map(() => 'code LIKE ?').join(' OR ');
        const args = haCodes.map(code => `${code}%`);

        const nodesRes = await db.execute({
            sql: `SELECT id, code, title, description 
                  FROM curriculum_nodes 
                  WHERE level = 'kompetenzstufe' AND (${placeholders})
                  ORDER BY code`,
            args
        });
        const nodes = nodesRes.rows as unknown as CurriculumNode[];

        if (nodes.length === 0) {
            console.log(`   ⚠️ No Level 4 nodes found for ${appId}. Skipping.`);
            continue;
        }

        console.log(`   found ${nodes.length} potential curriculum nodes.`);

        // Fetch app content
        const contentRes = await db.execute({
            sql: `SELECT id, app_id, data, level FROM app_content WHERE app_id = ?`,
            args: [appId]
        });
        const contents = contentRes.rows.map(r => ({
            ...r,
            data: JSON.parse(r.data as string)
        })) as unknown as AppContent[];

        console.log(`   found ${contents.length} content items.`);

        // Batch Process with AI
        const BATCH_SIZE = 10;
        for (let i = 0; i < contents.length; i += BATCH_SIZE) {
            const batch = contents.slice(i, i + BATCH_SIZE);
            await processBatch(appId, batch, nodes, dryRun);
        }
    }
}

async function processBatch(appId: string, contentBatch: AppContent[], nodes: CurriculumNode[], dryRun: boolean) {
    // Prepare prompt
    const contentSummaries = contentBatch.map(c =>
        `ID ${c.id}: ${JSON.stringify(c.data).substring(0, 200)}`
    ).join('\n');

    const nodeSummaries = nodes.map(n =>
        `Node ${n.id} (${n.code}): ${n.title} ${n.description ? '- ' + n.description : ''}`
    ).join('\n');

    const prompt = `
    You are a curriculum expert. I have educational content items for the app "${appId}".
    I need to link each item to exactly ONE relevant "Kompetenzstufe" from the provided list.

    AVAILABLE CURRICULUM NODES:
    ${nodeSummaries}

    CONTENT ITEMS TO CLASSIFY:
    ${contentSummaries}

    TASK:
    Return a JSON object where keys are Content IDs (strings) and values are the Node ID (number) that best fits.
    If multiple fit, pick the most specific one. If none fit well, set value to null.
    
    Example response format:
    {
      "123": 456,
      "124": 789,
      "125": null
    }
    
    Return ONLY JSON.
    `;

    try {
        if (dryRun) console.log(`   🤖 [DryRun] Asking AI to map ${contentBatch.length} items...`);
        const aiRes = await generateText({
            model: xai('grok-4-1-fast-reasoning'),
            system: "You are a precise curriculum mapper. Output only valid JSON.",
            prompt: prompt
        });

        const mapping = JSON.parse(aiRes.text.replace(/```json|```/g, '').trim());

        if (dryRun) {
            console.log('   [DryRun] Mappings:', mapping);
            return;
        }

        const inserts: { sql: string, args: any[] }[] = [];

        for (const [contentId, nodeId] of Object.entries(mapping)) {
            if (nodeId) {
                inserts.push({
                    sql: 'INSERT OR IGNORE INTO app_content_curriculum (app_content_id, curriculum_node_id) VALUES (?, ?)',
                    args: [Number(contentId), Number(nodeId)]
                });
            }
        }

        if (inserts.length > 0) {
            await db.batch(inserts);
            process.stdout.write(`+${inserts.length} `); // Progress indicator
        } else {
            process.stdout.write('.');
        }

    } catch (e) {
        console.error(`\nError processing batch:`, e);
    }
}

smartLink().catch(console.error);
