const SUPABASE_URL = 'https://jrzaxhotapnebfmefmfb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyemF4aG90YXBuZWJmbWVmbWZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzNjU4MjEsImV4cCI6MjA4Njk0MTgyMX0.ZQne2H3fN4bpfhML1CYS_Zvzeqr6O6wDsPpGDhAcRzU';

/** @type {import('@angular/build').DevServerProxyConfig} */
module.exports = {
    '/api/voci': {
        target: SUPABASE_URL,
        secure: true,
        changeOrigin: true,
        pathRewrite: (path) => {
            const url = new URL(path, 'http://localhost');
            const langCode = url.searchParams.get('lang_code');
            const topic = url.searchParams.get('topic');
            const limit = url.searchParams.get('limit') || '50';

            let restPath = `/rest/v1/voci?select=id,lang_code,de_word,target_word,topic,created_at&limit=${limit}`;
            if (langCode) restPath += `&lang_code=eq.${langCode}`;
            if (topic && topic !== 'all') restPath += `&topic=eq.${topic}`;
            return restPath;
        },
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        // Transform Supabase array response into { words: [...] }
        selfHandleResponse: true,
        onProxyRes: (proxyRes, req, res) => {
            let body = '';
            proxyRes.on('data', chunk => body += chunk);
            proxyRes.on('end', () => {
                res.setHeader('Content-Type', 'application/json');
                try {
                    const words = JSON.parse(body);
                    res.end(JSON.stringify({ words }));
                } catch (e) {
                    res.end(JSON.stringify({ words: [] }));
                }
            });
        }
    },
    '/api': {
        target: 'http://localhost:3000',
        secure: false,
        changeOrigin: true,
        // Silently fail for other API calls during local dev
        onError: (_err, _req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));
        }
    }
};
