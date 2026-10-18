import { forTenant } from '../../graph/graph.client';
import { runQuery, nodeProps } from '../../graph/graph.queries';

/**
 * FreshnessService (FR-6, D1–D3, §13.1 "Needs review") — keeping knowledge
 * current: document versions linked with SUPERSEDES, dependent rules flagged
 * STALE until reviewed, impact analysis of a policy change.
 */
export class FreshnessService {
  /**
   * Multi-hop impact of changing a policy (FR: "what breaks if I edit X"):
   * governed systems/rules, the agents that ran rules, open tasks, stale dependents.
   */
  static async impactOfChange(tenantId: string, policyId: string): Promise<any> {
    const graph = await forTenant(tenantId);
    const policyRows = await runQuery(graph, `MATCH (p:Policy {id: $policyId}) RETURN p LIMIT 1`, { policyId });
    if (!policyRows.length) return null;

    const governed = await runQuery(
      graph,
      `MATCH (p:Policy {id: $policyId})-[:GOVERNS|VALIDATES|REQUIRES]->(t) RETURN t, labels(t)[0] AS label LIMIT 25`,
      { policyId }
    );
    const rules = await runQuery(
      graph,
      `MATCH (r:Rule)-[:IMPLEMENTS]->(p:Policy {id: $policyId})
       RETURN r.id AS id, r.ruleName AS name, r.actionType AS actionType, r.status AS status, r.version AS version
       LIMIT 25`,
      { policyId }
    );
    const rulesBySharedSource = await runQuery(
      graph,
      `MATCH (p:Policy {id: $policyId})-[:DERIVED_FROM]->(c:Chunk)<-[:DERIVED_FROM]-(r:Rule)
       RETURN DISTINCT r.id AS id, r.ruleName AS name, r.actionType AS actionType, r.status AS status, r.version AS version
       LIMIT 25`,
      { policyId }
    );
    const agents = await runQuery(
      graph,
      `MATCH (a:Agent)-[:PERFORMED]->(:Task)-[:TRIGGERED]->(r:Rule)-[:IMPLEMENTS]->(p:Policy {id: $policyId})
       RETURN DISTINCT a.id AS id, a.name AS name, a.type AS type LIMIT 25`,
      { policyId }
    );
    const governedAgents = await runQuery(
      graph,
      `MATCH (p:Policy {id: $policyId})-[:GOVERNS]->(a:Agent) RETURN a.id AS id, a.name AS name, a.type AS type LIMIT 25`,
      { policyId }
    );
    const owners = await runQuery(
      graph,
      `MATCH (who)-[:OWNS]->(p:Policy {id: $policyId})
       RETURN who.id AS id, who.name AS name, labels(who)[0] AS type LIMIT 10`,
      { policyId }
    );
    const decisions = await runQuery(
      graph,
      `MATCH (d:Decision)-[:ABOUT]->(p:Policy {id: $policyId}) RETURN d.id AS id, d.summary AS summary, d.outcome, d.at ORDER BY d.at DESC LIMIT 10`,
      { policyId }
    );

    const byId = (rows: any[]) => {
      const seen = new Map<string, any>();
      for (const r of rows) if (r?.id && !seen.has(String(r.id))) seen.set(String(r.id), r);
      return [...seen.values()];
    };

    return {
      policy: nodeProps(policyRows[0]?.p),
      governed: governed.map((r: any) => ({ node: nodeProps(r.t), label: r.label })),
      owners: byId(owners),
      rules: byId([...rules, ...rulesBySharedSource]),
      agents: byId([...agents, ...governedAgents]),
      decisions: decisions.map((r: any) => ({ id: r.id, summary: r.summary, outcome: r.outcome, at: r.at })),
    };
  }

  /**
   * "Needs review" queue (D2): rules/policies whose source chunks changed or
   * that were flagged STALE, with their provenance for one-click re-approval.
   */
  static async staleQueue(tenantId: string): Promise<any[]> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (r:Rule) WHERE r.status = 'STALE' OR r.status = 'REVIEW_PENDING'
       OPTIONAL MATCH (r)-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(d:Document)
       RETURN r.id AS id, r.ruleName AS name, r.actionType AS actionType, r.version AS version, r.staleReason AS reason,
              d.id AS sourceDocumentId, d.title AS sourceDocumentTitle,
              c.id AS sourceChunkId LIMIT 50`
    );
    // Policies awaiting review inferred from supersession chains
    const policyRows = await runQuery(
      graph,
      `MATCH (newDoc:Document)-[:SUPERSEDES]->(oldDoc:Document)
       MATCH (oldDoc)<-[:PART_OF]-(c:Chunk)<-[:DERIVED_FROM]-(r:Rule)-[:IMPLEMENTS]->(p:Policy)
       WHERE r.status <> 'REVIEWED'
       RETURN DISTINCT p.id AS id, p.name AS name, 'source document superseded' AS reason LIMIT 25`,
      {}
    );
    const combined = [
      ...rows.map((r: any) => ({ kind: 'Rule', ...r })),
      ...policyRows.filter((p: any) => p.id).map((p: any) => ({ kind: 'Policy', id: p.id, name: p.name, reason: p.reason, ruleName: undefined })),
    ];
    return combined.filter((r) => r.id);
  }

  /** One-click re-approval after review: clears STALE and bumps version (D2). */
  static async revalidateItem(tenantId: string, itemId: string): Promise<boolean> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (r:Rule {id: $itemId}) SET r.status = 'ACTIVE', r.version = coalesce(r.version, 1) + 1 RETURN r.id AS id`,
      { itemId }
    );
    if (rows.length) return true;
    const polRows = await runQuery(
      graph,
      `MATCH (p:Policy {id: $itemId}) SET p.status = 'ACTIVE' RETURN p.id AS id`,
      { itemId }
    );
    return polRows.length > 0;
  }

  /**
   * Answers "what was the rule last month?" (D3): history of a policy across
   * SUPERSEDES chains with validity windows.
   */
  static async policyHistory(tenantId: string, policyId: string): Promise<any[]> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (p:Policy {id: $policyId})
       OPTIONAL MATCH path = (p)-[:SUPERSEDES*0..3]->(old)
       RETURN path, p.name AS currentName LIMIT 10`,
      { policyId }
    );
    return rows;
  }
}
