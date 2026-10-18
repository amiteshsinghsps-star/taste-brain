import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { AgentManagerService } from '../services/agent/agent-manager.service';
import { AgentWorkflowsService } from '../services/agent/agent-workflows.service';
import { AgentStatus, AgentMode, TaskStatus } from '@prisma/client';

const createAgentSchema = z.object({
  name: z.string().min(1, 'Agent name is required'),
  type: z.string().optional(),
  mode: z.nativeEnum(AgentMode).optional(),
  configuration: z.record(z.any()).optional(),
});

const updateStatusSchema = z.object({
  status: z.nativeEnum(AgentStatus),
});

const updateModeSchema = z.object({
  mode: z.nativeEnum(AgentMode),
});

const freightWorkflowSchema = z.object({
  bookingNumber: z.string().optional(),
  shipper: z.string().min(1, 'Shipper is required'),
  consignee: z.string().min(1, 'Consignee is required'),
  origin: z.string().min(1, 'Origin is required'),
  destination: z.string().min(1, 'Destination is required'),
  hsCode: z.string().optional(),
  containerType: z.string().optional(),
});

const genericWorkflowSchema = z.object({
  workflowType: z.enum(['ANSWER_AND_DRAFT', 'SUMMARIZE_THREAD', 'EXTRACT_ACTION_ITEMS']),
  payload: z.record(z.any()),
});

export class AgentController {
  static async createAgent(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = createAgentSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { name, type, mode, configuration } = parseResult.data;
      const agent = await AgentManagerService.createAgent(req.user.userId, name, type, mode, configuration);

      res.status(201).json({ success: true, message: 'Agent instance created', agent });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to create agent' });
    }
  }

  static async listAgents(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const agents = await AgentManagerService.listAgents(req.user.userId);
      res.status(200).json({ success: true, count: agents.length, agents });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to list agents' });
    }
  }

  static async updateStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = updateStatusSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const id = String(req.params.id);
      const updated = await AgentManagerService.updateStatus(id, req.user.userId, parseResult.data.status);
      res.status(200).json({ success: true, message: 'Agent status updated', agent: updated });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to update agent status' });
    }
  }

  static async updateMode(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = updateModeSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const id = String(req.params.id);
      const updated = await AgentManagerService.updateMode(id, req.user.userId, parseResult.data.mode);
      res.status(200).json({ success: true, message: 'Agent mode updated', agent: updated });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to update agent mode' });
    }
  }

  static async runFreightWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = freightWorkflowSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const id = String(req.params.id);
      const result = await AgentWorkflowsService.executeFreightWorkflow(id, req.user.userId, parseResult.data);
      res.status(200).json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Freight workflow execution failed' });
    }
  }

  static async runGenericWorkflow(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = genericWorkflowSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const id = String(req.params.id);
      const { workflowType, payload } = parseResult.data;

      let result: any;
      if (workflowType === 'ANSWER_AND_DRAFT') {
        result = await AgentWorkflowsService.answerAndDraftWorkflow(id, req.user.userId, payload.prompt, payload.recipient);
      } else if (workflowType === 'SUMMARIZE_THREAD') {
        result = await AgentWorkflowsService.summarizeThreadWorkflow(id, req.user.userId, payload.content || payload.threadContent);
      } else {
        result = await AgentWorkflowsService.extractActionItemsWorkflow(id, req.user.userId, payload.content || payload.textContent);
      }

      res.status(200).json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Generic workflow execution failed' });
    }
  }

  static async approveTask(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const taskId = String(req.params.taskId);
      const task = await AgentWorkflowsService.approveTask(taskId, req.user.userId);
      res.status(200).json({ success: true, message: 'Task approved and executed', task });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to approve task' });
    }
  }

  static async listTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const status = req.query.status as TaskStatus | undefined;
      const tasks = await AgentWorkflowsService.listTasks(req.user.userId, status);
      res.status(200).json({ success: true, count: tasks.length, tasks });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch agent tasks' });
    }
  }

  static async getAuditLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const agentId = req.query.agentId as string | undefined;
      const logs = await AgentManagerService.getAuditLogs(req.user.userId, agentId);
      res.status(200).json({ success: true, count: logs.length, logs });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch agent audit logs' });
    }
  }

  static async deleteAgent(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id);
      await AgentManagerService.deleteAgent(id, req.user.userId);
      res.status(200).json({ success: true, message: 'Agent deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to delete agent' });
    }
  }
}
