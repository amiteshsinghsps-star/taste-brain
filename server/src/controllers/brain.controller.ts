import { Response } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { SkillsService } from '../services/brain/skills.service';
import { RetrievalService } from '../services/brain/retrieval.service';
import { getTrace, traceToSentences } from '../services/brain/trace.service';
import { CategoryType } from '@prisma/client';
import { prisma } from '../db/client';
import { SimulationService } from '../services/brain/simulation.service';
import { WhyNotService } from '../services/brain/whynot.service';
import { LedgerService } from '../services/brain/ledger.service';
import { HealthService } from '../services/brain/health.service';
import { compareQuestion } from '../services/brain/eval.service';
import { loadRulesFromGraph } from '../services/brain/rule-engine.service';

const querySchema = z.object({
  query: z.string().min(1, 'Query text is required'),
});

const createSkillSchema = z.object({
  category: z.nativeEnum(CategoryType).optional(),
  ruleName: z.string().min(1, 'ruleName is required'),
  description: z.string().min(1, 'description is required'),
  triggerCondition: z.string().min(1, 'triggerCondition is required'),
  actionType: z.string().min(1, 'actionType is required'),
  parameters: z.record(z.any()).optional(),
  isExecutable: z.boolean().optional(),
});

const updateSkillSchema = z.object({
  skillId: z.string().min(1, 'skillId is required'),
  ruleName: z.string().optional(),
  description: z.string().optional(),
  triggerCondition: z.string().optional(),
  actionType: z.string().optional(),
  parameters: z.record(z.any()).optional(),
  isExecutable: z.boolean().optional(),
});

const executeSkillSchema = z.object({
  skillId: z.string().min(1, 'skillId is required'),
  payload: z.record(z.any()),
});

export class BrainController {
  /**
   * Graph-first brain query (FR-9/FR-10). Never falls back to SQL keywords:
   * if FalkorDB is down the typed GRAPH_UNAVAILABLE error is returned.
   */
  static async query(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = querySchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const result = await RetrievalService.query(req.user.userId, parseResult.data.query);
      res.status(200).json({ success: true, ...result });
    } catch (error: any) {
      if (error?.code === 'GRAPH_UNAVAILABLE') {
        res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: 'FalkorDB not reachable — the Company Brain requires the graph store.' });
        return;
      }
      res.status(500).json({ success: false, message: error.message || 'Brain query failed' });
    }
  }

  // /brain/graph and /brain/graph/extract are served by GraphController
  // (tenant-scoped FalkorDB versions); kept out of this controller.

  static async extractSkills(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const result = await SkillsService.extractSkillsFromSOPs(req.user.userId);
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Skill rule extraction failed' });
    }
  }

  static async createSkill(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = createSkillSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const skill = await SkillsService.createSkill(req.user.userId, parseResult.data);
      res.status(201).json({ success: true, message: 'Skill rule created', skill });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to create skill rule' });
    }
  }

  static async listSkills(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const category = req.query.category as CategoryType | undefined;
      const skills = await SkillsService.listSkills(req.user.userId, category);
      res.status(200).json({ success: true, count: skills.length, skills });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to list skill rules' });
    }
  }

  static async updateSkill(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = updateSkillSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { skillId, ...updates } = parseResult.data;
      const updatedSkill = await SkillsService.updateSkill(skillId, req.user.userId, updates);

      res.status(200).json({
        success: true,
        message: 'Skill rule updated and version incremented',
        skill: updatedSkill,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to update skill rule' });
    }
  }

  static async deleteSkill(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const id = String(req.params.id);
      const result = await SkillsService.deleteSkill(id, req.user.userId);
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to delete skill rule' });
    }
  }

  static async executeSkill(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const parseResult = executeSkillSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({ success: false, errors: parseResult.error.errors });
        return;
      }

      const { skillId, payload } = parseResult.data;
      const executionResult = await SkillsService.executeSkill(skillId, req.user.userId, payload);

      res.status(200).json({ success: true, execution: executionResult });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Skill execution failed' });
    }
  }

  static async getHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const logs = await prisma.brainQueryLog.findMany({
        where: { userId: req.user.userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      // Attach stored trace text where still available
      const withTraces = logs.map((l: any) => {
        const t = l.traceId ? getTrace(l.traceId) : null;
        return { ...l, tracePresent: Boolean(t), traceSentences: t ? traceToSentences(t) : [] };
      });
      res.status(200).json({ success: true, logs: withTraces });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message || 'Failed to fetch query logs' });
    }
  }

  // ---- W1 Policy Time Machine ----
  static async simulate(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }
      const body = z
        .object({
          ruleId: z.string().min(1),
          candidateParams: z.record(z.any()),
          fromTs: z.number().optional(),
          toTs: z.number().optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ success: false, code: 'INVALID_SCHEMA', errors: body.error.errors });
        return;
      }
      const result = await SimulationService.simulate(req.user.userId, body.data);
      res.status(200).json({ success: true, simulation: result });
    } catch (error: any) {
      if (error?.code === 'GRAPH_UNAVAILABLE') {
        res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: 'FalkorDB not reachable' });
        return;
      }
      res.status(400).json({ success: false, message: error.message || 'Simulation failed' });
    }
  }

  static async applySimulation(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }
      const body = z.object({ approver: z.string().optional(), approverNote: z.string().optional() }).safeParse(req.body || {});
      const approver = body.success ? body.data.approver || req.user.email || 'Human approver' : 'Human approver';
      const result = await SimulationService.apply(req.user.userId, String(req.params.id), approver, body.success ? body.data.approverNote : undefined);
      res.status(200).json({ success: true, ...result });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Apply failed' });
    }
  }

  static async discardSimulation(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const ok = await SimulationService.discard(req.user!.userId, String(req.params.id));
      res.status(ok ? 200 : 404).json({ success: ok });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Discard failed' });
    }
  }

  static async getSimulation(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const sim = await SimulationService.get(req.user!.userId, String(req.params.id));
      if (!sim) {
        res.status(404).json({ success: false, message: 'Simulation not found' });
        return;
      }
      res.status(200).json({ success: true, simulation: sim });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Fetch failed' });
    }
  }

  /** Active graph rules with params — powers the "What if..." param editor. */
  static async graphRules(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const rules = await loadRulesFromGraph(req.user!.userId);
      res.status(200).json({ success: true, count: rules.length, rules });
    } catch (error: any) {
      res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: error.message });
    }
  }

  // ---- W3 Why-Not ----
  static async whyNot(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }
      const bookingNumber = String(req.query.booking || req.body?.booking || '').trim();
      if (!bookingNumber) {
        res.status(400).json({ success: false, code: 'INVALID_SCHEMA', message: 'booking query param required (e.g. BK-1043)' });
        return;
      }
      const result = await WhyNotService.whyNot(req.user.userId, bookingNumber);
      if (!result) {
        res.status(404).json({ success: false, message: `Booking ${bookingNumber} not found in the tenant graph` });
        return;
      }
      res.status(200).json({ success: true, whyNot: result });
    } catch (error: any) {
      if (error?.code === 'GRAPH_UNAVAILABLE') {
        res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: 'FalkorDB not reachable' });
        return;
      }
      res.status(500).json({ success: false, message: error.message || 'Why-Not failed' });
    }
  }

  // ---- W4 Ledger ----
  static async ledgerVerify(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await LedgerService.verify(req.user!.userId);
      res.status(200).json({ success: true, ...result });
    } catch (error: any) {
      res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: error.message });
    }
  }

  static async ledgerList(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const limit = Math.min(Number(req.query.limit || 50), 200);
      const entries = await LedgerService.list(req.user!.userId, limit);
      const verify = await LedgerService.verify(req.user!.userId);
      res.status(200).json({ success: true, entries, chain: verify });
    } catch (error: any) {
      res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: error.message });
    }
  }

  // ---- W5 Knowledge Health ----
  static async health(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const report = await HealthService.report(req.user!.userId);
      res.status(200).json({ success: true, ...report });
    } catch (error: any) {
      res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: error.message });
    }
  }

  // ---- W2 Compare ----
  static async compare(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }
      const body = z.object({ question: z.string().min(1) }).safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ success: false, code: 'INVALID_SCHEMA', message: 'question is required' });
        return;
      }
      const q = {
        id: 'adhoc',
        category: 'ownership' as const,
        text: body.data.question,
        expectedEntities: [],
        expectedChunkIds: [],
        forbiddenChunkIds: [],
      };
      const result = await compareQuestion(req.user.userId, q);
      res.status(200).json({ success: true, ...result });
    } catch (error: any) {
      if (error?.code === 'GRAPH_UNAVAILABLE') {
        res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: 'FalkorDB not reachable' });
        return;
      }
      res.status(500).json({ success: false, message: error.message || 'Compare failed' });
    }
  }
}
