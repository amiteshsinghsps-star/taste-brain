import { forTenant } from '../../graph/graph.client';
import { runQuery } from '../../graph/graph.queries';

/**
 * Graph-native deterministic rule engine (PRD v3 Appendix B).
 *
 * FalkorDB is the SOURCE OF TRUTH for rules: every Rule node carries its
 * parameters, version, status, provenance (DERIVED_FROM chunks) and policy
 * (IMPLEMENTS Policy). `loadRulesFromGraph` reads them via Cypher; `evaluate`
 * is a PURE function — no clock, no randomness, no network, no graph access —
 * which is what makes Time-Machine replay and Why-Not explanations trustworthy.
 *
 * The LLM never decides pass/fail: it only extracts rule text into Rule nodes
 * and drafts replies. Verdicts always come from here.
 */

export type Verdict = 'PASSED' | 'REQUIRES_APPROVAL' | 'FLAGGED';

export interface RuleVersion {
  id: string;
  ruleName: string;
  actionType: string;
  params: Record<string, any>;
  severity?: string;
  version: number;
  status: string;
  isExecutable: boolean;
  policyId?: string;
  policyName?: string;
  chunkIds: string[];
}

export interface BookingInput {
  bookingNumber?: string;
  shipper?: string;
  consignee?: string;
  notifyParty?: string;
  origin?: string;
  destination?: string;
  hsCode?: string;
  invoiceAmount?: number;
  currency?: string;
  customer?: string;
}

export interface Facts {
  watchlist: Array<{ name: string; list?: string }>;
}

export interface Evaluation {
  ruleId: string;
  ruleName: string;
  actionType: string;
  policyName?: string;
  verdict: Verdict;
  fired: boolean;
  margin?: number;
  inputsUsed: Record<string, unknown>;
  reasons: string[];
  chunkIds: string[];
}

export interface EngineResult {
  verdict: Verdict;
  evaluations: Evaluation[];
  reasons: string[];
}

const VERDICT_ORDER: Record<Verdict, number> = { PASSED: 1, REQUIRES_APPROVAL: 2, FLAGGED: 3 };

/** Loads executable, ACTIVE rules from the tenant graph with provenance. */
export async function loadRulesFromGraph(tenantId: string): Promise<RuleVersion[]> {
  const graph = await forTenant(tenantId);
  const rows = await runQuery(
    graph,
    `MATCH (r:Rule {status: 'ACTIVE'})
     OPTIONAL MATCH (r)-[:IMPLEMENTS]->(p:Policy)
     OPTIONAL MATCH (r)-[:DERIVED_FROM]->(c:Chunk)
     RETURN r.id AS id, r.ruleName AS ruleName, r.actionType AS actionType,
            r.parametersJSON AS parametersJSON, r.severity AS severity,
            r.version AS version, r.status AS status, r.isExecutable AS isExecutable,
            p.id AS policyId, p.name AS policyName,
            collect(DISTINCT c.id) AS chunkIds`
  );
  return rows.map((r: any) => {
    let params: Record<string, any> = {};
    try {
      params = r.parametersJSON ? JSON.parse(r.parametersJSON) : {};
    } catch {
      params = {};
    }
    return {
      id: r.id,
      ruleName: r.ruleName || r.id,
      actionType: r.actionType || 'OTHER',
      params,
      severity: r.severity,
      version: Number(r.version ?? 1),
      status: r.status || 'ACTIVE',
      isExecutable: String(r.isExecutable) === 'true',
      policyId: r.policyId || undefined,
      policyName: r.policyName || undefined,
      chunkIds: (r.chunkIds || []).filter(Boolean),
    } as RuleVersion;
  });
}

/** Loads graph watchlist facts (injected into evaluate — never fetched inside). */
export async function loadFactsFromGraph(tenantId: string): Promise<Facts> {
  const graph = await forTenant(tenantId);
  const rows = await runQuery(graph, `MATCH (w:WatchlistEntry) RETURN w.name AS name, w.list AS list`);
  return { watchlist: rows.filter((r: any) => r.name).map((r: any) => ({ name: String(r.name), list: r.list ? String(r.list) : undefined })) };
}

type RuleFn = (params: Record<string, any>, input: BookingInput, facts: Facts, rule: RuleVersion) => Evaluation;

function evaluation(rule: RuleVersion, verdict: Verdict, fired: boolean, reasons: string[], inputsUsed: Record<string, unknown>, margin?: number): Evaluation {
  return {
    ruleId: rule.id,
    ruleName: rule.ruleName,
    actionType: rule.actionType,
    policyName: rule.policyName,
    verdict,
    fired,
    margin,
    inputsUsed,
    reasons,
    chunkIds: rule.chunkIds,
  };
}

const RULES: Record<string, RuleFn> = {
  DENIED_PARTY_SCREENING: (params, input, facts, rule) => {
    const parties = [input.shipper, input.consignee, input.notifyParty].filter(Boolean).map((p) => String(p));
    const hit = parties.find((p) => facts.watchlist.some((w) => p.toLowerCase().includes(w.name.toLowerCase())));
    if (hit) {
      return evaluation(
        rule,
        'FLAGGED',
        true,
        [`Party '${hit}' matches a denied-party watchlist entry${params.requireApprovalIfFlagged ? ' — approval required before processing' : ''}.`],
        { shipper: input.shipper, consignee: input.consignee, watchlistSize: facts.watchlist.length }
      );
    }
    return evaluation(rule, 'PASSED', false, [`No watchlist match for ${parties.join(' / ') || 'declared parties'} (watchlist size ${facts.watchlist.length}).`], {
      shipper: input.shipper,
      consignee: input.consignee,
      watchlistSize: facts.watchlist.length,
    });
  },

  HS_CODE_VALIDATION: (params, input, _facts, rule) => {
    const minDigits = Number(params.minDigitLength ?? 6);
    const hsCode = String(input.hsCode || '');
    const digits = hsCode.replace(/\D/g, '').length;
    const restricted: string[] = Array.isArray(params.restrictedPrefixes) ? params.restrictedPrefixes : [];
    if (!hsCode || digits < minDigits) {
      return evaluation(rule, 'FLAGGED', true, [`HS Code '${hsCode || '(missing)'}' has ${digits} digits; minimum is ${minDigits}.`], { hsCode, digits, minDigits }, digits - minDigits);
    }
    const prefix = restricted.find((p) => hsCode.startsWith(p));
    if (prefix) {
      return evaluation(rule, 'REQUIRES_APPROVAL', true, [`HS Code ${hsCode} starts with restricted prefix ${prefix} — approval required.`], { hsCode, restrictedPrefix: prefix }, 0);
    }
    return evaluation(rule, 'PASSED', false, [`HS Code ${hsCode} valid (${digits} digits, minimum ${minDigits}).`], { hsCode, digits, minDigits }, digits - minDigits);
  },

  CREDIT_LIMIT_APPROVAL: (params, input, _facts, rule) => {
    const threshold = Number(params.maxCreditLimit ?? params.threshold ?? 10000);
    const amount = Number(input.invoiceAmount ?? 0);
    const margin = threshold - amount; // negative = exceeded
    if (amount > threshold) {
      return evaluation(rule, 'REQUIRES_APPROVAL', true, [`Amount ${amount.toLocaleString('en-US')} ${input.currency || 'USD'} exceeds the ${threshold.toLocaleString('en-US')} ${input.currency || 'USD'} auto-approval threshold by ${Math.abs(margin).toLocaleString('en-US')}.`], { amount, threshold, currency: input.currency || 'USD' }, margin);
    }
    return evaluation(rule, 'PASSED', false, [`Amount ${amount.toLocaleString('en-US')} ${input.currency || 'USD'} within the ${threshold.toLocaleString('en-US')} auto-approval threshold (margin ${margin.toLocaleString('en-US')}).`], { amount, threshold, currency: input.currency || 'USD' }, margin);
  },
};

/**
 * PURE evaluate: same rules + input + facts → same result. No Date.now(),
 * no Math.random(), no network, no graph access inside.
 */
export function evaluate(rules: RuleVersion[], input: BookingInput, facts: Facts): EngineResult {
  const evaluations = rules
    .filter((r) => r.isExecutable && r.status === 'ACTIVE' && RULES[r.actionType])
    .map((r) => RULES[r.actionType](r.params, input, facts, r));
  const worst = evaluations.reduce<Verdict>((acc, e) => (VERDICT_ORDER[e.verdict] > VERDICT_ORDER[acc] ? e.verdict : acc), 'PASSED');
  return { verdict: worst, evaluations, reasons: evaluations.flatMap((e) => (e.fired ? e.reasons : [])) };
}

/** Convenience: load rules+facts from the graph, then evaluate. */
export async function evaluateBooking(tenantId: string, input: BookingInput, rulesOverride?: RuleVersion[]): Promise<EngineResult> {
  const [rules, facts] = await Promise.all([rulesOverride ?? loadRulesFromGraph(tenantId), loadFactsFromGraph(tenantId)]);
  return evaluate(rules, input, facts);
}
