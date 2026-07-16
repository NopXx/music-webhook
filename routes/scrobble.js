import express from 'express';
import scrobbleController from '../controllers/scrobbleController.js';
import systemController from '../controllers/systemController.js';
import { authenticate, authenticatePage, authenticateClient, requireRole } from '../middleware/auth.js';
import { validateTrackData, validateContentType, asyncHandler } from '../middleware/validation.js';
import { debugWebhookData } from '../middleware/debug.js';

const router = express.Router();

const handleScrobble = scrobbleController.handleScrobble.bind(scrobbleController);

// Webhook endpoints (with validation)
// Scrobble intake — API key (scrobbler clients) or JWT
router.post('/webhook/scrobble',
  authenticateClient,
  validateContentType,
  debugWebhookData,
  validateTrackData,
  asyncHandler(handleScrobble)
);
router.post('/webhook',
  authenticateClient,
  validateContentType,
  debugWebhookData,
  validateTrackData,
  asyncHandler(handleScrobble)
);

// ── Admin-only writes / maintenance ──
router.patch('/api/tracks',
  authenticate, requireRole('admin'),
  validateContentType,
  asyncHandler(scrobbleController.updateTrackLovedStatus.bind(scrobbleController))
);
router.delete('/api/tracks/range',
  authenticate, requireRole('admin'),
  asyncHandler(systemController.deleteTracksByDateRange.bind(systemController))
);

// Import (admin)
router.get('/import/listenbrainz',
  authenticatePage, requireRole('admin'),
  scrobbleController.renderListenBrainzImportPage.bind(scrobbleController)
);
router.post('/api/import/listenbrainz',
  authenticate, requireRole('admin'),
  validateContentType,
  asyncHandler(scrobbleController.importListenBrainz.bind(scrobbleController))
);

export default router;
