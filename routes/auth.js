import express from 'express';
import rateLimit from 'express-rate-limit';
import authController from '../controllers/authController.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import { validateContentType, asyncHandler } from '../middleware/validation.js';

const router = express.Router();

// Brute-force guard for credential endpoints. Only failed attempts count, so
// normal logins never hit it. Keyed by req.ip (trust proxy is on), so a server
// proxying logins should forward the client's X-Forwarded-For.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Read per request: dotenv loads after this module is imported.
  max: () => Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Too many failed attempts. Please try again later.',
  },
});

// ── Auth ──────────────────────────────────
router.post('/api/auth/register', authLimiter, optionalAuthenticate, validateContentType, asyncHandler(authController.register));
router.post('/api/auth/login', authLimiter, validateContentType, asyncHandler(authController.login));
router.post('/api/auth/logout', authController.logout);
router.get('/api/auth/me', authenticate, asyncHandler(authController.me));
router.post('/api/auth/api-keys', authenticate, validateContentType, asyncHandler(authController.createApiKey));
router.get('/api/auth/api-keys', authenticate, asyncHandler(authController.listApiKeys));
router.delete('/api/auth/api-keys/:id', authenticate, asyncHandler(authController.revokeApiKey));

export default router;
