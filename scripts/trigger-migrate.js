// This script triggers the /api/migrate endpoint to run migrations on the deployed server.
// It is intended to be run after 'vercel deploy --prod'.

import { request } from 'http';
import { request as secureRequest } from 'https';

const DEPLOYMENT_URL = process.argv[2]; // Optional: Pass URL as arg, otherwise tries to guess or needs env var

// For now, we'll try to fetch the production URL or just fail if not provided/found.
// In a Vercel build context, VERCEL_URL might be available, but this runs *after* deploy on the local machine?
// Or is this running in GitHub Actions? 
// The user runs 'npm run publish' locally.
// 'vercel deploy --prod' outputs the URL to stdout.
// We might need to capture that output or just hardcode the production URL if it's static.

// Let's assume the user has a known production URL or we can ask them to set it.
// However, the prompt says "The migrate.ts doesn't run after publish".
// We will assume the production URL is standard.

const PROD_URL = "https://antigravity-learning.vercel.app"; // Replace with actual if known, or pass as arg.

async function triggerMigration() {
    console.log("Triggering migration on", PROD_URL);

    // We can use fetch if Node version supports it (Node 18+), otherwise https module.
    // Since we are in an ESM project ('type': 'module' in package.json), we likely have a modern Node.

    try {
        const response = await fetch(`${PROD_URL}/api/create-db`, {
            method: 'POST',
        });

        if (response.ok) {
            console.log("Migration triggered successfully.");
            const data = await response.json();
            console.log("Response:", data);
        } else {
            console.error("Failed to trigger migration.", response.status, response.statusText);
            const text = await response.text();
            console.error("Body:", text);
            process.exit(1);
        }
    } catch (error) {
        console.error("Error triggering migration:", error);
        process.exit(1);
    }
}

triggerMigration();
