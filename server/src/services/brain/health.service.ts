import { forTenant } from '../../graph/graph.client';
import { runQuery, mergeNode } from '../../graph/graph.queries';

/**
 * Knowledge Health report (PRD v3 W5) — real company-brain insight:
 * orphan policies, rules without provenance, stale rules, bus-factor-1
 * systems, and documents that have not been refreshed. Score is a simple
 * weighted deduction, shown live in the UI with one-click fixes.
 */

export interface HealthFinding {
  kind: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  subjectId: string;
  subjectName: string;
  detail: string;
}

export interface HealthReport {
  score: number;
  findings: HealthFinding[];
  counts: { HIGH: number; MEDIUM: number; LOW: number };
}

export class HealthService {
  static async report(tenantId: string): Promise<HealthReport> {
    const graph = await forTenant(tenantId);
    const findings: HealthFinding[] = [];
    const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

    // Active policies with no owner (Appendix F idiom: OPTIONAL MATCH + count = 0)
    const orphanPolicies = await runQuery(
      graph,
      `MATCH (p:Policy {status: 'ACTIVE'})
       OPTIONAL MATCH (o:Person)-[:OWNS]->(p)
       WITH p, count(o) AS owners WHERE owners = 0
       RETURN p.id AS id, p.name AS name`,
      {}
    );
    orphanPolicies.forEach((r: any) =>
      findings.push({ kind: 'ORPHAN_POLICY', severity: 'HIGH', subjectId: r.id, subjectName: r.name, detail: `Active policy "${r.name}" has no owner (Person)-[:OWNS]->(Policy).` })
    );

    // Rules with no source chunk (no provenance)
    const orphanRules = await runQuery(
      graph,
      `MATCH (r:Rule)
       WHERE r.status = 'ACTIVE' OR r.status = 'STALE'
       OPTIONAL MATCH (r)-[:DERIVED_FROM]->(c:Chunk)
       WITH r, count(c) AS chunks WHERE chunks = 0
       RETURN r.id AS id, r.ruleName AS name`,
      {}
    );
    orphanRules.forEach((r: any) =>
      findings.push({ kind: 'RULE_NO_SOURCE', severity: 'HIGH', subjectId: r.id, subjectName: r.name, detail: `Rule "${r.name}" has no DERIVED_FROM chunk — its provenance cannot be traced to a document.` })
    );

    // Stale rules
    const staleRules = await runQuery(graph, `MATCH (r:Rule {status: 'STALE'}) RETURN r.id AS id, r.ruleName AS name`, {});
    staleRules.forEach((r: any) =>
      findings.push({ kind: 'STALE_RULE', severity: 'HIGH', subjectId: r.id, subjectName: r.name, detail: `Rule "${r.name}" is STALE — its source document was superseded and it needs review.` })
    );

    // Bus factor ≤ 1: systems where at most one person carries expertise
    const busFactor = await runQuery(
      graph,
      `MATCH (s:System)
       OPTIONAL MATCH (p:Person)-[k:KNOWS_ABOUT]->(s)
       WITH s, count(p) AS people WHERE people <= 1
       RETURN s.id AS id, s.name AS name, people`,
      {}
    );
    busFactor.forEach((r: any) =>
      findings.push({ kind: 'BUS_FACTOR', severity: 'MEDIUM', subjectId: r.id, subjectName: r.name, detail: `System "${r.name}" has bus factor ${r.people} — a single point of knowledge.` })
    );

    // Documents not refreshed in 90 days
    const staleDocs = await runQuery(
      graph,
      `MATCH (d:Document {status: 'ACTIVE'}) WHERE d.validFrom < $cutoff RETURN d.id AS id, d.title AS name`,
      { cutoff }
    );
    staleDocs.forEach((r: any) =>
      findings.push({ kind: 'DOC_NOT_REFRESHED', severity: 'LOW', subjectId: r.id, subjectName: r.name, detail: `Document "${r.name}" has not been refreshed in over 90 days.` })
    );

    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 } as HealthReport['counts'];
    findings.forEach((f) => counts[f.severity]++);
    const score = Math.max(0, 100 - 10 * counts.HIGH - 4 * counts.MEDIUM - 1 * counts.LOW);

    // Persist the report snapshot for the audit trail (graph-only).
    try {
      await mergeNode(graph, 'HealthFinding', `health_${Date.now()}`, {
        score: String(score),
        findingsJSON: JSON.stringify(findings).slice(0, 8000),
        at: new Date().toISOString(),
      });
    } catch {
      // snapshot is best-effort
    }

    return { score, findings, counts };
  }
}
