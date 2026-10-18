import crypto from 'crypto';
import { forTenant } from '../../graph/graph.client';
import { runQuery, mergeNode, mergeRelation, nodeProps } from '../../graph/graph.queries';
import { loadRulesFromGraph, loadFactsFromGraph, evaluate, RuleVersion, Verdict, BookingInput } from './rule-engine.service';
import { FreshnessService } from './freshness.service';
import { LedgerService } from './ledger.service';

/**
 * Policy Time Machine (PRD v3 W1) — counterfactual replay.
 *
 * Given a rule and candidate parameters, replay every stored Booking between
 * two timestamps under BOTH the current rule and the candidate rule (pure
 * engine → trustworthy), report exactly which verdicts would change, replay
 * fidelity vs the recorded verdicts, and the graph impact (owners, governed
 * systems, agents). Simulations are PROPOSED and read-only until Apply.
 */

export interface SimInput {
  ruleId: string;
  candidateParams: Record<string, unknown>;
  fromTs?: number;
  toTs?: number;
}

export interface SimDiff {
  bookingId: string;
  bookingNumber: string;
  customer: string;
  baseline: Verdict;
  candidate: Verdict;
  margin: number | undefined;
  reason: string;
}

export interface SimulationResult {
  simulationId: string;
  ruleId: string;
  ruleName: string;
  candidateParams: Record<string, unknown>;
  total: number;
  changed: number;
  replayFidelity: number;
  replayMatches: number;
  diffs: SimDiff[];
  impact: any;
  affectedCustomers: Array<{ customer: string; count: number }>;
  unreliable: boolean;
}

export class SimulationService {
  /** Runs the counterfactual; writes a PROPOSED Simulation node (no rule mutation). */
  static async simulate(tenantId: string, s: SimInput): Promise<SimulationResult> {
    const graph = await forTenant(tenantId);
    const rules = await loadRulesFromGraph(tenantId);
    const rule = rules.find((r) => r.id === s.ruleId);
    if (!rule) throw new Error('Rule not found in tenant graph');

    const toTs = s.toTs ?? Date.now();
    const fromTs = s.fromTs ?? toTs - 30 * 24 * 3600 * 1000;

    const bookingRows = await runQuery(
      graph,
      `MATCH (b:Booking) WHERE b.atMs >= $fromTs AND b.atMs <= $toTs
       OPTIONAL MATCH (b)-[:FOR]->(c:Customer)
       RETURN b.id AS id, b.bookingNumber AS bookingNumber, b.input AS input, b.recordedVerdict AS recordedVerdict, c.name AS customer
       ORDER BY b.atMs`,
      { fromTs: String(fromTs), toTs: String(toTs) }
    );
    if (!bookingRows.length) throw new Error('No bookings found in window — load the demo company first');

    const facts = await loadFactsFromGraph(tenantId);
    const candidateRule: RuleVersion = { ...rule, params: { ...rule.params, ...s.candidateParams } };
    const rulesForCandidate = rules.map((r) => (r.id === rule.id ? candidateRule : r));

    let replayMatches = 0;
    const diffs: SimDiff[] = [];
    for (const b of bookingRows) {
      let input: BookingInput;
      try {
        input = JSON.parse(b.input);
      } catch {
        continue;
      }
      const base = evaluate(rules, input, facts);
      if (base.verdict === b.recordedVerdict) replayMatches++;
      const cand = evaluate(rulesForCandidate, input, facts);
      if (base.verdict !== cand.verdict) {
        const candEval = cand.evaluations.find((e) => e.ruleId === rule.id);
        diffs.push({
          bookingId: b.id,
          bookingNumber: b.bookingNumber || b.id,
          customer: b.customer || 'Unknown',
          baseline: base.verdict,
          candidate: cand.verdict,
          margin: candEval?.margin,
          reason: candEval?.reasons[0] || `${rule.ruleName} verdict changed`,
        });
      }
    }

    const total = bookingRows.length;
    const replayFidelity = total ? replayMatches / total : 1;
    const impact = await FreshnessService.impactOfChange(tenantId, rule.policyId || '');

    const customerCounts = new Map<string, number>();
    diffs.forEach((d) => customerCounts.set(d.customer, (customerCounts.get(d.customer) || 0) + 1));
    const affectedCustomers = [...customerCounts.entries()].map(([customer, count]) => ({ customer, count })).sort((a, b) => b.count - a.count);

    const simulationId = `sim_${crypto.randomUUID().slice(0, 12)}`;
    await mergeNode(graph, 'Simulation', simulationId, {
      status: 'PROPOSED',
      ruleId: rule.id,
      ruleName: rule.ruleName,
      candidateParams: JSON.stringify(s.candidateParams),
      total: String(total),
      changed: String(diffs.length),
      replayFidelity: String(replayFidelity),
      at: new Date().toISOString(),
      demoSeed: 'false',
    });
    await mergeRelation(graph, 'Simulation', simulationId, 'Rule', rule.id, 'ON');
    for (const d of diffs.slice(0, 50)) {
      await mergeRelation(graph, 'Simulation', simulationId, 'Booking', d.bookingId, 'AFFECTS');
    }

    return {
      simulationId,
      ruleId: rule.id,
      ruleName: rule.ruleName,
      candidateParams: s.candidateParams,
      total,
      changed: diffs.length,
      replayFidelity,
      replayMatches,
      diffs,
      impact,
      affectedCustomers,
      unreliable: replayFidelity < 1,
    };
  }

  /** Applies a PROPOSED simulation: new Rule version + Decision + ledger entry. */
  static async apply(tenantId: string, simulationId: string, approver: string, approverNote?: string): Promise<{ newRuleId: string; decisionId: string; ledgerSeq: number }> {
    const graph = await forTenant(tenantId);
    const simRows = await runQuery(graph, `MATCH (s:Simulation {id: $id}) RETURN s`, { id: simulationId });
    const sim = nodeProps(simRows[0]?.s);
    if (!simRows.length) throw new Error('Simulation not found');
    if (sim.status !== 'PROPOSED') throw new Error(`Simulation status is ${sim.status}; only PROPOSED simulations can be applied`);

    const rules = await loadRulesFromGraph(tenantId);
    const rule = rules.find((r) => r.id === sim.ruleId);
    if (!rule) throw new Error('Rule not found in tenant graph');

    const now = new Date().toISOString();
    const candidateParams = (() => {
      try {
        return JSON.parse(sim.candidateParams || '{}');
      } catch {
        return {};
      }
    })();

    // New rule version supersedes the old (never delete history).
    const newRuleId = `${rule.id}_v${rule.version + 1}`;
    await mergeNode(graph, 'Rule', newRuleId, {
      ruleName: rule.ruleName,
      actionType: rule.actionType,
      triggerCondition: 'On freight booking / financial event',
      severity: rule.severity || 'HIGH',
      parametersJSON: JSON.stringify({ ...rule.params, ...candidateParams }),
      version: String(rule.version + 1),
      isExecutable: 'true',
      status: 'ACTIVE',
      demoSeed: 'false',
    });
    await runQuery(
      graph,
      `MATCH (old:Rule {id: $oldId}) SET old.status = 'SUPERSEDED', old.validTo = $now
       WITH old
       MATCH (newR:Rule {id: $newId})
       MERGE (newR)-[:SUPERSEDES]->(old)
       WITH newR, old
       OPTIONAL MATCH (old)-[:IMPLEMENTS]->(p:Policy)
       FOREACH (pol IN CASE WHEN p IS NULL THEN [] ELSE [p] END | MERGE (newR)-[:IMPLEMENTS]->(pol))
       WITH newR, old
       OPTIONAL MATCH (old)-[:DERIVED_FROM]->(c:Chunk)
       FOREACH (ch IN CASE WHEN c IS NULL THEN [] ELSE [c] END | MERGE (newR)-[:DERIVED_FROM]->(ch))`,
      { oldId: rule.id, newId: newRuleId, now }
    );
    // Point chunk provenance for old rule so its history remains queryable.
    await mergeRelation(graph, 'Simulation', simulationId, 'Rule', newRuleId, 'ON');

    // Human Decision node: Person → DECIDED → Decision → ABOUT Policy, DERIVED_FROM the simulation.
    const decisionId = `decision_${crypto.randomUUID().slice(0, 12)}`;
    await mergeNode(graph, 'Decision', decisionId, {
      summary: `Applied rule change via Policy Time Machine: ${rule.ruleName} v${rule.version} → v${rule.version + 1} (params ${JSON.stringify(candidateParams)}). ${approverNote || ''}`.trim(),
      outcome: 'APPLIED',
      at: now,
      mode: 'COPILOT',
      demoSeed: 'false',
    });
    const approverRows = await runQuery(graph, `MATCH (p:Person) WHERE toLower(p.name) CONTAINS toLower($approver) RETURN p.id AS id LIMIT 1`, { approver });
    if (approverRows[0]?.id) {
      await mergeRelation(graph, 'Person', approverRows[0].id, 'Decision', decisionId, 'DECIDED');
    }
    if (rule.policyId) {
      await mergeRelation(graph, 'Decision', decisionId, 'Policy', rule.policyId, 'ABOUT');
    }
    await runQuery(graph, `MATCH (d:Decision {id: $did}), (s:Simulation {id: $sid}) MERGE (d)-[:DERIVED_FROM]->(s)`, { did: decisionId, sid: simulationId });

    await runQuery(graph, `MATCH (s:Simulation {id: $id}) SET s.status = 'APPLIED'`, { id: simulationId });

    const ledger = await LedgerService.append({
      tenantId,
      actor: approver,
      kind: 'RULE_CHANGE_APPLIED',
      subjectId: decisionId,
      payload: { oldRuleId: rule.id, newRuleId, candidateParams, simulationId, note: approverNote || '' },
    });

    return { newRuleId, decisionId, ledgerSeq: ledger.seq };
  }

  /** Discards a PROPOSED simulation — graph rule data untouched. */
  static async discard(tenantId: string, simulationId: string): Promise<boolean> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (s:Simulation {id: $id}) WHERE s.status = 'PROPOSED' SET s.status = 'DISCARDED' RETURN s.id AS id`,
      { id: simulationId }
    );
    return rows.length > 0;
  }

  static async get(tenantId: string, simulationId: string) {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (s:Simulation {id: $id})
       OPTIONAL MATCH (s)-[:ON]->(r:Rule)
       OPTIONAL MATCH (s)-[:AFFECTS]->(b:Booking)
       RETURN s, r.id AS ruleId, r.ruleName AS ruleName, collect(DISTINCT b.id) AS affectedBookings`,
      { id: simulationId }
    );
    const row = rows[0];
    if (!row) return null;
    return { ...nodeProps(row.s), ruleId: row.ruleId, ruleName: row.ruleName, affectedBookings: row.affectedBookings };
  }
}
