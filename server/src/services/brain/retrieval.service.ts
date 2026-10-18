import { runQuery, nodeProps, rankLinkedNodes } from '../../graph/graph.queries';
import { forTenant, GraphUnavailableError } from '../../graph/graph.client';
void GraphUnavailableError;
import { findEntityNodesByName } from '../../graph/graph.queries';
import { isNodeLabel } from '../../graph/graph.schema';
import { embedTexts, embedText } from './embeddings.service';
import { assembleTrace, newTraceId, traceToSentences, Trace } from './trace.service';
import { env } from '../../config/env';

/**
 * RetrievalService (FR-9 through FR-13) — graph-first Ask-the-Brain.
 *
 * Pipeline:
 *   1. Entity linking        — map question → graph entities
 *   2. Seed set              — vector search on Chunk.embedding + linked entities
 *   3. Graph expansion       — 1–2 hop Cypher over MENTIONS/GOVERNS/OWNS/...
 *   4. Currency filter       — exclude SUPERSEDED/expired unless asked
 *   5. Context assembly      — ordered facts with source chunks
 *   6. LLM synthesis         — answer strictly from retrieved context
 *   7. Trace assembly        — nodes/edges used, in order (Decision Trace)
 *
 * FR-10: if FalkorDB is unreachable this throws GraphUnavailableError — the
 * API returns GRAPH_UNAVAILABLE, it never silently falls back to SQL keywords.
 */

export interface BrainAnswer {
  answer: string;
  citations: Array<{
    documentId: string;
    documentTitle: string;
    sourceUrl?: string;
    chunkId: string;
    snippet: string;
    relevanceScore: number;
  }>;
  trace: Trace;
  traceSentences: string[];
  freshness: { usedSuperseded: boolean; newestSource: string | null };
  latencyMs: number;
  graphName: string;
}

export class RetrievalService {
  static async query(tenantId: string, query: string, opts: { log?: boolean } = {}): Promise<BrainAnswer> {
    const startTime = Date.now();
    const graph = await forTenant(tenantId); // throws GraphUnavailableError when down

    const tokens = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 12);

    // ---- 1. Entity linking (phrase matching inside the graph) ----
    const linkedNodes = rankLinkedNodes(
      await findEntityNodesByName(graph, ['Policy', 'System', 'Project', 'Person', 'Team', 'Customer'], query),
      query
    ).slice(0, 6);

    // ---- 2. Seed set: vector top-k (when index present) + fulltext fallback ----
    let seedChunks: Array<{ chunkId: string; text: string; documentId: string; score: number }> = [];
    let usedSuperseded = false;
    let vectorFailed = false;

    try {
      const embedding = await embedText(query);
      const vecRows = await runQuery(
        graph,
        `CALL db.idx.vector.queryNodes('Chunk', 'embedding', 8, vecf32($embedding))
         YIELD node, score
         RETURN node.id AS chunkId, node.text AS text, node.documentId AS documentId, score`,
        { embedding: embedding as any }
      );
      seedChunks = vecRows.map((r: any) => ({ chunkId: r.chunkId, text: r.text, documentId: r.documentId, score: Number(r.score) }));
    } catch (err: any) {
      vectorFailed = true;
    }

    if (vectorFailed || seedChunks.length === 0) {
      // Full-text fallback INSIDE FalkorDB (still Cypher, still graph-only)
      const orClauses = tokens.map((_, i) => `c.text CONTAINS $t${i}`).join(' OR ');
      try {
        const ftRows = await runQuery(
          graph,
          `MATCH (c:Chunk) WHERE ${orClauses || 'false'}
           MATCH (d:Document {id: c.documentId})
           WHERE d.status <> 'SUPERSEDED'
           RETURN c.id AS chunkId, c.text AS text, d.id AS documentId ITERATE 20 LIMIT 10`,
          Object.fromEntries(tokens.map((t, i) => [`t${i}`, t]))
        );
        seedChunks = ftRows.map((r: any) => ({
          chunkId: r.chunkId,
          text: r.text,
          documentId: r.documentId,
          score: 0.4,
        }));
      } catch {
        // simpler syntax for older engines
        const rows = await runQuery(
          graph,
          `MATCH (c:Chunk) WHERE c.text CONTAINS $t0 MATCH (d:Document {id: c.documentId}) WHERE d.status <> 'SUPERSEDED'
           RETURN c.id AS chunkId, c.text AS text, d.id AS documentId LIMIT 10`,
          { t0: tokens[0] || query }
        );
        seedChunks = rows.map((r: any) => ({ chunkId: r.chunkId, text: r.text, documentId: r.documentId, score: 0.4 }));
      }
    }

    // ---- 2b. Currency filter (FR-6/W2): the graph knows when a doc was
    // superseded — drop SUPERSEDED-doc chunks from the seed set when active
    // alternatives exist, keeping their titles as temporal context. ----
    let supersededContext: Array<{ id: string; title: string }> = [];
    {
      const docIds = [...new Set(seedChunks.map((c) => c.documentId).filter(Boolean))];
      if (docIds.length) {
        const statusRows = await runQuery(
          graph,
          `MATCH (d:Document) WHERE d.id IN $ids RETURN d.id AS id, d.title AS title, d.status AS status`,
          { ids: docIds }
        );
        const supersededIds = new Set(statusRows.filter((r: any) => r.status === 'SUPERSEDED').map((r: any) => r.id));
        supersededContext = statusRows.filter((r: any) => r.status === 'SUPERSEDED').map((r: any) => ({ id: r.id, title: r.title }));
        const active = seedChunks.filter((c) => !supersededIds.has(c.documentId));
        if (active.length) seedChunks = active;
      }
    }

    // ---- 3. Graph expansion around seeds + linked entities ----
    const traceNodes: any[] = [];
    const traceEdges: any[] = [];
    supersededContext.forEach((d) => traceNodes.push({ id: d.id, label: 'Document', name: `${d.title} (superseded, excluded)` }));
    const seedIds = seedChunks.map((c) => c.chunkId);
    const linkedIds = linkedNodes.map((r: any) => r.id).filter(Boolean);

    const expansionRows = await runQuery(
      graph,
      `MATCH (c:Chunk) WHERE c.id IN $seedIds
       MATCH (c)-[:PART_OF]->(d:Document)
       OPTIONAL MATCH (c)-[:MENTIONS]->(m)
       OPTIONAL MATCH (m)-[r2:OWNS|GOVERNS|REQUIRES|VALIDATES|IMPLEMENTS|DERIVED_FROM|APPROVES]->(t)
       RETURN c, d, m, r2, t LIMIT 40`,
      { seedIds: seedIds.length ? seedIds : ['__none__'] }
    );

    const documentIds = new Set<string>();
    expansionRows.forEach((row: any) => {
      const c = nodeProps(row.c);
      const d = nodeProps(row.d);
      const m = nodeProps(row.m);
      const t = nodeProps(row.t);
      if (!c?.id) return;

      if (!seedChunks.find((s) => s.chunkId === c.id)) {
        seedChunks.push({ chunkId: c.id, text: c.text || '', documentId: c.documentId || d.id || '', score: 0.3 });
      }
      if (d.id) documentIds.add(d.id);
      traceNodes.push({ id: c.id, label: 'Chunk', name: (c.text || '').slice(0, 60) });
      if (d.id) traceEdges.push({ from: c.id, to: d.id, type: 'PART_OF' });
      if (m.id) {
        traceNodes.push({ id: m.id, label: labelsOf(row.m)[0] ?? 'Entity', name: entityName(m, m.id) });
        traceEdges.push({ from: c.id, to: m.id, type: 'MENTIONS' });
      }
      if (m.id && t.id) {
        traceNodes.push({ id: t.id, label: labelsOf(row.t)[0] ?? 'Entity', name: entityName(t, t.id) });
        traceEdges.push({ from: m.id, to: t.id, type: row.r2?.label || row.r2?.type || 'RELATES' });
      }
    });

    // ---- documents for citations ----
    const docRows = documentIds.size
      ? await runQuery(
          graph,
          `MATCH (d:Document) WHERE d.id IN $ids RETURN d.id AS id, d.title AS title, d.sourceUrl AS sourceUrl, d.status AS status, d.validFrom AS validFrom`,
          { ids: [...documentIds] }
        )
      : [];
    const docsById = new Map(docRows.map((r: any) => [r.id, r]));
    docsById.forEach((d: any) => {
      traceNodes.push({ id: d.id, label: 'Document', name: d.title });
      if (d.status === 'SUPERSEDED') usedSuperseded = true;
    });

    linkedNodes.forEach((l: any) => {
      if (l.id) traceNodes.push({ id: l.id, label: l.label || 'Entity', name: l.name || l.id });
    });

    // Ownership + governance hops for linked entities — the path a reviewer reads
    // when they click "Why?": Person → OWNS → Policy → GOVERNS → System, Rule → IMPLEMENTS → Policy.
    const policyRows = linkedIds.length
      ? await runQuery(
          graph,
          `MATCH (e) WHERE e.id IN $ids
           OPTIONAL MATCH (who)-[:OWNS]->(e)
           OPTIONAL MATCH (e)-[g:GOVERNS|VALIDATES|REQUIRES]->(s)
           OPTIONAL MATCH (r:Rule)-[:IMPLEMENTS]->(e)
           RETURN e.id AS entityId, e.name AS name, labels(e)[0] AS label,
                  who.id AS ownerId, who.name AS ownerName,
                  s.id AS systemId, s.name AS governedSystem, type(g) AS relation,
                  r.id AS ruleId, r.ruleName AS ruleName`,
          { ids: linkedIds }
        )
      : [];
    policyRows.forEach((r: any) => {
      if (r.entityId) traceNodes.push({ id: r.entityId, label: r.label || 'Policy', name: r.name || r.entityId });
      if (r.ruleId) {
        traceNodes.push({ id: r.ruleId, label: 'Rule', name: r.ruleName || r.ruleId });
        traceEdges.push({ from: r.ruleId, to: r.entityId, type: 'IMPLEMENTS' });
      }
      if (r.ownerId) {
        traceNodes.push({ id: r.ownerId, label: 'Person', name: r.ownerName || r.ownerId });
        traceEdges.push({ from: r.ownerId, to: r.entityId, type: 'OWNS' });
      }
      if (r.systemId) {
        traceNodes.push({ id: r.systemId, label: 'System', name: r.governedSystem || r.systemId });
        traceEdges.push({ from: r.entityId, to: r.systemId, type: r.relation || 'GOVERNS' });
      }
    });

    // ---- 4+5. Context assembly ----
    const citations = seedChunks
      .filter((c) => c.text)
      .slice(0, 8)
      .map((c) => {
        const doc = docsById.get(c.documentId);
        return {
          documentId: c.documentId || '',
          documentTitle: doc?.title || 'Unknown document',
          sourceUrl: doc?.sourceUrl || undefined,
          chunkId: c.chunkId,
          snippet: c.text.length > 240 ? `${c.text.slice(0, 240)}...` : c.text,
          relevanceScore: Math.min(Number(c.score.toFixed(2)), 0.99),
        };
      });

    // ---- 6. Synthesis ----
    let answer: string;
    if (citations.length === 0 && policyRows.length === 0) {
      answer = `No matching knowledge in the company graph for "${query}". Ingest documents or load the demo company to populate the brain.`;
    } else if (env.OPENAI_API_KEY && citations.length > 0) {
      answer = await this.synthesize(query, citations, policyRows);
    } else {
      // No LLM: show the cited context verbatim (honest fallback per §13.3)
      answer = [
        `Based on the company knowledge graph:`,
        ...citations.slice(0, 3).map((c, i) => `[${i + 1}] ${c.documentTitle}: "${c.snippet}"`),
        policyRows.filter((p: any) => p.name).length
          ? `Linked entities: ${[...new Set(policyRows.filter((p: any) => p.name).map((p: any) => `${p.label} ${p.name}`))].slice(0, 5).join('; ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    }

    // Temporal context: name the superseded versions the graph excluded, so
    // "what did this replace?" questions stay answerable without citing stale text.
    if (supersededContext.length) {
      answer += `\n\nSuperseded versions (excluded as stale, kept for history): ${supersededContext.map((d) => d.title).join('; ')}.`;
    }

    // ---- 7. Trace ----
    seedIds.forEach((id) => {
      const c = seedChunks.find((s) => s.chunkId === id);
      if (c) traceNodes.unshift({ id, label: 'Chunk', name: c.text.slice(0, 50) });
    });
    const trace = assembleTrace(traceNodes, traceEdges, '/* exploratory Cypher pipeline over tenant graph, see /brain/trace */');

    // Without an LLM the quoted chunks alone don't say what the graph actually
    // knows, so surface the relation hops verbatim instead of paraphrasing them.
    if (!env.OPENAI_API_KEY) {
      const hopLines = traceToSentences(trace)
        .filter((s) => !s.includes('is part of →'))
        .slice(0, 6);
      if (hopLines.length) {
        answer += `\n\nGraph facts:\n${hopLines.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
      }
    }

    const queryLog = opts.log === false ? null : await prismaLog(tenantId, query, answer, citations, trace.traceId, Date.now() - startTime);

    const newestSource = citations.length ? (docRows.map((d: any) => d.validFrom).filter(Boolean).sort().pop() ?? null) : null;

    return {
      answer,
      citations,
      trace,
      traceSentences: traceToSentences(trace),
      freshness: { usedSuperseded, newestSource },
      latencyMs: Date.now() - startTime,
      graphName: await (async () => {
        const { tenantGraphName } = await import('../../graph/graph.client');
        return tenantGraphName(tenantId);
      })(),
      ...(queryLog ? {} : {}),
    };
  }

  /** LLM synthesis grounded ONLY in retrieved graph context (FR-9 step 6). */
  private static async synthesize(query: string, citations: any[], policyRows: any[]): Promise<string> {
    try {
      const axios = (await import('axios')).default;
      const context = citations.map((c, i) => `[[doc ${i + 1} | chunk ${c.chunkId}] ${c.documentTitle}]\n${c.snippet}`).join('\n\n');
      const entityContext = policyRows
        .filter((p: any) => p.name)
        .slice(0, 6)
        .map((p: any) => {
          const bits = [`${p.label} ${p.name}`];
          if (p.governedSystem) bits.push(`governs ${p.governedSystem}`);
          if (p.ruleName) bits.push(`implemented by rule ${p.ruleName}`);
          return `• ${bits.join(' | ')}`;
        })
        .join('\n');
      const res = await axios.post(
        `${env.OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions`,
        {
          model: env.OPENAI_MODEL,
          messages: [
            {
              role: 'system',
              content:
                'You are the Neutronz Company Brain. Answer strictly grounded in the provided graph context and document chunks. Cite chunk ids like [chunk <id>] when using a fact. Do not invent facts.',
            },
            { role: 'user', content: `Entities and relations from the knowledge graph:\n${entityContext || '(none)'}\n\nDocument chunks:\n${context}\n\nQuestion: ${query}` },
          ],
          temperature: 0.2,
        },
        { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      return res.data?.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      console.warn('LLM synthesis notice (falling back to cited context):', err?.message || err);
      return `Based on the company knowledge graph:\n\n${citations
        .slice(0, 3)
        .map((c, i) => `[${i + 1}] ${c.documentTitle}: "${c.snippet}"`)
        .join('\n\n')}`;
    }
  }
}

function labelsOf(node: any): string[] {
  return Array.isArray(node?.labels) ? node.labels : [];
}

function entityName(props: Record<string, any>, fallback: string): string {
  return props?.name || props?.title || props?.ruleName || props?.policyName || fallback;
}

async function prismaLog(
  userId: string,
  query: string,
  answer: string,
  citations: any[],
  traceId: string,
  latencyMs: number
): Promise<string | null> {
  try {
    const { prisma } = await import('../../db/client');
    const log = await prisma.brainQueryLog.create({
      data: { userId, query, answer, citations: citations as any, traceId, latencyMs },
    });
    return log.id;
  } catch (err: any) {
    // Synthetic tenant ids (tests, MCP demos) have no matching users row; the
    // graph answer itself is unaffected, so keep the noise to one line.
    console.warn(`query log skipped: ${err?.code ?? err?.message ?? 'unknown'}`);
    return null;
  }
}

export { GraphUnavailableError, isNodeLabel, newTraceId, traceToSentences };
