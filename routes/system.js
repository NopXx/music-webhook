import express from 'express';
import systemController from '../controllers/systemController.js';
import { authenticate, authenticatePage, requireRole } from '../middleware/auth.js';
import { validateContentType, asyncHandler } from '../middleware/validation.js';

const router = express.Router();

// Duplicate management (admin, scoped to own data)
router.get('/api/duplicates', authenticate, requireRole('admin'), asyncHandler(systemController.getDuplicateStats.bind(systemController)));
router.delete('/api/duplicates', authenticate, requireRole('admin'), asyncHandler(systemController.removeDuplicates.bind(systemController)));

// Migration endpoints (admin)
router.get('/migrate', authenticatePage, requireRole('admin'), systemController.renderMigratePage.bind(systemController));
router.get('/inspect', authenticatePage, requireRole('admin'), systemController.renderInspectPage.bind(systemController));
router.get('/api/migrate/precheck', authenticate, requireRole('admin'), asyncHandler(systemController.migrationPrecheck.bind(systemController)));
router.post('/api/migrate/run',
  authenticate, requireRole('admin'),
  validateContentType,
  systemController.runMigration.bind(systemController)  // Not wrapped in asyncHandler — handles its own streaming
);

export default router;
