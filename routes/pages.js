import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import openapiSpec from '../config/openapi.js';
import systemController from '../controllers/systemController.js';

const router = express.Router();

// Swagger UI served from CDN, pointed at our /openapi.json spec.
const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Music Webhook API — Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <link rel="icon" href="data:," />
  <style>body { margin: 0; } .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      docExpansion: 'list',
      defaultModelsExpandDepth: 0,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;

// API documentation
const refPath = () => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'reference.html');

router.get('/openapi.json', (req, res) => res.json(openapiSpec));
// Last.fm-style reference portal (rendered from /openapi.json)
router.get(['/docs', '/reference'], (req, res) => res.sendFile(refPath()));
// Swagger UI for interactive try-it-out
router.get(['/docs/swagger', '/api-docs'], (req, res) => {
  res.type('html').send(SWAGGER_UI_HTML);
});

// Root — serve the API reference portal to browsers, JSON to API clients
router.get('/', (req, res, next) => {
  if (req.accepts(['html', 'json']) === 'html') {
    return res.sendFile(refPath(), (err) => {
      if (err) systemController.handleRoot(req, res);
    });
  }
  return systemController.handleRoot(req, res);
});

// Health check endpoints
router.get('/health', systemController.healthCheck.bind(systemController));
router.get('/api/health', systemController.healthCheck.bind(systemController));

// Login page
router.get('/login', (req, res) => {
  res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'views', 'login.html'));
});

// API info endpoint
router.get('/api', (req, res) => {
  res.json({
    message: 'Music Webhook API',
    version: '1.0.2',
    endpoints: {
      'GET /docs': 'Interactive API documentation (Swagger UI)',
      'GET /openapi.json': 'OpenAPI 3.0 specification',
      'POST /api/auth/register': 'Register a new user (viewer)',
      'POST /api/auth/login': 'Log in and receive a JWT',
      'GET /api/auth/me': 'Current authenticated user',
      'POST /api/auth/api-keys': 'Create an API key for scrobbler clients',
      'GET /api/stats': 'Get scrobbling statistics',
      'GET /api/tracks': 'Get tracks with pagination/search',
      'PATCH /api/tracks': 'Toggle loved flag for a track',
      'GET /api/tracks/top-artists': 'Top artists leaderboard',
      'GET /api/tracks/top-tracks': 'Top tracks leaderboard',
      'GET /api/track': 'Single track analytics',
      'GET /api/albums': 'Album analytics',
      'GET /api/artists/:name': 'Artist profile',
      'GET /api/nowplaying': 'Get current now playing status',
      'POST /api/nowplaying/playing': 'Set or refresh now playing status',
      'GET /api/health': 'Health check',
      'POST /webhook/scrobble': 'Submit scrobble data',
      'GET /import/listenbrainz': 'ListenBrainz import UI',
      'POST /api/import/listenbrainz': 'Bulk import ListenBrainz JSON/JSONL payloads',
      'DELETE /api/tracks/range': 'Delete tracks by scrobbledAt date range',
      'GET /api/spotify/status': 'Get Spotify integration status',
      'GET /api/spotify/stats': 'Get Spotify enrichment statistics',
      'POST /api/spotify/enrich': 'Manually enrich tracks with Spotify data',
      'POST /api/spotify/update-missing': 'Update missing Spotify data for existing tracks',
      'DELETE /api/spotify/cache': 'Clear Spotify search cache',
      'GET /api/duplicates': 'Get duplicate scrobble statistics',
      'DELETE /api/duplicates': 'Remove duplicate scrobbles',
      'GET /api/migrate/precheck': 'Pre-check migration counts',
      'POST /api/migrate/run': 'Run data migration (streaming NDJSON)'
    }
  });
});

export default router;
