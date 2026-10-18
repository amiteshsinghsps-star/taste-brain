import { Router } from 'express';
import { AgentController } from '../controllers/agent.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

// Require authentication for all agent operations
router.use(authenticateToken);

router.post('/agents', AgentController.createAgent);
router.get('/agents', AgentController.listAgents);
router.patch('/agents/:id/status', AgentController.updateStatus);
router.patch('/agents/:id/mode', AgentController.updateMode);
router.delete('/agents/:id', AgentController.deleteAgent);
router.post('/agents/:id/freight', AgentController.runFreightWorkflow);
router.post('/agents/:id/workflow', AgentController.runGenericWorkflow);
router.get('/agents/tasks', AgentController.listTasks);
router.post('/agents/tasks/:taskId/approve', AgentController.approveTask);
router.get('/agents/audit', AgentController.getAuditLogs);

export default router;
