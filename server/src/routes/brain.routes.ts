import { Router } from 'express';
import { BrainController } from '../controllers/brain.controller';
import { GraphController } from '../controllers/graph.controller';
import { authenticateToken } from '../middlewares/auth.middleware';
import { apiRateLimiter } from '../middlewares/rate-limit.middleware';

const router = Router();

// Require authentication for all brain & skill operations
router.use(authenticateToken);

// Brain QA & Knowledge Graph Routes (graph-first, tenant-scoped)
router.post('/brain/query', apiRateLimiter, BrainController.query);
router.get('/brain/graph', GraphController.getGraphData);
router.get('/brain/graph/node/:id', GraphController.getNodeDetail);
router.post('/brain/graph/extract', GraphController.runExtraction);
router.get('/brain/trace/:traceId', GraphController.getTrace);
router.post('/brain/impact', GraphController.impact);
router.get('/brain/who-knows', GraphController.whoKnows);
router.get('/brain/stale', GraphController.staleQueue);
router.post('/brain/stale/:id/revalidate', GraphController.revalidateItem);
router.post('/brain/seed-demo', GraphController.seedDemo);
router.get('/brain/history', BrainController.getHistory);

// Policy Time Machine (W1)
router.post('/brain/simulate', BrainController.simulate);
router.post('/brain/simulate/:id/apply', BrainController.applySimulation);
router.post('/brain/simulate/:id/discard', BrainController.discardSimulation);
router.get('/brain/simulate/:id', BrainController.getSimulation);
router.get('/brain/rules', BrainController.graphRules);

// Why-Not explanations (W3)
router.get('/brain/why-not', BrainController.whyNot);
router.post('/brain/why-not', BrainController.whyNot);

// Hash-chained decision ledger (W4)
router.get('/ledger/verify', BrainController.ledgerVerify);
router.get('/ledger', BrainController.ledgerList);

// Knowledge Health report (W5)
router.get('/brain/health', BrainController.health);

// Graph-vs-RAG compare (W2)
router.post('/brain/compare', apiRateLimiter, BrainController.compare);

// Tool registry over REST (Track 01)
router.post('/brain/tools', GraphController.callTool);

// Agent memory endpoints (Track 02)
router.post('/memory/episodes', GraphController.writeEpisode);
router.get('/memory/recall', GraphController.recallMemory);
router.get('/memory/conversations/:id', GraphController.getConversation);
router.get('/memory/stats', GraphController.memoryStats);

// Executable Skill Rule Engine Routes
router.post('/skills/extract', BrainController.extractSkills);
router.post('/skills/create', BrainController.createSkill);
router.get('/skills', BrainController.listSkills);
router.post('/skills/update', BrainController.updateSkill);
router.delete('/skills/:id', BrainController.deleteSkill);
router.post('/skills/execute', BrainController.executeSkill);

export default router;
