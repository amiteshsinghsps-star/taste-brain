import crypto from 'crypto';
import { forTenant } from '../../graph/graph.client';
import { runQuery, mergeNode } from '../../graph/graph.queries';

/**
 * Pinned brain queries — per tenant, stored as `SavedQuery` nodes in the same
 * FalkorDB graph as everything else (so tenant isolation is the graph's, not an
 * extra WHERE clause someone can forget).
 */

export interface SavedQueryRow {
  id: string;
  question: string;
  snippet: string;
  traceId: string | null;
  createdAt: string;
}

export class SavedQueryService {
  static async list(tenantId: string, limit = 25): Promise<SavedQueryRow[]> {
    const graph = await forTenant(tenantId);
    const cap = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const rows = await runQuery(
      graph,
      `MATCH (s:SavedQuery)
       RETURN s.id AS id, s.question AS question, s.snippet AS snippet, s.traceId AS traceId, s.createdAt AS createdAt
       ORDER BY s.createdAt DESC LIMIT $cap`,
      { cap }
    );
    return rows.map((r: any) => ({
      id: String(r.id),
      question: String(r.question ?? ''),
      snippet: String(r.snippet ?? ''),
      traceId: r.traceId ? String(r.traceId) : null,
      createdAt: String(r.createdAt ?? ''),
    }));
  }

  static async save(
    tenantId: string,
    input: { question: unknown; snippet?: unknown; traceId?: unknown },
    actor: string
  ): Promise<SavedQueryRow> {
    const question = String(input.question ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 500);
    if (!question) throw new Error('question is required');

    const graph = await forTenant(tenantId);
    const existing = await runQuery(graph, `MATCH (s:SavedQuery {question: $question}) RETURN s.id AS id LIMIT 1`, { question });
    if (existing.length) {
      const rows = await SavedQueryService.list(tenantId, 100);
      const found = rows.find((r) => r.id === String(existing[0].id));
      if (found) return found;
    }

    const id = `saved_${crypto.randomUUID().slice(0, 12)}`;
    const createdAt = new Date().toISOString();
    await mergeNode(graph, 'SavedQuery', id, {
      question,
      snippet: String(input.snippet ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 400),
      traceId: String(input.traceId ?? '').slice(0, 120),
      savedBy: String(actor ?? '').slice(0, 160),
      createdAt,
      demoSeed: 'false',
    });
    return { id, question, snippet: String(input.snippet ?? '').slice(0, 400), traceId: String(input.traceId ?? '') || null, createdAt };
  }

  static async remove(tenantId: string, savedId: string): Promise<boolean> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(graph, `MATCH (s:SavedQuery {id: $id}) DETACH DELETE s RETURN s.id AS id`, { id: String(savedId || '') });
    return rows.length > 0;
  }
}
