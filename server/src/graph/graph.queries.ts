import { Graph } from 'falkordb';
import { normalizeName } from './graph.schema';

/**
 * Parameterized Cypher helper library (PRD §10.2, §12.2).
 * NEVER string-concatenate user input into Cypher — everything flows through
 * `params`. Labels and relationship types reaching these helpers must already
 * be validated against the allow-lists in graph.schema.ts.
 */

export type CypherRow = Record<string, any>;

export async function runQuery(
  graph: Graph,
  cypher: string,
  params: Record<string, any> = {}
): Promise<any[]> {
  const res = await graph.query(cypher, { params });
  return (res.data as any[]) || [];
}

/**
 * FalkorDB returns a whole node as { id, labels, properties } when you RETURN it;
 * this flattens it to the property bag so callers can read `status` etc. directly.
 */
export function nodeProps<T = Record<string, any>>(node: any): T {
  if (!node) return {} as T;
  return (node.properties ?? node) as T;
}

/**
 * Idempotent node upsert: MERGE on stable id within the tenant graph.
 */
export async function mergeNode(
  graph: Graph,
  label: string,
  id: string,
  props: Record<string, any>
): Promise<CypherRow> {
  const paramKeys = Object.keys(props).map((k) => k.replace(/[^a-zA-Z0-9_]/g, '_'));
  const setClause = paramKeys.map((k) => `n.${k} = $set_${k}`).join(', ');
  const params: Record<string, any> = { id };
  Object.keys(props).forEach((k) => {
    params[`set_${k.replace(/[^a-zA-Z0-9_]/g, '_')}`] = props[k];
  });
  const rows = await runQuery(
    graph,
    `MERGE (n:${label} {id: $id}) SET ${setClause || 'n.id = $id'} RETURN n`,
    params
  );
  return rows[0]?.n ?? null;
}

/**
 * Idempotent edge upsert with optional properties (evidence chunk, weight...).
 */
export async function mergeRelation(
  graph: Graph,
  fromLabel: string,
  fromId: string,
  toLabel: string,
  toId: string,
  relType: string,
  relProps: Record<string, any> = {}
): Promise<void> {
  const paramKeys = Object.keys(relProps);
  const setClause = paramKeys.length
    ? ' ' + paramKeys.map((k) => `SET r.${k.replace(/[^a-zA-Z0-9_]/g, '_')} = $set_${k.replace(/[^a-zA-Z0-9_]/g, '_')}`).join(', ')
    : '';
  const params: Record<string, any> = { fromId, toId };
  paramKeys.forEach((k) => {
    params[`set_${k.replace(/[^a-zA-Z0-9_]/g, '_')}`] = relProps[k];
  });
  await runQuery(
    graph,
    `MATCH (a:${fromLabel} {id: $fromId}), (b:${toLabel} {id: $toId}) MERGE (a)-[r:${relType}]->(b)${setClause}`,
    params
  );
}

/**
 * Writes a float32 vector property with vecf32() so the FalkorDB vector index
 * recognizes it (plain array params are NOT indexed as vectors).
 */
export async function setVectorProp(
  graph: Graph,
  label: string,
  id: string,
  prop: string,
  vec: number[]
): Promise<void> {
  await runQuery(graph, `MATCH (n:${label} {id: $id}) SET n.${prop} = vecf32($v)`, { id, v: vec });
}

export async function getGraphStats(graph: Graph): Promise<{
  nodesByLabel: Record<string, number>;
  edgesByType: Record<string, number>;
  totalNodes: number;
  totalEdges: number;
}> {
  const labelRows = await runQuery(graph, `MATCH (n) RETURN labels(n)[0] AS label, count(n) AS c ORDER BY c DESC`);
  const edgeRows = await runQuery(graph, `MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS c ORDER BY c DESC`);
  const nodesByLabel: Record<string, number> = {};
  labelRows.forEach((r: any) => { if (r.label) nodesByLabel[r.label] = Number(r.c); });
  const edgesByType: Record<string, number> = {};
  edgeRows.forEach((r: any) => { edgesByType[r.type] = Number(r.c); });
  return {
    nodesByLabel,
    edgesByType,
    totalNodes: Object.values(nodesByLabel).reduce((a, b) => a + b, 0),
    totalEdges: Object.values(edgesByType).reduce((a, b) => a + b, 0),
  };
}

export async function clearTenantGraph(graph: Graph): Promise<void> {
  await runQuery(graph, 'MATCH (n) DETACH DELETE n');
}

const LINK_STOPWORDS = new Set([
  'who', 'what', 'when', 'where', 'which', 'whom', 'whose', 'does', 'did', 'are', 'was', 'were',
  'have', 'has', 'had', 'will', 'would', 'could', 'should', 'about', 'from', 'that', 'this',
  'with', 'for', 'and', 'the', 'is', 'of', 'to', 'in', 'on', 'us', 'our', 'you', 'they', 'it',
  'need', 'needs', 'know', 'known', 'owner', 'owns', 'ask', 'tell', 'give', 'show', 'list',
]);

/** lower-case, punctuation -> single space (mirrors HAY_EXPR inside Cypher). */
function punctToSpace(value: string): string {
  return value.toLowerCase().replace(/[-_.,()/\\'"+&:;]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Query text -> candidate entity phrases (word n-grams, longest first). */
export function entityPhrases(needle: string, maxPhrases = 24): string[] {
  const words = punctToSpace(needle)
    .split(' ')
    .filter((w) => w.length > 2 && !LINK_STOPWORDS.has(w));
  const phrases = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (let len = 3; len >= 1; len--) {
      if (i + len <= words.length) phrases.add(words.slice(i, i + len).join(' '));
    }
  }
  return [...phrases].slice(0, maxPhrases);
}

/**
 * Entity linking (FR-9 step 1): find nodes of the given labels whose name or
 * searchKey (normalized aliases) overlaps any phrase of the question. Punctuation
 * is flattened on both sides so "Denied-Party Screening" matches "denied party".
 */
const HAY_EXPR = (prop: string) =>
  `toLower(replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(${prop}, ''), '-', ' '), '_', ' '), '.', ' '), ',', ' '), '(', ' '), ')', ' '), '/', ' '), ': ' , ' '), "'", ' '))`;

export async function findEntityNodesByName(
  graph: Graph,
  labels: string[],
  needle: string
): Promise<CypherRow[]> {
  const predicates = labels.map((l) => `n:${l}`).join(' OR ');
  const phrases = entityPhrases(needle);
  if (!phrases.length) return [];
  const params: Record<string, any> = {};
  const conditions = phrases.map((p, i) => {
    params[`p${i}`] = p;
    return `hay CONTAINS $p${i} OR toLower(coalesce(n.searchKey, '')) CONTAINS $p${i}`;
  });
  return runQuery(
    graph,
    `MATCH (n) WHERE (${predicates})
     WITH n, ${HAY_EXPR('coalesce(n.name, n.title, n.ruleName, n.policyName)')} AS hay
     WHERE ${conditions.join(' OR ')}
     RETURN n.id AS id, labels(n)[0] AS label,
            coalesce(n.name, n.title, n.ruleName, n.policyName, n.id) AS name
     LIMIT 25`,
    params
  );
}

/** Ranks linked nodes by the longest question phrase they match. */
export function rankLinkedNodes<T extends { name?: string; label?: string }>(rows: T[], needle: string): T[] {
  const phrases = entityPhrases(needle);
  const score = (row: T) => {
    const hay = punctToSpace(`${row.name ?? ''}`);
    let best = 0;
    for (const p of phrases) if (hay.includes(p) && p.length > best) best = p.length;
    return best;
  };
  return [...rows].sort((a, b) => score(b) - score(a));
}
