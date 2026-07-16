import express from 'express';
import spotifyController from '../controllers/spotifyController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/validation.js';

const router = express.Router();

// Spotify integration — reads for any user, mutations admin-only
router.get('/api/spotify/status', authenticate, asyncHandler(spotifyController.getSpotifyStatus.bind(spotifyController)));
router.get('/api/spotify/stats', authenticate, asyncHandler(spotifyController.getSpotifyStats.bind(spotifyController)));
router.post('/api/spotify/enrich', authenticate, requireRole('admin'), asyncHandler(spotifyController.enrichTracksWithSpotify.bind(spotifyController)));
router.post('/api/spotify/update-missing', authenticate, requireRole('admin'), asyncHandler(spotifyController.updateMissingSpotifyData.bind(spotifyController)));
router.delete('/api/spotify/cache', authenticate, requireRole('admin'), asyncHandler(spotifyController.clearSpotifyCache.bind(spotifyController)));

export default router;
