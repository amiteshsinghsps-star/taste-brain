import { forTenant } from '../../graph/graph.client';
import { runQuery } from '../../graph/graph.queries';
import { RetrievalService } from './retrieval.service';
import { embedTexts } from './embeddings.service';
import { env } from '../../config/env';

/**
 * Graph-vs-RAG evaluation (PRD v3 W2) — measured evidence that the graph
 * matters, not a claim.
 *
 * Two systems, same chunks, same LLM, same temperature:
 *  • Baseline-RAG: top-5 similar chunks (vector/full-text inside FalkorDB) →
 *    synthesize. No entity linking, no graph expansion, no currency filter.
 *  • Neutronz: full graph-first pipeline (RetrievalService) with trace.
 *
 * Scoring is deterministic (no LLM judge): entity recall (string match in
 * answer), source recall (expected chunk ids cited), citation validity
 * (cited ⊆ retrieved), currency (forbidden/superseded chunk cited → 0).
 */

export interface GoldenQuestion {
  id: string;
  category: 'ownership' | 'impact' | 'temporal' | 'provenance';
  text: string;
  expectedEntities: string[];
  expectedChunkIds: string[];
  forbiddenChunkIds: string[];
}

export interface Scored {
  entityRecall: number;
  sourceRecall: number;
  citationValidity: number;
  currency: number;
  hasTrace: boolean;
  latencyMs: number;
}

export interface CompareResult {
  question: string;
  baseline: { answer: string; citations: any[]; latencyMs: number; score: Scored };
  neutronz: { answer: string; citations: any[]; latencyMs: number; score: Scored; trace?: any };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function scoreSystem(q: GoldenQuestion, answer: string, citedChunkIds: string[], retrievedChunkIds: string[], hasTrace: boolean, latencyMs: number): Scored {
  const answerNorm = norm(answer);
  const entityHits = q.expectedEntities.filter((e) => answerNorm.includes(norm(e))).length;
  const entityRecall = q.expectedEntities.length ? entityHits / q.expectedEntities.length : 1;
  const sourceHits = q.expectedChunkIds.filter((c) => citedChunkIds.includes(c)).length;
  const sourceRecall = q.expectedChunkIds.length ? sourceHits / q.expectedChunkIds.length : 1;
  const invalidCitations = citedChunkIds.filter((c) => !retrievedChunkIds.includes(c)).length;
  const citationValidity = citedChunkIds.length ? (citedChunkIds.length - invalidCitations) / citedChunkIds.length : 1;
  const currency = q.forbiddenChunkIds.some((c) => citedChunkIds.includes(c)) ? 0 : 1;
  return { entityRecall, sourceRecall, citationValidity, currency, hasTrace, latencyMs };
}

/** Plain RAG baseline: similar chunks only — deliberately no graph expansion. */
export async function baselineRag(tenantId: string, query: string): Promise<{ answer: string; citations: any[]; retrieved: string[]; latencyMs: number }> {
  const start = Date.now();
  const graph = await forTenant(tenantId);
  let retrieved: Array<{ chunkId: string; text: string; documentId: string; score: number }> = [];

  try {
    const { vectors } = await embedTexts([query]);
    const embedding = vectors[0];
    const vecRows = await runQuery(
      graph,
      `CALL db.idx.vector.queryNodes('Chunk', 'embedding', 5, vecf32($embedding)) YIELD node, score
       RETURN node.id AS chunkId, node.text AS text, node.documentId AS documentId, score`,
      { embedding: embedding as any }
    );
    retrieved = vecRows.map((r: any) => ({ chunkId: r.chunkId, text: r.text, documentId: r.documentId, score: Number(r.score) }));
  } catch {
    // full-text fallback, still top-5, still no graph expansion
    const tokens = query.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
    const clauses = tokens.map((_, i) => `c.text CONTAINS $t${i}`).join(' OR ');
    const rows = await runQuery(
      graph,
      `MATCH (c:Chunk) WHERE ${clauses || 'false'} RETURN c.id AS chunkId, c.text AS text, c.documentId AS documentId LIMIT 5`,
      Object.fromEntries(tokens.map((t, i) => [`t${i}`, t]))
    );
    retrieved = rows.map((r: any) => ({ ...r, score: 0.4 }));
  }

  const docIds = [...new Set(retrieved.map((c) => c.documentId).filter(Boolean))];
  const docRows = docIds.length
    ? await runQuery(graph, `MATCH (d:Document) WHERE d.id IN $ids RETURN d.id AS id, d.title AS title, d.status AS status`, { ids: docIds })
    : [];
  const docsById = new Map(docRows.map((r: any) => [r.id, r]));

  const citations = retrieved.map((c) => ({
    documentId: c.documentId,
    documentTitle: docsById.get(c.documentId)?.title || 'Unknown document',
    chunkId: c.chunkId,
    snippet: c.text.length > 240 ? `${c.text.slice(0, 240)}...` : c.text,
    relevanceScore: Math.min(Number(c.score.toFixed(2)), 0.99),
  }));

  let answer: string;
  if (env.OPENAI_API_KEY && citations.length) {
    try {
      const axios = (await import('axios')).default;
      const context = citations.map((c, i) => `[[doc ${i + 1} | chunk ${c.chunkId}] ${c.documentTitle}]\n${c.snippet}`).join('\n\n');
      const res = await axios.post(
        `${env.OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions`,
        {
          model: env.OPENAI_MODEL,
          messages: [
            { role: 'system', content: 'Answer strictly from the provided document chunks. Cite chunk ids like [chunk <id>]. If the chunks do not contain the answer, say so.' },
            { role: 'user', content: `Document chunks:\n${context}\n\nQuestion: ${query}` },
          ],
          temperature: 0,
        },
        { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      answer = res.data?.choices?.[0]?.message?.content || '';
    } catch {
      answer = '';
    }
  } else {
    answer = '';
  }
  if (!answer) {
    answer = citations.length
      ? `Based on retrieved documents:\n\n${citations.slice(0, 3).map((c, i) => `[${i + 1}] ${c.documentTitle}: "${c.snippet}"`).join('\n\n')}`
      : 'No relevant documents retrieved.';
  }

  return { answer, citations, retrieved: retrieved.map((c) => c.chunkId), latencyMs: Date.now() - start };
}

/** Runs both systems on one question with deterministic scoring. */
export async function compareQuestion(tenantId: string, q: GoldenQuestion): Promise<CompareResult> {
  const baseline = await baselineRag(tenantId, q.text);
  const neutronz = await RetrievalService.query(tenantId, q.text, { log: false });

  const baselineScore = scoreSystem(q, baseline.answer, baseline.citations.map((c) => c.chunkId), baseline.retrieved, false, baseline.latencyMs);
  const neutronzScore = scoreSystem(q, neutronz.answer, neutronz.citations.map((c: any) => c.chunkId), neutronz.citations.map((c: any) => c.chunkId), true, neutronz.latencyMs);

  return {
    question: q.text,
    baseline: { answer: baseline.answer, citations: baseline.citations, latencyMs: baseline.latencyMs, score: baselineScore },
    neutronz: { answer: neutronz.answer, citations: neutronz.citations, latencyMs: neutronz.latencyMs, score: neutronzScore, trace: neutronz.trace },
  };
}

export function aggregate(rows: Array<{ baseline: Scored; neutronz: Scored; category: string }>) {
  const byCat = new Map<string, { n: number; b: { entity: number; source: number; validity: number; currency: number }; g: { entity: number; source: number; validity: number; currency: number } }>();
  const overall = { n: 0, b: { entity: 0, source: 0, validity: 0, currency: 0 }, g: { entity: 0, source: 0, validity: 0, currency: 0 } };
  for (const r of rows) {
    const acc = byCat.get(r.category) ?? { n: 0, b: { entity: 0, source: 0, validity: 0, currency: 0 }, g: { entity: 0, source: 0, validity: 0, currency: 0 } };
    acc.n++; overall.n++;
    acc.b.entity += r.baseline.entityRecall; acc.b.source += r.baseline.sourceRecall; acc.b.validity += r.baseline.citationValidity; acc.b.currency += r.baseline.currency;
    acc.g.entity += r.neutronz.entityRecall; acc.g.source += r.neutronz.sourceRecall; acc.g.validity += r.neutronz.citationValidity; acc.g.currency += r.neutronz.currency;
    overall.b.entity += r.baseline.entityRecall; overall.b.source += r.baseline.sourceRecall; overall.b.validity += r.baseline.citationValidity; overall.b.currency += r.baseline.currency;
    overall.g.entity += r.neutronz.entityRecall; overall.g.source += r.neutronz.sourceRecall; overall.g.validity += r.neutronz.citationValidity; overall.g.currency += r.neutronz.currency;
    byCat.set(r.category, acc);
  }
  const div = (v: number, n: number) => (n ? Number((v / n).toFixed(2)) : 0);
  const categories = [...byCat.entries()].map(([category, a]) => ({
    category,
    n: a.n,
    baseline: { entityRecall: div(a.b.entity, a.n), sourceRecall: div(a.b.source, a.n), citationValidity: div(a.b.validity, a.n), currency: div(a.b.currency, a.n) },
    neutronz: { entityRecall: div(a.g.entity, a.n), sourceRecall: div(a.g.source, a.n), citationValidity: div(a.g.validity, a.n), currency: div(a.g.currency, a.n) },
  }));
  return {
    n: overall.n,
    baseline: { entityRecall: div(overall.b.entity, overall.n), sourceRecall: div(overall.b.source, overall.n), citationValidity: div(overall.b.validity, overall.n), currency: div(overall.b.currency, overall.n) },
    neutronz: { entityRecall: div(overall.g.entity, overall.n), sourceRecall: div(overall.g.source, overall.n), citationValidity: div(overall.g.validity, overall.n), currency: div(overall.g.currency, overall.n) },
    categories,
  };
}
