import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

let firebaseApp: App;

function getFirebaseAdmin(): App {
    if (getApps().length === 0) {
        // Uses GOOGLE_APPLICATION_CREDENTIALS env var or explicit service account
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        if (serviceAccount) {
            // Replace literal newlines/carriage returns with \n for JSON parsing
            const sanitized = serviceAccount.replace(/\n/g, '\\n').replace(/\r/g, '');
            firebaseApp = initializeApp({
                credential: cert(JSON.parse(sanitized)),
            });
        } else {
            // Fallback: uses GOOGLE_APPLICATION_CREDENTIALS or ADC
            firebaseApp = initializeApp();
        }
    }
    return firebaseApp ?? getApps()[0];
}

/**
 * Verifies the Firebase ID token from the Authorization header.
 * Returns the decoded token (contains uid, email, etc.) or null if invalid.
 */
export async function verifyAuth(req: VercelRequest): Promise<DecodedIdToken | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return null;
    }

    const idToken = authHeader.slice(7);
    if (!idToken) return null;

    try {
        const app = getFirebaseAdmin();
        const decoded = await getAuth(app).verifyIdToken(idToken);
        return decoded;
    } catch (error) {
        console.error('Token verification failed:', error);
        return null;
    }
}

/**
 * Middleware-style helper: verifies auth and sends 401 if invalid.
 * Returns the decoded token if valid, or null (after sending 401 response).
 */
export async function requireAuth(req: VercelRequest, res: VercelResponse): Promise<DecodedIdToken | null> {
    const decoded = await verifyAuth(req);
    if (!decoded) {
        res.status(401).json({ error: 'Unauthorized: Invalid or missing authentication token' });
        return null;
    }
    return decoded;
}

/**
 * Sets standard CORS headers. Call at the top of every handler.
 * Returns true if this was an OPTIONS preflight (caller should return early).
 */
export function handleCors(req: VercelRequest, res: VercelResponse): boolean {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return true;
    }
    return false;
}
