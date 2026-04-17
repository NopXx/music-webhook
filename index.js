import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import Database from './config/database.js';
import webhookRoutes from './routes/webhook.js';
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
    // Root endpoint
    this.app.get('/', webhookRoutes.handleRoot);

    // Health check endpoints
    this.app.get('/health', webhookRoutes.healthCheck);
    this.app.get('/api/health', webhookRoutes.healthCheck);

    // Webhook endpoints (with validation)
    this.app.post('/webhook/scrobble', 
      validateContentType,
      debugWebhookData,
      validateTrackData,
      asyncHandler(webhookRoutes.handleScrobble)
    );
    this.app.post('/webhook', 
      validateContentType,
      debugWebhookData,
      validateTrackData,
      asyncHandler(webhookRoutes.handleScrobble)
    );

    // API endpoints
    this.app.get('/api/stats', asyncHandler(webhookRoutes.getStats));
    this.app.get('/api/tracks', asyncHandler(webhookRoutes.getRecentTracks));
    this.app.patch('/api/tracks',
      validateContentType,
      asyncHandler(webhookRoutes.updateTrackLovedStatus)
    );
    this.app.get('/api/tracks/top-artists', asyncHandler(webhookRoutes.getTopArtistsLeaderboard));
    this.app.get('/api/tracks/top-tracks', asyncHandler(webhookRoutes.getTopTracksLeaderboard));
    this.app.get('/api/track', asyncHandler(webhookRoutes.getTrackAnalytics));
    this.app.get('/api/albums', asyncHandler(webhookRoutes.getAlbumAnalytics));
    this.app.get('/api/artists/:name', asyncHandler(webhookRoutes.getArtistProfile));
    this.app.get('/api/nowplaying', asyncHandler(webhookRoutes.getNowPlaying));
    this.app.post('/api/nowplaying/playing', validateContentType, asyncHandler(webhookRoutes.setNowPlaying));
    this.app.get('/import/listenbrainz', webhookRoutes.renderListenBrainzImportPage);
    this.app.post('/api/import/listenbrainz',
      validateContentType,
      asyncHandler(webhookRoutes.importListenBrainz)
    );
    this.app.delete('/api/tracks/range',
      asyncHandler(webhookRoutes.deleteTracksByDateRange)
    );
    
    // Duplicate management endpoints
    this.app.get('/api/duplicates', asyncHandler(webhookRoutes.getDuplicateStats));
    this.app.delete('/api/duplicates', asyncHandler(webhookRoutes.removeDuplicates));
    
    // Spotify integration endpoints
    this.app.get('/api/spotify/status', asyncHandler(webhookRoutes.getSpotifyStatus));
    this.app.get('/api/spotify/stats', asyncHandler(webhookRoutes.getSpotifyStats));
    this.app.post('/api/spotify/enrich', asyncHandler(webhookRoutes.enrichTracksWithSpotify));
    this.app.post('/api/spotify/update-missing', asyncHandler(webhookRoutes.updateMissingSpotifyData));
    this.app.delete('/api/spotify/cache', asyncHandler(webhookRoutes.clearSpotifyCache));

    // Migration endpoints
    this.app.get('/migrate', webhookRoutes.renderMigratePage);
    this.app.get('/api/migrate/precheck', asyncHandler(webhookRoutes.migrationPrecheck));
    this.app.post('/api/migrate/run',
      validateContentType,
      webhookRoutes.runMigration  // Not wrapped in asyncHandler — handles its own streaming
    );

    // API info endpoint
    this.app.get('/api', (req, res) => {
      res.json({
        message: 'Music Webhook API',
        version: '1.0.0',
        endpoints: {
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
          'DELETE /api/spotify/cache': 'Clear Spotify search cache'
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
          'GET /api/health',
          'GET /api/stats', 
          'GET /api/tracks',
          'GET /api/nowplaying',
          'POST /webhook/scrobble'
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

      // Start the server
      const server = this.app.listen(PORT, () => {
        console.log(`🚀 Music Webhook Server running at PORT :${PORT}`);
        console.log(`📋 Available endpoints:`);
        console.log(`   POST /webhook/scrobble - Receive scrobble data`);
        console.log(`   GET  /api/stats - Get statistics`);
        console.log(`   GET  /api/tracks - Get recent tracks`);
        console.log(`   GET  /api/nowplaying - Get now playing status`);
        console.log(`   POST /api/nowplaying/playing - Update now playing status`);
        console.log(`   GET  /api/health - Health check`);
        console.log(`   GET  / - API documentation`);
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
