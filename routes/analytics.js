import express from 'express';
import analyticsController from '../controllers/analyticsController.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/validation.js';

const router = express.Router();

// ── Analytics reads — any logged-in user, scoped to their own data ──
router.get('/api/stats', authenticate, asyncHandler(analyticsController.getStats.bind(analyticsController)));
router.get('/api/tracks', authenticate, asyncHandler(analyticsController.getRecentTracks.bind(analyticsController)));
router.get('/api/tracks/top-artists', authenticate, asyncHandler(analyticsController.getTopArtistsLeaderboard.bind(analyticsController)));
router.get('/api/tracks/top-tracks', authenticate, asyncHandler(analyticsController.getTopTracksLeaderboard.bind(analyticsController)));
router.get('/api/track', authenticate, asyncHandler(analyticsController.getTrackAnalytics.bind(analyticsController)));
router.get('/api/albums', authenticate, asyncHandler(analyticsController.getAlbumAnalytics.bind(analyticsController)));
router.get('/api/artists/:name', authenticate, asyncHandler(analyticsController.getArtistProfile.bind(analyticsController)));

export default router;
