import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { FeedbackService } from '../services/brain/feedback.service';
import { WatchlistService } from '../services/brain/watchlist.service';
import { SavedQueryService } from '../services/brain/saved-query.service';
import { LedgerService } from '../services/brain/ledger.service';
import { GraphUnavailableError } from '../graph/graph.client';

/**
 * Tenant curation writes (v4): answer feedback, own watchlist entries, pinned
 * queries. Every one of these writes into the caller's own tenant graph, with
 * the graph name derived from the JWT and the values passed as Cypher params.
 */
function fail(res: Response, err: any, fallback: string): void {
  if (err instanceof GraphUnavailableError || err?.code === 'GRAPH_UNAVAILABLE') {
    res.status(503).json({ success: false, code: 'GRAPH_UNAVAILABLE', message: 'FalkorDB not reachable — writes require the tenant graph.' });
    return;
  }
  const message = String(err?.message || fallback);
  const status = /required|must be|at least|characters|verdict/i.test(message) ? 400 : 500;
  res.status(status).json({ success: false, code: status === 400 ? 'INVALID_INPUT' : 'WRITE_FAILED', message });
}

export class CurationController {
  static async recordFeedback(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const feedback = await FeedbackService.record(
        req.user!.userId,
        {
          question: body.question,
          verdict: String(body.verdict || '').toUpperCase() as any,
          comment: body.comment,
          traceId: body.traceId,
          chunkIds: Array.isArray(body.chunkIds) ? body.chunkIds : [],
          answerSnippet: body.answerSnippet,
          givenBy: req.user!.email,
        }
      );
      res.status(201).json({ success: true, feedback });
    } catch (err: any) {
      fail(res, err, 'Failed to record feedback');
    }
  }

  static async listFeedback(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const items = await FeedbackService.list(req.user!.userId);
      const counts = await FeedbackService.counts(req.user!.userId);
      res.status(200).json({ success: true, count: items.length, counts, items });
    } catch (err: any) {
      fail(res, err, 'Failed to list feedback');
    }
  }

  static async listWatchlist(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const entries = await WatchlistService.list(req.user!.userId);
      res.status(200).json({
        success: true,
        count: entries.length,
        entries,
        custom: entries.filter((e) => e.demoSeed !== 'true').length,
        seeded: entries.filter((e) => e.demoSeed === 'true').length,
      });
    } catch (err: any) {
      fail(res, err, 'Failed to list watchlist');
    }
  }

  static async addWatchlistEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const actor = req.user!.email || 'tenant operator';
      const { entry, alreadyPresent, preview } = await WatchlistService.add(req.user!.userId, req.body || {}, actor);
      if (!alreadyPresent) {
        // Screening inputs are consequential, so the write is chained in the ledger.
        await LedgerService.append({
          tenantId: req.user!.userId,
          actor,
          kind: 'WATCHLIST_ENTRY_ADDED',
          subjectId: entry.id,
          payload: { name: entry.name, list: entry.list ?? '', wouldFlag: preview.wouldFlag.length },
        });
      }
      res.status(alreadyPresent ? 200 : 201).json({ success: true, alreadyPresent, entry, preview });
    } catch (err: any) {
      fail(res, err, 'Failed to add watchlist entry');
    }
  }

  static async removeWatchlistEntry(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const result = await WatchlistService.remove(req.user!.userId, String(req.params.id || ''));
      if (result.removed) {
        await LedgerService.append({
          tenantId: req.user!.userId,
          actor: req.user!.email || 'tenant operator',
          kind: 'WATCHLIST_ENTRY_REMOVED',
          subjectId: String(req.params.id || ''),
          payload: { removed: true },
        });
      }
      const status = result.removed ? 200 : result.reason?.startsWith('Seeded') ? 409 : 404;
      res.status(status).json({ success: result.removed, ...result });
    } catch (err: any) {
      fail(res, err, 'Failed to remove watchlist entry');
    }
  }

  static async previewWatchlist(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const name = String(req.query.name || '');
      const preview = await WatchlistService.previewScreening(req.user!.userId, name);
      res.status(200).json({ success: true, preview });
    } catch (err: any) {
      fail(res, err, 'Screening preview failed');
    }
  }

  static async listSaved(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const items = await SavedQueryService.list(req.user!.userId);
      res.status(200).json({ success: true, count: items.length, items });
    } catch (err: any) {
      fail(res, err, 'Failed to list saved queries');
    }
  }

  static async saveQuery(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const saved = await SavedQueryService.save(req.user!.userId, req.body || {}, req.user!.email || '');
      res.status(201).json({ success: true, saved });
    } catch (err: any) {
      fail(res, err, 'Failed to save query');
    }
  }

  static async removeSaved(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const removed = await SavedQueryService.remove(req.user!.userId, String(req.params.id || ''));
      res.status(removed ? 200 : 404).json({ success: removed, id: req.params.id });
    } catch (err: any) {
      fail(res, err, 'Failed to remove saved query');
    }
  }
}
