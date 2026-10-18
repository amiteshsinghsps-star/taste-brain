import { forTenant } from '../../graph/graph.client';
import { runQuery } from '../../graph/graph.queries';

/**
 * Two things a graph can answer that a vector store structurally cannot:
 *
 *  - PRECEDENT: "what did we decide last time this came up, and who decided it"
 *    (Decision nodes reached through the Task they were about, scored by shared
 *    terms). Shown inside the approval card so the human is not deciding blind.
 *  - ABSENCE: "the graph found the entity but zero OWNS edges" — i.e. proving
 *    that something is *not* known, instead of returning an empty list that
 *    looks like a bug.
 */

export interface Precedent {
  id: string;
  summary: string;
  outcome: string | null;
  at: string | null;
  decidedBy: string | null;
  score: number;
}

export interface AbsenceProof {
  relationship: string;
  fromLabel: string;
  term: string;
  candidateNodes: number;
  edgesFound: number;
  statement: string;
}

const PRECEDENT_QUERY = `
MATCH (d:Decision)
OPTIONAL MATCH (who:Person)-[:DECIDED]->(d)
OPTIONAL MATCH (d)-[:ABOUT]->(t:Task)
WITH d, who, collect(DISTINCT t) AS tasks
WITH d, who,
     reduce(score = 0, term IN $terms |
       score +
       CASE WHEN toLower(coalesce(d.summary, '')) CONTAINS toLower(term) THEN 2 ELSE 0 END +
       CASE WHEN any(task IN tasks WHERE toLower(coalesce(task.summary, '')) CONTAINS toLower(term)
                                             OR toLower(coalesce(task.kind, '')) CONTAINS toLower(term)) THEN 1 ELSE 0 END
     ) AS score
WHERE score > 0 AND d.summary IS NOT NULL
RETURN d.id AS id, d.summary AS summary, d.outcome AS outcome, d.at AS at,
       who.name AS decidedBy, score
ORDER BY score DESC, at DESC
LIMIT $limit
`;

const ABSENCE_QUERY = `
MATCH (n)
WHERE toLower(coalesce(n.name, '')) CONTAINS toLower($term)
   OR toLower(coalesce(n.policyName, '')) CONTAINS toLower($term)
   OR toLower(coalesce(n.title, '')) CONTAINS toLower($term)
OPTIONAL MATCH (source:$fromLabel)-[r:$relationship]->(n)
RETURN count(DISTINCT n) AS candidateNodes, count(r) AS edgesFound
`;

export class PrecedentService {
  /** Last similar decisions for the terms around a pending action. */
  static async similar(tenantId: string, terms: string[], limit = 3): Promise<Precedent[]> {
    const clean = [...new Set(terms.filter((t) => t && t.trim().length > 2).map((t) => t.trim()))];
    if (!clean.length) return [];
    const graph = await forTenant(tenantId);
    const rows = await runQuery(graph, PRECEDENT_QUERY, { terms: clean, limit });
    return rows.map((r: any) => ({
      id: r.id,
      summary: String(r.summary ?? ''),
      outcome: r.outcome ?? null,
      at: r.at ?? null,
      decidedBy: r.decidedBy ?? null,
      score: Number(r.score) || 0,
    }));
  }

  /**
   * Negative trace: how many nodes matched the term and how many edges of the
   * requested type actually exist. `edgesFound: 0` is the finding.
   *
   * `relationship`/`fromLabel` come from call sites in this repo, never from a
   * request body (Cypher cannot parameterise identifiers), and are still
   * validated against the schema allow-list before reaching the query.
   */
  static async absence(
    tenantId: string,
    opts: { relationship: string; fromLabel: string; term: string }
  ): Promise<AbsenceProof> {
    const { isRelationshipType, isNodeLabel } = await import('../../graph/graph.schema');
    if (!isRelationshipType(opts.relationship) || !isNodeLabel(opts.fromLabel)) {
      throw new Error(`relationship ${opts.relationship} or label ${opts.fromLabel} is not in the schema allow-list`);
    }
    const cypher = ABSENCE_QUERY.replace('$fromLabel', opts.fromLabel).replace('$relationship', opts.relationship);
    const graph = await forTenant(tenantId);
    const rows = await runQuery(graph, cypher, { term: opts.term });
    const candidateNodes = Number(rows[0]?.candidateNodes ?? 0);
    const edgesFound = Number(rows[0]?.edgesFound ?? 0);
    return {
      relationship: opts.relationship,
      fromLabel: opts.fromLabel,
      term: opts.term,
      candidateNodes,
      edgesFound,
      statement:
        edgesFound === 0
          ? `Searched the graph for (${opts.fromLabel})-[:${opts.relationship}]->(node) matching "${opts.term}": ${candidateNodes} node(s) matched the name, 0 ${opts.relationship} edges exist. The graph does not record this relationship.`
          : `Found ${edgesFound} ${opts.relationship} edge(s) across ${candidateNodes} matching node(s).`,
    };
  }
}
