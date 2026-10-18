import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { ControlPlaneService } from '../services/control/control-plane.service';
import { EmailDeskService } from '../services/control/email-desk.service';
import { TeamRole, AccessScope, EmailCategory, EmailStatus } from '@prisma/client';

const createMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(1, 'Name is required'),
  role: z.nativeEnum(TeamRole).optional(),
});

const updateRoleSchema = z.object({
  role: z.nativeEnum(TeamRole),
});

const accessScopeSchema = z.object({
  memberId: z.string().min(1, 'memberId is required'),
  scope: z.nativeEnum(AccessScope),
});

const triageEmailSchema = z.object({
  senderEmail: z.string().email('Invalid sender email'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
});

export class ControlController {
  static async createTeamMember(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = createMemberSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { email, name, role } = parseResult.data;
      const member = await ControlPlaneService.createTeamMember(req.user.userId, email, name, role);

      res.status(201).json({ success: true, message: 'Team member created with default access grants', member });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to create team member' });
    }
  }

  static async listTeamMembers(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const members = await ControlPlaneService.listTeamMembers(req.user.userId);
      res.status(200).json({ success: true, count: members.length, members });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to list team members' });
    }
  }

  static async updateMemberRole(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = updateRoleSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const id = String(req.params.id);
      const member = await ControlPlaneService.updateMemberRole(id, req.user.userId, parseResult.data.role);

      res.status(200).json({ success: true, message: 'Member role updated', member });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to update member role' });
    }
  }

  static async grantAccessScope(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = accessScopeSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { memberId, scope } = parseResult.data;
      const grant = await ControlPlaneService.grantScope(memberId, scope, req.user.userId);

      res.status(200).json({ success: true, message: `Scope '${scope}' granted`, grant });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to grant scope' });
    }
  }

  static async revokeAccessScope(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = accessScopeSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { memberId, scope } = parseResult.data;
      const grant = await ControlPlaneService.revokeScope(memberId, scope, req.user.userId);

      res.status(200).json({ success: true, message: `Scope '${scope}' revoked`, grant });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to revoke scope' });
    }
  }

  static async triageEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = triageEmailSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { senderEmail, subject, body } = parseResult.data;
      const message = await EmailDeskService.triageEmail(req.user.userId, senderEmail, subject, body);

      res.status(201).json({ success: true, message: 'Email triaged and cited draft staged', email: message });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to triage email' });
    }
  }

  static async listEmails(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const category = req.query.category as EmailCategory | undefined;
      const status = req.query.status as EmailStatus | undefined;

      const emails = await EmailDeskService.listMessages(req.user.userId, category, status);
      res.status(200).json({ success: true, count: emails.length, emails });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to list emails' });
    }
  }

  static async approveAndSendEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id);
      const email = await EmailDeskService.approveAndSendEmail(id, req.user.userId);

      res.status(200).json({ success: true, message: 'Email approved and sent', email });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to approve and send email' });
    }
  }

  static async deleteTeamMember(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id);
      await ControlPlaneService.deleteTeamMember(id, req.user.userId);

      res.status(200).json({ success: true, message: 'Team member deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to delete team member' });
    }
  }
}
