import express from 'express';
import playerController from '../controllers/playerController.js';
import { authenticate, authenticateClient } from '../middleware/auth.js';
import { validateContentType, asyncHandler } from '../middleware/validation.js';

const router = express.Router();

// Now-playing read — any logged-in user
router.get('/api/nowplaying', authenticate, asyncHandler(playerController.getNowPlaying.bind(playerController)));

// Now-playing intake — API key or JWT
router.post('/api/nowplaying/playing', authenticateClient, validateContentType, asyncHandler(playerController.setNowPlaying.bind(playerController)));

export default router;
