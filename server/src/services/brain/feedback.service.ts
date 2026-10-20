import crypto from 'crypto';
import { forTenant } from '../../graph/graph.client';
import { runQuery, mergeNode, mergeRelation } from '../../graph/graph.queries';

/**
 * Answer feedback (thumbs up/down on a brain answer) stored as graph nodes.
 *
 * It is not a Postgres counter table: each rating becomes a `Feedback` node
 * linked with `ABOUT` edges to the exact `Chunk` nodes the answer cited, so the
 * Knowledge Health report can deduct score from the source that actually earned
 * the complaint (a cited chunk with a thumbs-down and no thumbs-up).
 */

export type FeedbackVerdict = 'UP' | 'DOWN';

export interface FeedbackInput {
  question: string;
  verdict: FeedbackVerdict;
  comment?: string;
  traceId?: string;
  chunkIds?: string[];
  answerSnippet?: string;
  givenBy?: string;
}

export interface RecordedFeedback {
  id: string;
  at: string;
  verdict: FeedbackVerdict;
  question: string;
  comment: string;
  linkedChunks: string[];
  givenBy: string;
}

const MAX_QUESTION = 500;
const MAX_COMMENT = 1000;

/** Chunk ids are only ever used as a parameter value, never as an identifier. */
function cleanIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map((x) => String(x ?? '').trim()).filter((x) => x.length > 0 && x.length <= 200))].slice(0, 25);
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);
}

export class FeedbackService {
  static async record(tenantId: string, input: FeedbackInput): Promise<RecordedFeedback> {
    const question = cleanText(input.question, MAX_QUESTION);
    if (!question) throw new Error('question is required');
    const verdict = String(input.verdict || '').toUpperCase();
    if (verdict !== 'UP' && verdict !== 'DOWN') throw new Error("verdict must be 'UP' or 'DOWN'");

    const graph = await forTenant(tenantId);
    const id = `feedback_${crypto.randomUUID().slice(0, 12)}`;
    const at = new Date().toISOString();
    const comment = cleanText(input.comment, MAX_COMMENT);
    const givenBy = cleanText(input.givenBy, 160);
    const chunkIds = cleanIds(input.chunkIds);

    await mergeNode(graph, 'Feedback', id, {
      question,
      verdict,
      comment,
      traceId: cleanText(input.traceId, 120),
      answerSnippet: cleanText(input.answerSnippet, 600),
      givenBy,
      at,
      demoSeed: 'false',
    });

    const linked: string[] = [];
    for (const chunkId of chunkIds) {
      const exists = await runQuery(graph, `MATCH (c:Chunk {id: $chunkId}) RETURN c.id AS id LIMIT 1`, { chunkId });
      if (!exists.length) continue;
      await mergeRelation(graph, 'Feedback', id, 'Chunk', chunkId, 'ABOUT');
      linked.push(chunkId);
    }

    return { id, at, verdict: verdict as FeedbackVerdict, question, comment, linkedChunks: linked, givenBy };
  }

  static async list(tenantId: string, limit = 30): Promise<RecordedFeedback[]> {
    const graph = await forTenant(tenantId);
    const cap = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const rows = await runQuery(
      graph,
      `MATCH (f:Feedback)
       OPTIONAL MATCH (f)-[:ABOUT]->(c:Chunk)
       WITH f, collect(c.id) AS chunkIds
       RETURN f.id AS id, f.at AS at, f.verdict AS verdict, f.question AS question,
              f.comment AS comment, f.givenBy AS givenBy, chunkIds
       ORDER BY f.at DESC LIMIT $cap`,
      { cap }
    );
    return rows.map((r: any) => ({
      id: String(r.id),
      at: r.at ?? '',
      verdict: String(r.verdict) === 'DOWN' ? 'DOWN' : 'UP',
      question: String(r.question ?? ''),
      comment: String(r.comment ?? ''),
      linkedChunks: (r.chunkIds || []).filter(Boolean),
      givenBy: String(r.givenBy ?? ''),
    }));
  }

  static async counts(tenantId: string): Promise<{ up: number; down: number; linked: number }> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (f:Feedback)
       RETURN sum(CASE WHEN f.verdict = 'UP' THEN 1 ELSE 0 END) AS up,
              sum(CASE WHEN f.verdict = 'DOWN' THEN 1 ELSE 0 END) AS down,
              count(f) AS total`,
      {}
    );
    const linked = await runQuery(graph, `MATCH (f:Feedback)-[:ABOUT]->(c:Chunk) RETURN count(f) AS c`, {});
    return {
      up: Number(rows[0]?.up ?? 0),
      down: Number(rows[0]?.down ?? 0),
      linked: Number(linked[0]?.c ?? 0),
    };
  }

  /**
   * Cited chunks that earned at least one thumbs-down and no thumbs-up. This is
   * the input Knowledge Health turns into a finding; the negative case matters
   * more than the positive one because a 👍 confirms what is already cited.
   */
  static async dislikedSources(tenantId: string): Promise<Array<{ chunkId: string; documentTitle: string; downs: number; ups: number; text: string }>> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (f:Feedback)-[:ABOUT]->(c:Chunk)
       WITH c, sum(CASE WHEN f.verdict = 'DOWN' THEN 1 ELSE 0 END) AS downs,
                sum(CASE WHEN f.verdict = 'UP' THEN 1 ELSE 0 END) AS ups
       WHERE downs > 0 AND ups = 0
       OPTIONAL MATCH (c)-[:PART_OF]->(d:Document)
       RETURN c.id AS chunkId, d.title AS documentTitle, downs, ups, c.text AS text
       ORDER BY downs DESC LIMIT 25`,
      {}
    );
    return rows.map((r: any) => ({
      chunkId: String(r.chunkId),
      documentTitle: String(r.documentTitle ?? 'unknown document'),
      downs: Number(r.downs ?? 0),
      ups: Number(r.ups ?? 0),
      text: String(r.text ?? '').slice(0, 220),
    }));
  }
}
