import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { TenantGraphService } from '../services/brain/graph.service';
import { GraphToolsService } from '../services/brain/tools.service';
import { FreshnessService } from '../services/brain/freshness.service';
import { PrecedentService } from '../services/brain/precedent.service';
import { RetrievalService } from '../services/brain/retrieval.service';
import { getTrace, traceToSentences } from '../services/brain/trace.service';
import { MemoryService } from '../services/memory/memory.service';
import { NorthwindSeeder } from '../seed/northwind.seed';
import { GraphUnavailableError } from '../graph/graph.client';
import { prisma } from '../db/client';

/** Typed error contract (§11.4). */
function errorCode(err: any): { code: string; status: number } {
  if (err instanceof GraphUnavailableError || err?.code === 'GRAPH_UNAVAILABLE') return { code: 'GRAPH_UNAVAILABLE', status: 503 };
  if (/not found/i.test(err?.message || '')) return { code: 'TENANT_NOT_FOUND', status: 404 };
  if (/cannot|invalid/i.test(err?.message || '')) return { code: 'INVALID_SCHEMA', status: 400 };
  return { code: 'EXTRACTION_FAILED', status: 500 };
}

export class GraphController {
  static async getGraphData(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user!.userId;
      const { focus, depth, labels } = req.query as any;
      const graph = await TenantGraphService.getGraphData(tenantId, {
        focus: focus || undefined,
        depth: depth ? Number(depth) : undefined,
        labels: labels ? String(labels).split(',') : undefined,
      });
      res.status(200).json({ success: true, graph, stats: await TenantGraphService.getGraphStats(tenantId) });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Failed to fetch graph' });
    }
  }

  static async getNodeDetail(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const detail = await TenantGraphService.getNodeDetail(req.user!.userId, String(req.params.id));
      if (!detail) {
        res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND', message: 'Node not found in tenant graph' });
        return;
      }
      res.status(200).json({ success: true, ...detail });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Failed to fetch node' });
    }
  }

  static async runExtraction(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user!.userId;
      const result = await TenantGraphService.extractGraphFromDocuments(tenantId);
      res.status(200).json(result);
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Extraction failed' });
    }
  }

  static async getTrace(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const trace = getTrace(String(req.params.traceId));
      if (!trace) {
        res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND', message: 'Trace not found (may have expired)' });
        return;
      }
      res.status(200).json({ success: true, trace, traceSentences: traceToSentences(trace) });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Failed to fetch trace' });
    }
  }

  static async impact(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await GraphToolsService.impactOfChange(req.user!.userId, String(req.body.policyId || ''));
      if (!result) {
        res.status(404).json({ success: false, code: 'TENANT_NOT_FOUND', message: 'Policy not found' });
        return;
      }
      res.status(200).json({ success: true, impact: result });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Impact analysis failed' });
    }
  }

  static async whoKnows(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const topic = String(req.query.topic || '');
      if (!topic.trim()) {
        res.status(400).json({ success: false, code: 'INVALID_SCHEMA', message: 'topic query param required' });
        return;
      }
      const result = await GraphToolsService.whoKnowsMost(req.user!.userId, topic);
      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Expertise ranking failed' });
    }
  }

  static async staleQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const items = await FreshnessService.staleQueue(req.user!.userId);
      res.status(200).json({ success: true, count: items.length, items });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Failed to fetch stale queue' });
    }
  }

  static async revalidateItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const ok = await FreshnessService.revalidateItem(req.user!.userId, String(req.params.id));
      res.status(ok ? 200 : 404).json({ success: ok, id: req.params.id });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Failed to revalidate' });
    }
  }

  static async seedDemo(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user!.userId;
      // Wipe-and-seed keeps the one-click demo idempotent (re-clicking never duplicates).
      const { deleteTenantGraph } = await import('../graph/graph.client');
      await deleteTenantGraph(tenantId).catch(() => {});
      const { NorthwindSeeder } = await import('../seed/northwind.seed');
      const { SeedV3 } = await import('../seed/seed-v3');
      const result = await NorthwindSeeder.seed(tenantId);
      const v3 = await SeedV3.seed(tenantId);
      const counts = { ...result.counts, ...v3.counts };
      // Audit the demo seeding
      try {
        await prisma.agentAuditLog.create({
          data: { userId: tenantId, action: 'DEMO_COMPANY_SEEDED', details: counts as any },
        });
      } catch {
        // audit best-effort
      }
      const stats = await TenantGraphService.getGraphStats(tenantId);
      res.status(200).json({ success: true, message: 'Demo company loaded', seeded: true, counts, stats });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Demo seeding failed' });
    }
  }

  // ---- Memory endpoints (FR-19..FR-23) ----
  static async writeEpisode(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { summary, entities, outcome, agentId, shared } = req.body || {};
      const id = await MemoryService.writeEpisode(
        { tenantId: req.user!.userId, agentId, shared },
        String(summary || ''),
        Array.isArray(entities) ? entities : [],
        outcome
      );
      res.status(201).json({ success: true, episodeId: id });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Failed to write episode' });
    }
  }

  static async recallMemory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const q = String(req.query.q || '');
      const agentId = (req.query.agentId as string | undefined) || undefined;
      const tokens = q.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
      const memories = await MemoryService.recall({ tenantId: req.user!.userId, agentId }, tokens.length ? tokens : [q], agentId);
      res.status(200).json({ success: true, count: memories.length, memories });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Recall failed' });
    }
  }

  static async getConversation(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const turns = await MemoryService.getConversation({ tenantId: req.user!.userId }, String(req.params.id));
      res.status(200).json({ success: true, count: turns.length, turns });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Conversation fetch failed' });
    }
  }

  static async memoryStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const stats = await MemoryService.memoryStats(req.user!.userId);
      res.status(200).json({ success: true, ...stats });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Memory stats failed' });
    }
  }

  // ---- Tool registry over REST (Track 01) ----
  static async callTool(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const tenantId = req.user!.userId;
      const { tool, args } = req.body || {};
      let result: any;
      switch (tool) {
        case 'find_owner':
          result = await GraphToolsService.findOwner(tenantId, String(args?.entity || ''));
          break;
        case 'get_policy_for':
          result = await GraphToolsService.getPolicyFor(tenantId, String(args?.context || ''));
          break;
        case 'impact_of_change':
          result = await GraphToolsService.impactOfChange(tenantId, String(args?.policyId || ''));
          break;
        case 'who_knows_most':
          result = await GraphToolsService.whoKnowsMost(tenantId, String(args?.topic || ''));
          break;
        case 'shortest_path':
          result = await GraphToolsService.shortestPath(tenantId, String(args?.from || ''), String(args?.to || ''));
          break;
        case 'central_entities':
          result = await GraphToolsService.centralEntities(tenantId, Array.isArray(args?.labels) ? args.labels : undefined);
          break;
        case 'recent_decisions':
          result = await GraphToolsService.recentDecisions(tenantId, String(args?.entity || ''));
          break;
        case 'similar_decisions':
          result = {
            tool: 'similar_decisions',
            precedents: await PrecedentService.similar(
              tenantId,
              (Array.isArray(args?.terms) ? args.terms : [String(args?.terms ?? '')]).map(String),
              Number(args?.limit ?? 3)
            ),
          };
          break;
        case 'absence_check':
          result = {
            tool: 'absence_check',
            absence: await PrecedentService.absence(tenantId, {
              relationship: String(args?.relationship || ''),
              fromLabel: String(args?.fromLabel || ''),
              term: String(args?.term || ''),
            }),
          };
          break;
        default:
          res.status(400).json({ success: false, code: 'INVALID_SCHEMA', message: `Unknown tool '${tool}'` });
          return;
      }
      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      const e = errorCode(err);
      res.status(e.status).json({ success: false, code: e.code, message: err.message || 'Tool execution failed' });
    }
  }
}
