import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const publicDir = join(__dirname, '..', 'public');
const outputPath = join(publicDir, 'index.html');

mkdirSync(publicDir, { recursive: true });

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Music Webhook API</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
      main { text-align: center; padding: 2rem; max-width: 480px; }
      h1 { font-size: 2.5rem; margin-bottom: 1rem; }
      p { font-size: 1.1rem; line-height: 1.6; }
      code { background: rgba(148, 163, 184, 0.15); padding: 0.25rem 0.5rem; border-radius: 0.375rem; font-size: 1rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Music Webhook API</h1>
      <p>Express server running in a Vercel Serverless Function. Use the REST endpoints such as <code>/api/health</code> or <code>/webhook/scrobble</code> to interact with the service.</p>
    </main>
  </body>
</html>
`;

writeFileSync(outputPath, html);
