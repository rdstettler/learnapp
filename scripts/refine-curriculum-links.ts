
import { getTursoClient } from '../api/_lib/turso.js';
import { generateText } from 'ai';
import { xai } from '@ai-sdk/xai';
import * as dotenv from 'dotenv';
dotenv.config();

const db = getTursoClient();

// Define App Capabilities strictly
const APP_SPECS: Record<string, string> = {
    'kopfrechnen': "A mental arithmetic training app. It generates random equations for Addition, Subtraction, Multiplication, and Division. It supports integers. It does NOT support: visual counting, sorting objects, geometry, word problems, fractions, roots, or prime factorization.",
    'textaufgaben': "An app for solving word problems (Sachrechnungen). It presents a text scenario and asks for a numerical answer.",
    // Add others as needed
};

async function refineLinks() {
    console.log('🧹 Starting Curriculum Link Refinement...');

    // 1. Get all unique links (App -> Node)
    const linksRes = await db.execute(`
        SELECT DISTINCT ac.app_id, acc.curriculum_node_id, cn.code, cn.title, cn.description 
        FROM app_content_curriculum acc
        JOIN app_content ac ON acc.app_content_id = ac.id
        JOIN curriculum_nodes cn ON acc.curriculum_node_id = cn.id
    `);

    const links = linksRes.rows as any[];
    console.log(`Found ${links.length} App-Node pairings to check.`);

    const toDelete: { appId: string, nodeId: number }[] = [];

    for (const link of links) {
        const appSpec = APP_SPECS[link.app_id as string];
        if (!appSpec) {
            // console.log(`   ❓ No spec for ${link.app_id}, skipping check.`);
            continue;
        }

        const prompt = `
        Resource: Educational App "${link.app_id}"
        Description: ${appSpec}

        Curriculum Goal: ${link.code} - ${link.title}
        Description: ${link.description}

        Task: Is this app a VALID way to practice this specific curriculum goal?
        - If the goal requires visual comparison of objects, and the app is abstract arithmetic -> NO.
        - If the goal requires geometry, and the app is arithmetic -> NO.
        - If the goal requires prime factorization, and the app is simple +-*/ -> NO.
        - If the app covers the core skill (e.g. "solve addition problems") -> YES.

        Answer strictly with JSON: { "valid": boolean, "reason": "short explanation" }
        `;

        try {
            const aiRes = await generateText({
                model: xai('grok-4-1-fast-reasoning'),
                prompt: prompt
            });

            const result = JSON.parse(aiRes.text.replace(/```json|```/g, '').trim());

            if (!result.valid) {
                console.log(`   ❌ INVALID: ${link.app_id} <-> ${link.code}`);
                console.log(`      Reason: ${result.reason}`);
                toDelete.push({ appId: link.app_id, nodeId: link.curriculum_node_id });
            } else {
                console.log(`   ✅ VALID:   ${link.app_id} <-> ${link.code}`);
            }

        } catch (e) {
            console.error('Error checking link:', e);
        }
    }

    // Execute Deletions
    if (toDelete.length > 0) {
        console.log(`\nDeleting links for ${toDelete.length} invalid pairings...`);
        for (const item of toDelete) {
            // Delete content links
            await db.execute({
                sql: `DELETE FROM app_content_curriculum 
                      WHERE curriculum_node_id = ? 
                      AND app_content_id IN (SELECT id FROM app_content WHERE app_id = ?)`,
                args: [item.nodeId, item.appId]
            });

            // Delete procedural config (if any)
            await db.execute({
                sql: "DELETE FROM app_config WHERE app_id = ? AND curriculum_node_id = ?",
                args: [item.appId, item.nodeId]
            });
        }
        console.log('Done.');
    } else {
        console.log('\nNo invalid links found.');
    }
}

refineLinks().catch(console.error);
