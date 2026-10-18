import crypto from 'crypto';
import { prisma } from '../../db/client';

/**
 * Decision Trace service (FR-11, FR-12, Epic C).
 *
 * Every answer and agent action ships with a trace: the ordered graph path
 * (nodes + edges), the cited source chunks, and the exact Cypher used. Stored
 * in memory (cap) for instant fetch, and mirrored onto BrainQueryLog in SQL for
 * durability.
 */

export interface TraceNode {
  id: string;
  label: string;
  name: string;
}

export interface TraceEdge {
  from: string;
  to: string;
  type: string;
}

export interface Trace {
  traceId: string;
  nodes: TraceNode[];
  edges: TraceEdge[];
  cypher?: string;
  summary?: string;
}

const MAX_TRACES = 500;
const store = new Map<string, Trace>();

export function newTraceId(): string {
  return crypto.randomUUID();
}

export function saveTrace(trace: Trace): void {
  store.set(trace.traceId, trace);
  if (store.size > MAX_TRACES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
}

export function getTrace(traceId: string): Trace | null {
  return store.get(traceId) ?? null;
}

/**
 * Hops are ordered by meaning, not insertion: the reasoning a reviewer follows
 * (rule → policy → owner) comes before bulk provenance (chunk → document).
 */
const EDGE_RANK: Record<string, number> = {
  TRIGGERED: 0,
  FLAGGED_BY: 0,
  PERFORMED: 1,
  DECIDED: 1,
  IMPLEMENTS: 2,
  DERIVED_FROM: 2,
  OWNS: 3,
  OWNER_OF: 3,
  APPROVES: 3,
  GOVERNS: 4,
  VALIDATES: 4,
  REQUIRES: 4,
  SUPERSEDES: 5,
  KNOWS_ABOUT: 5,
  ABOUT: 6,
  HANDED_OFF_TO: 6,
  MENTIONS: 7,
  AUTHORED: 8,
  PART_OF: 9,
};

/** Dedups nodes/edges while ordering hops by significance. */
export function assembleTrace(
  rawNodes: TraceNode[],
  rawEdges: TraceEdge[],
  cypher?: string,
  summary?: string
): Trace {
  const nodeById = new Map<string, TraceNode>();
  rawNodes.forEach((n) => {
    if (n?.id && !nodeById.has(n.id)) nodeById.set(n.id, n);
  });
  const edgeKey = (e: TraceEdge) => `${e.from}|${e.to}|${e.type}`;
  const ordered: TraceEdge[] = [];
  const seen = new Set<string>();
  rawEdges.forEach((e) => {
    const k = edgeKey(e);
    if (!seen.has(k)) {
      seen.add(k);
      ordered.push(e);
    }
  });
  const edges = ordered
    .map((e, index) => ({ e, index }))
    .sort((a, b) => (EDGE_RANK[a.e.type] ?? 10) - (EDGE_RANK[b.e.type] ?? 10) || a.index - b.index)
    .map((x) => x.e);

  // Nodes follow hop order so the UI animation walks the reasoning path first.
  const orderedNodeIds: string[] = [];
  const pushed = new Set<string>();
  edges.forEach((e) => {
    if (nodeById.has(e.from) && !pushed.has(e.from)) {
      pushed.add(e.from);
      orderedNodeIds.push(e.from);
    }
    if (nodeById.has(e.to) && !pushed.has(e.to)) {
      pushed.add(e.to);
      orderedNodeIds.push(e.to);
    }
  });
  nodeById.forEach((_n, id) => {
    if (!pushed.has(id)) orderedNodeIds.push(id);
  });

  const trace: Trace = {
    traceId: newTraceId(),
    nodes: orderedNodeIds.map((id) => nodeById.get(id)!),
    edges,
    cypher,
    summary,
  };
  saveTrace(trace);
  return trace;
}

/** Human-readable hop sentences for the UI side panel (§13.2). */
export function traceToSentences(trace: Trace): string[] {
  const nameOf = (id: string) => {
    const n = trace.nodes.find((x) => x.id === id);
    return n ? `${n.label} "${n.name}"` : id;
  };
  const sentences = trace.edges.map((e: any) => {
    const relCopy: Record<string, string> = {      OWNER_OF: 'owns',
      OWNS: 'owns',
      GOVERNS: 'governs',
      IMPLEMENTS: 'implements',
      DERIVED_FROM: 'derived from',
      TRIGGERED: 'triggered by',
      PERFORMED: 'performed',
      DECIDED: 'decided',
      SUPERSEDES: 'supersedes',
      PART_OF: 'is part of',
      AUTHORED: 'authored',
      MENTIONS: 'mentions',
      ABOUT: 'is about',
      APPROVES: 'approved by',
      HANDED_OFF_TO: 'handed off to',
      REMEMBERS: 'remembers',
      MEMBER_OF: 'is member of',
      VALIDATES: 'validates',
      REQUIRES: 'requires',
      FLAGGED_BY: 'was flagged by',
      KNOWS_ABOUT: 'has expertise on',
    };
    return `${nameOf(e.from)} → ${relCopy[e.type] || e.type} → ${nameOf(e.to)}`;
  });
  // The same relation can exist between two copies of an entity (rule v1/v2);
  // a reviewer only needs to read it once.
  return [...new Set(sentences)];
}

export async function attachTraceToLog(queryLogId: string, traceId: string): Promise<void> {
  try {
    await prisma.brainQueryLog.update({
      where: { id: queryLogId },
      data: ({ traceId } as any),
    });
  } catch (err) {
    // Trace persistence is best-effort; the in-memory + response copy is primary.
    console.warn('trace persistence notice:', err);
  }
}
