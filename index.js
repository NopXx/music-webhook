import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import path from 'path';
import Database from './config/database.js';
import redis from './config/redis.js';
import nowPlayingService from './services/nowPlayingService.js';
import webhookRoutes from './routes/webhook.js';
import openapiSpec from './config/openapi.js';
import authService from './services/authService.js';
import authController from './controllers/authController.js';
import { authenticate, authenticatePage, authenticateClient, requireRole } from './middleware/auth.js';
import { 
  validateTrackData, 
  validateApiKey, 
  requestLogger, 
  validateContentType,
  asyncHandler,
  rateLimitInfo
} from './middleware/validation.js';
import { 
  debugMiddleware,
  debugWebhookData
} from './middleware/debug.js';

// Load environment variables
config();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

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

class MusicWebhookServer {
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandlers();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // Disable CSP for API
      crossOriginEmbedderPolicy: false
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // Limit each IP to 1000 requests per windowMs
      message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.'
      },
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use(limiter);

    // Special rate limit for webhook endpoints
    const webhookLimiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 100, // 100 scrobbles per minute should be enough
      message: {
        error: 'Too many scrobbles',
        message: 'Scrobble rate limit exceeded. Please slow down.'
      }
    });
    this.app.use('/webhook', webhookLimiter);

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Cookie parsing (for JWT-in-cookie auth on browser page navigation)
    this.app.use(cookieParser());

    // Debug middleware (development only) - after body parsing
    if (process.env.NODE_ENV === 'development') {
      this.app.use(debugMiddleware);
    }

    // Custom request logging middleware
    this.app.use(requestLogger);
    this.app.use(rateLimitInfo);

    // Logging middleware
    const logFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
    this.app.use(morgan(logFormat));

    // Trust proxy for correct IP addresses
    this.app.set('trust proxy', 1);
  }

  setupRoutes() {
    // API documentation
    const refPath = () => path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'reference.html');
    this.app.get('/openapi.json', (req, res) => res.json(openapiSpec));
    // Last.fm-style reference portal (rendered from /openapi.json)
    this.app.get(['/docs', '/reference'], (req, res) => res.sendFile(refPath()));
    // Swagger UI for interactive try-it-out
    this.app.get(['/docs/swagger', '/api-docs'], (req, res) => {
      res.type('html').send(SWAGGER_UI_HTML);
    });

    // Root — serve the API reference portal to browsers, JSON to API clients
    this.app.get('/', (req, res, next) => {
      if (req.accepts(['html', 'json']) === 'html') {
        return res.sendFile(refPath(), (err) => {
          if (err) webhookRoutes.handleRoot(req, res);
        });
      }
      return webhookRoutes.handleRoot(req, res);
    });

    // Health check endpoints
    this.app.get('/health', webhookRoutes.healthCheck);
    this.app.get('/api/health', webhookRoutes.healthCheck);

    // ── Auth ──────────────────────────────────
    this.app.get('/login', (req, res) => {
      res.sendFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'views', 'login.html'));
    });
    this.app.post('/api/auth/register', validateContentType, asyncHandler(authController.register));
    this.app.post('/api/auth/login', validateContentType, asyncHandler(authController.login));
    this.app.post('/api/auth/logout', authController.logout);
    this.app.get('/api/auth/me', authenticate, asyncHandler(authController.me));
    this.app.post('/api/auth/api-keys', authenticate, validateContentType, asyncHandler(authController.createApiKey));
    this.app.get('/api/auth/api-keys', authenticate, asyncHandler(authController.listApiKeys));
    this.app.delete('/api/auth/api-keys/:id', authenticate, asyncHandler(authController.revokeApiKey));

    // Webhook endpoints (with validation)
    // Scrobble intake — API key (scrobbler clients) or JWT
    this.app.post('/webhook/scrobble',
      authenticateClient,
      validateContentType,
      debugWebhookData,
      validateTrackData,
      asyncHandler(webhookRoutes.handleScrobble)
    );
    this.app.post('/webhook',
      authenticateClient,
      validateContentType,
      debugWebhookData,
      validateTrackData,
      asyncHandler(webhookRoutes.handleScrobble)
    );

    // ── Analytics reads — any logged-in user, scoped to their own data ──
    this.app.get('/api/stats', authenticate, asyncHandler(webhookRoutes.getStats));
    this.app.get('/api/tracks', authenticate, asyncHandler(webhookRoutes.getRecentTracks));
    this.app.get('/api/tracks/top-artists', authenticate, asyncHandler(webhookRoutes.getTopArtistsLeaderboard));
    this.app.get('/api/tracks/top-tracks', authenticate, asyncHandler(webhookRoutes.getTopTracksLeaderboard));
    this.app.get('/api/track', authenticate, asyncHandler(webhookRoutes.getTrackAnalytics));
    this.app.get('/api/albums', authenticate, asyncHandler(webhookRoutes.getAlbumAnalytics));
    this.app.get('/api/artists/:name', authenticate, asyncHandler(webhookRoutes.getArtistProfile));
    this.app.get('/api/nowplaying', authenticate, asyncHandler(webhookRoutes.getNowPlaying));

    // Now-playing intake — API key or JWT
    this.app.post('/api/nowplaying/playing', authenticateClient, validateContentType, asyncHandler(webhookRoutes.setNowPlaying));

    // ── Admin-only writes / maintenance ──
    this.app.patch('/api/tracks',
      authenticate, requireRole('admin'),
      validateContentType,
      asyncHandler(webhookRoutes.updateTrackLovedStatus)
    );
    this.app.delete('/api/tracks/range',
      authenticate, requireRole('admin'),
      asyncHandler(webhookRoutes.deleteTracksByDateRange)
    );

    // Import (admin)
    this.app.get('/import/listenbrainz', authenticatePage, requireRole('admin'), webhookRoutes.renderListenBrainzImportPage);
    this.app.post('/api/import/listenbrainz',
      authenticate, requireRole('admin'),
      validateContentType,
      asyncHandler(webhookRoutes.importListenBrainz)
    );

    // Duplicate management (admin, scoped to own data)
    this.app.get('/api/duplicates', authenticate, requireRole('admin'), asyncHandler(webhookRoutes.getDuplicateStats));
    this.app.delete('/api/duplicates', authenticate, requireRole('admin'), asyncHandler(webhookRoutes.removeDuplicates));

    // Spotify integration — reads for any user, mutations admin-only
    this.app.get('/api/spotify/status', authenticate, asyncHandler(webhookRoutes.getSpotifyStatus));
    this.app.get('/api/spotify/stats', authenticate, asyncHandler(webhookRoutes.getSpotifyStats));
    this.app.post('/api/spotify/enrich', authenticate, requireRole('admin'), asyncHandler(webhookRoutes.enrichTracksWithSpotify));
    this.app.post('/api/spotify/update-missing', authenticate, requireRole('admin'), asyncHandler(webhookRoutes.updateMissingSpotifyData));
    this.app.delete('/api/spotify/cache', authenticate, requireRole('admin'), asyncHandler(webhookRoutes.clearSpotifyCache));

    // Migration endpoints (admin)
    this.app.get('/migrate', authenticatePage, requireRole('admin'), webhookRoutes.renderMigratePage);
    this.app.get('/inspect', authenticatePage, requireRole('admin'), webhookRoutes.renderInspectPage);
    this.app.get('/api/migrate/precheck', authenticate, requireRole('admin'), asyncHandler(webhookRoutes.migrationPrecheck));
    this.app.post('/api/migrate/run',
      authenticate, requireRole('admin'),
      validateContentType,
      webhookRoutes.runMigration  // Not wrapped in asyncHandler — handles its own streaming
    );

    // API info endpoint
    this.app.get('/api', (req, res) => {
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
  }

  setupErrorHandlers() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not found',
        message: `Endpoint ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
          'GET /',
          'GET /api',
          'GET /api/health',
          'GET /health',
          'GET /api/stats', 
          'GET /api/tracks',
          'GET /api/nowplaying',
          'GET /api/duplicates',
          'POST /webhook/scrobble',
          'GET /api/spotify/status',
          'GET /api/tracks/top-artists',
          'GET /api/tracks/top-tracks',
          'GET /api/migrate/precheck'
        ]
      });
    });

    // Global error handler
    this.app.use((error, req, res, next) => {
      console.error('❌ Global error handler:', error);

      // Handle specific error types
      if (error.type === 'entity.parse.failed') {
        return res.status(400).json({
          error: 'Bad request',
          message: 'Invalid JSON in request body'
        });
      }

      if (error.type === 'entity.too.large') {
        return res.status(413).json({
          error: 'Payload too large',
          message: 'Request body exceeds size limit'
        });
      }

      // Default error response
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date().toISOString()
      });
    });
  }

  async start() {
    try {
      // Connect to database
      console.log('🔌 Connecting to MongoDB...');
      await Database.connect();

      // Restore now-playing state from Redis
      await nowPlayingService.hydrate();

      // Seed the admin user from env (idempotent)
      await authService.seedAdmin();

      // Start the server
      const server = this.app.listen(PORT, () => {
        console.log(`🚀 Music Webhook Server running at PORT :${PORT}`);
        console.log(`📋 Available endpoints:`);
        console.log(`   GET  /            - Welcome & API overview`);
        console.log(`   GET  /api         - Dynamic endpoint listing`);
        console.log(`   GET  /health      - Health check`);
        console.log(`   POST /webhook/scrobble - Receive scrobble data`);
        console.log(`   GET  /api/stats   - Get statistics`);
        console.log(`   GET  /api/tracks  - Get recent tracks`);
        console.log(`   GET  /api/nowplaying   - Get now playing status`);
        console.log(`   GET  /api/spotify/status - Spotify integration status`);
        console.log(`   GET  /api/duplicates     - Duplicate track stats`);
        console.log(`   GET  /api/migrate/precheck - Migration pre-check`);
        console.log('');
        console.log('🎵 Ready to receive scrobble data from web-scrobbler!');
        console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      });

      // Handle server errors
      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`❌ Port ${PORT} is already in use`);
          process.exit(1);
        } else {
          console.error('❌ Server error:', error);
        }
      });

      return server;

    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Handle graceful shutdown
const gracefulShutdown = async (signal, server) => {
  console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
  
  try {
    // Close server
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
      console.log('✅ HTTP server closed');
    }

    // Close database connection
    await Database.disconnect();

    // Close Redis connection
    if (redis) {
      await redis.quit().catch(() => {});
      console.log('✅ Redis connection closed');
    }
    
    console.log('✅ Server shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

const musicServer = new MusicWebhookServer();

export const app = musicServer.app;
export default app;

const modulePath = fileURLToPath(import.meta.url);
const executedFile = process.argv[1];

if (executedFile === modulePath) {
  musicServer.start().then((server) => {
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', server));
    process.on('SIGINT', () => gracefulShutdown('SIGINT', server));

    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error);
      gracefulShutdown('UNCAUGHT_EXCEPTION', server);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
      gracefulShutdown('UNHANDLED_REJECTION', server);
    });
  }).catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
}
