import { Router } from 'express';
import { ControlController } from '../controllers/control.controller';
import { authenticateToken } from '../middlewares/auth.middleware';

const router = Router();

// Protect all Control Plane routes
router.use(authenticateToken);

// Employee & Team Member Management
router.post('/control/team', ControlController.createTeamMember);
router.get('/control/team', ControlController.listTeamMembers);
router.patch('/control/team/:id/role', ControlController.updateMemberRole);
router.delete('/control/team/:id', ControlController.deleteTeamMember);

// Granular 6-Scope Access Control
router.post('/control/access/grant', ControlController.grantAccessScope);
router.post('/control/access/revoke', ControlController.revokeAccessScope);

// Email Desk Triage & Approval Engine
router.post('/email-desk/triage', ControlController.triageEmail);
router.get('/email-desk/messages', ControlController.listEmails);
router.post('/email-desk/:id/approve', ControlController.approveAndSendEmail);

export default router;
