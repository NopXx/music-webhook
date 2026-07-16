import express from 'express';
import authController from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validateContentType, asyncHandler } from '../middleware/validation.js';

const router = express.Router();

// ── Auth ──────────────────────────────────
router.post('/api/auth/register', validateContentType, asyncHandler(authController.register));
router.post('/api/auth/login', validateContentType, asyncHandler(authController.login));
router.post('/api/auth/logout', authController.logout);
router.get('/api/auth/me', authenticate, asyncHandler(authController.me));
router.post('/api/auth/api-keys', authenticate, validateContentType, asyncHandler(authController.createApiKey));
router.get('/api/auth/api-keys', authenticate, asyncHandler(authController.listApiKeys));
router.delete('/api/auth/api-keys/:id', authenticate, asyncHandler(authController.revokeApiKey));

export default router;
