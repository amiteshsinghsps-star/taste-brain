import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { InsightsService } from '../services/brain/insights.service';
import { ExportService } from '../services/brain/export.service';
import { GraphUnavailableError } from '../graph/graph.client';

/** Read-only graph insights (v4): path finder, rule diff, timeline, handoffs, explain, digest, export. */
function fail(res: Response, err: any, fallback: string): void {
  if (err instanceof GraphUnavailableError || err?.code === 'GRAPH_UNAVAILABLE') {
    res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: 'FalkorDB not reachable — these insights read the tenant graph directly.' });
    return;
  }
  const message = String(err?.message || fallback);
  const status = /required|at least|characters|must be/i.test(message) ? 400 : 500;
  res.status(status).json({ success: false, code: status === 400 ? 'INVALID_INPUT' : 'INSIGHT_FAILED', message });
}

function text(value: unknown, max = 200): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

export class InsightsController {
  static async connectionPath(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const from = text(req.query.from);
      const to = text(req.query.to);
      if (!from || !to) {
        res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'from and to query parameters are both required' });
        return;
      }
      const result = await InsightsService.connectionPath(req.user!.userId, from, to, req.query.hops ? Number(req.query.hops) : 5);
      res.status(200).json({ success: true, path: result });
    } catch (err: any) {
      fail(res, err, 'Path lookup failed');
    }
  }

  static async ruleVersions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await InsightsService.ruleVersionDiff(req.user!.userId, text(req.params.ruleId, 160));
      if (!result) {
        res.status(404).json({ success: false, code: 'RULE_NOT_FOUND', message: 'Rule not found in this tenant graph' });
        return;
      }
      res.status(200).json({ success: true, ...result });
    } catch (err: any) {
      fail(res, err, 'Rule version diff failed');
    }
  }

  static async timeline(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const subject = text(req.query.subject, 200);
      if (!subject) {
        res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'subject query parameter required (e.g. BK-1042 or "credit limit")' });
        return;
      }
      const result = await InsightsService.decisionTimeline(req.user!.userId, subject);
      res.status(200).json({ success: true, subject, ...result });
    } catch (err: any) {
      fail(res, err, 'Timeline failed');
    }
  }

  static async handoffs(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const board = await InsightsService.handoffBoard(req.user!.userId);
      res.status(200).json({ success: true, ...board });
    } catch (err: any) {
      fail(res, err, 'Handoff board failed');
    }
  }

  static async explain(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const explanation = await InsightsService.explainNode(req.user!.userId, text(req.params.id, 200));
      if (!explanation) {
        res.status(404).json({ success: false, code: 'NODE_NOT_FOUND', message: 'Node not found in this tenant graph' });
        return;
      }
      res.status(200).json({ success: true, explanation });
    } catch (err: any) {
      fail(res, err, 'Node explanation failed');
    }
  }

  static async digest(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const days = req.query.days ? Number(req.query.days) : 30;
      const digest = await InsightsService.freshnessDigest(req.user!.userId, days);
      res.status(200).json({ success: true, digest });
    } catch (err: any) {
      fail(res, err, 'Freshness digest failed');
    }
  }

  static async exportGraph(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const format = text(req.query.format, 12) || 'json';
      const out = await ExportService.export(req.user!.userId, format);
      res.setHeader('Content-Type', out.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
      res.status(200).send(out.body);
    } catch (err: any) {
      fail(res, err, 'Graph export failed');
    }
  }
}
