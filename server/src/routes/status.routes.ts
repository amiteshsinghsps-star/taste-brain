import { Router } from 'express';
import { StatusService } from '../services/brain/status.service';
import { connectorStatus } from '../config/flags';
import { authenticateToken, AuthenticatedRequest } from '../middlewares/auth.middleware';

const router = Router();

/**
 * Public proof endpoint (E04): shows the live graph is really serving the
 * product. Returns aggregate structure only — counts and label names — never
 * node contents and never tenant identifiers.
 */
router.get('/status', async (_req, res) => {
  const payload = await StatusService.platformStatus();
  res.status(payload.ok ? 200 : 503).json({ success: payload.ok, ...payload });
});

router.get('/status/connectors', (_req, res) => {
  res.json({ success: true, ...connectorStatus() });
});

// Tenant-scoped counts for the explorer header.
router.get('/status/graph', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const stats = await StatusService.tenantStats(req.user!.userId);
    res.json({ success: true, backend: 'falkordb', ...stats });
  } catch (err: any) {
    res.status(503).json({ success: false, code: err?.code ?? 'GRAPH_UNAVAILABLE', message: err.message });
  }
});

export default router;
