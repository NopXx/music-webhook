import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import Database from './config/database.js';
import redis from './config/redis.js';
import nowPlayingService from './services/nowPlayingService.js';
import authService from './services/authService.js';
import pagesRouter from './routes/pages.js';
import authRouter from './routes/auth.js';
import scrobbleRouter from './routes/scrobble.js';
import analyticsRouter from './routes/analytics.js';
import playerRouter from './routes/player.js';
import spotifyRouter from './routes/spotify.js';
import systemRouter from './routes/system.js';
import {
  requestLogger,
  rateLimitInfo
} from './middleware/validation.js';
import {
  debugMiddleware
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
    // Domain routers, mounted at root so full paths are preserved.
    // Order matches the original route registration: pages/docs, auth,
    // scrobble/webhook, analytics, player, spotify, system.
    this.app.use(pagesRouter);
    this.app.use(authRouter);
    this.app.use(scrobbleRouter);
    this.app.use(analyticsRouter);
    this.app.use(playerRouter);
    this.app.use(spotifyRouter);
    this.app.use(systemRouter);
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
