import { forTenant } from '../../graph/graph.client';
import { runQuery } from '../../graph/graph.queries';
import { loadRulesFromGraph, loadFactsFromGraph, evaluate, Evaluation } from './rule-engine.service';

/**
 * Why-Not explanations (PRD v3 W3) — explainability beyond citations.
 *
 * "Why wasn't BK-1043 flagged?" → loads the stored booking, re-runs the pure
 * engine, and reports every rule evaluation with its margin so a human sees
 * exactly how close each rule came to firing and what evidence it used.
 */

export interface WhyNotResult {
  bookingNumber: string;
  recordedVerdict: string;
  currentVerdict: string;
  evaluations: Array<Evaluation & { marginLabel?: string }>;
  nearestRule?: { ruleName: string; actionType: string; reason: string; margin?: number };
  summary: string;
  traceSentences: string[];
}

export class WhyNotService {
  /** Explains why a stored booking did (or did not) get its verdict. */
  static async whyNot(tenantId: string, bookingNumber: string): Promise<WhyNotResult | null> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (b:Booking) WHERE b.bookingNumber = $bn OR b.id = $bn
       OPTIONAL MATCH (b)-[:FOR]->(c:Customer)
       RETURN b.id AS id, b.bookingNumber AS bookingNumber, b.input AS input, b.recordedVerdict AS recordedVerdict, c.name AS customer`,
      { bn: bookingNumber }
    );
    const b = rows[0];
    if (!b) return null;

    let input: any = {};
    try {
      input = JSON.parse(b.input || '{}');
    } catch {
      input = {};
    }

    const [rules, facts] = await Promise.all([loadRulesFromGraph(tenantId), loadFactsFromGraph(tenantId)]);
    const result = evaluate(rules, input, facts);

    const fired = result.evaluations.filter((e) => e.fired);
    const notFired = result.evaluations.filter((e) => !e.fired);
    // Nearest miss: the non-fired rule with the smallest absolute margin.
    const nearest = notFired
      .filter((e) => typeof e.margin === 'number')
      .sort((a, b2) => Math.abs(a.margin!) - Math.abs(b2.margin!))[0];

    const marginLabel = (e: Evaluation) =>
      typeof e.margin === 'number' ? (e.actionType === 'CREDIT_LIMIT_APPROVAL' ? `$${e.margin.toLocaleString('en-US')}` : String(e.margin)) : undefined;

    const evals = result.evaluations.map((e) => ({ ...e, marginLabel: marginLabel(e) }));

    const summary = fired.length
      ? `Booking ${b.bookingNumber} (${b.customer || 'unknown customer'}): ${fired.length} rule(s) fired → verdict ${result.verdict}. ${fired.map((e) => e.reasons.join(' ')).join(' ')}`
      : result.evaluations.length
        ? `Booking ${b.bookingNumber} (${b.customer || 'unknown customer'}): ${result.evaluations.length} rule(s) evaluated; none fired → verdict PASSED. Closest: ${nearest ? `${nearest.ruleName} — ${nearest.reasons[0]}` : 'no rule produced a margin'}.`
        : `Booking ${b.bookingNumber}: no executable rules are active in the tenant graph.`;

    return {
      bookingNumber: b.bookingNumber || b.id,
      recordedVerdict: b.recordedVerdict || 'UNKNOWN',
      currentVerdict: result.verdict,
      evaluations: evals,
      nearestRule: nearest
        ? { ruleName: nearest.ruleName, actionType: nearest.actionType, reason: nearest.reasons[0] || '', margin: nearest.margin }
        : undefined,
      summary,
      traceSentences: [
        `Booking ${b.bookingNumber} — recorded verdict ${b.recordedVerdict}`,
        ...result.evaluations.map((e) => `Rule "${e.ruleName}" (${e.actionType}) → ${e.verdict}${typeof e.margin === 'number' ? `, margin ${marginLabel(e)}` : ''} — ${e.reasons[0] || ''}`),
      ],
    };
  }
}
