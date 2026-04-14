const http = require('http');
const https = require('https');
const { URL } = require('url');

const ANGULAR_PORT = 32843;
const PROXY_PORT = 8080;
const SUPABASE_URL = 'https://jrzaxhotapnebfmefmfb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyemF4aG90YXBuZWJmbWVmbWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNjU4MjEsImV4cCI6MjA4Njk0MTgyMX0.ZQne2H3fN4bpfhML1CYS_Zvzeqr6O6wDsPpGDhAcRzU';

const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/voci')) {
        // Parse query params
        const url = new URL(req.url, `http://localhost:${PROXY_PORT}`);
        const langCode = url.searchParams.get('lang_code');
        const topic = url.searchParams.get('topic');
        const limit = url.searchParams.get('limit') || '50';

        let supaUrl = `${SUPABASE_URL}/rest/v1/voci?select=id,lang_code,de_word,target_word,topic,created_at&limit=${limit}`;
        if (langCode) supaUrl += `&lang_code=eq.${langCode}`;
        if (topic && topic !== 'all') supaUrl += `&topic=eq.${topic}`;

        const options = {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            }
        };

        https.get(supaUrl, options, (proxyRes) => {
            let body = '';
            proxyRes.on('data', chunk => body += chunk);
            proxyRes.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                try {
                    const words = JSON.parse(body);
                    res.end(JSON.stringify({ words }));
                } catch (e) {
                    res.end(JSON.stringify({ words: [], error: 'parse error' }));
                }
            });
        }).on('error', (e) => {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        });
    } else if (req.url.startsWith('/api/')) {
        // Return empty/mock for other API calls so the app doesn't crash
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        if (req.url.includes('/api/apps')) {
            // Serve the local apps config
            const fs = require('fs');
            try {
                const config = fs.readFileSync('./frontend/src/assets/apps.config.json', 'utf8');
                res.end(config);
            } catch (e) {
                res.end(JSON.stringify({ apps: [] }));
            }
        } else if (req.url.includes('/api/favorites')) {
            res.end(JSON.stringify({ favorites: [] }));
        } else {
            res.end(JSON.stringify({}));
        }
    } else {
        // Proxy to Angular dev server
        const options = {
            hostname: 'localhost',
            port: ANGULAR_PORT,
            path: req.url,
            method: req.method,
            headers: req.headers,
        };
        const proxy = http.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
        });
        proxy.on('error', () => {
            res.writeHead(502);
            res.end('Angular dev server not ready');
        });
        req.pipe(proxy, { end: true });
    }
});

server.listen(PROXY_PORT, () => {
    console.log(`Proxy running on http://localhost:${PROXY_PORT}`);
    console.log(`Forwarding /api/voci to Supabase, everything else to Angular on :${ANGULAR_PORT}`);
});
