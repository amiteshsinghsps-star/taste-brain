import { Router } from 'express';
import { IngestionController } from '../controllers/ingestion.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

// Protect all ingestion routes
router.use(authenticateToken);

router.post('/sources', IngestionController.createSource);
router.get('/sources', IngestionController.listSources);
router.post('/sources/:id/sync', IngestionController.syncSource);
router.delete('/sources/:id', IngestionController.deleteSource);
router.get('/documents', IngestionController.listDocuments);
router.post('/upload', IngestionController.uploadDocument);

export default router;
