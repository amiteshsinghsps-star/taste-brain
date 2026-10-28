// The Verifier (W1). Recomputes a decision from an exported file with no Qloo
// key, no network and no database. The CLI and the in-app page both run this one
// module, so a judge can reproduce the browser's verdict from a terminal.
//
// Every check is written to name the exact record that broke, because "FAIL"
// without a pointer is not evidence.

import { evaluateAll, type RuleSubject } from '../agents/rule-checker';
import { verifyLedger } from '../graph/store';
import { DECISION_EXPORT_SCHEMA, type DecisionExport, type ExportCandidate } from './export';
import { rerunHash } from '../trace/builder';
import type { QlooEntityResult } from '../types';

export type CheckStatus = 'pass' | 'fail';

export interface VerifyCheck {
  id: string;
  name: string;
  status: CheckStatus;
  /** What was actually recomputed, in numbers rather than adjectives. */
  detail: string;
  first_failing: string | null;
}

export interface VerifyReport {
  ran_at: string;
  ok: boolean;
  passed: number;
  failed: number;
  checks: VerifyCheck[];
  proposal_id: string | null;
  schema: string | null;
  error: string | null;
}

function asCandidate(c: ExportCandidate): QlooEntityResult {
  return {
    ...(c as unknown as QlooEntityResult),
    type: 'artist',
    fit: 0,
    qloo_tags: c.qloo_tags,
    tag_names: c.tag_names,
    source: { workflow: 'export', mode: 'replay', fetched_at: '', endpoint: '' },
  } as QlooEntityResult;
}

function checkChain(exp: DecisionExport): VerifyCheck {
  const base = { id: 'chain', name: 'Ledger chain recomputes to the stated head hash' };
  if (!exp.ledger.length) {
    return { ...base, status: 'fail', detail: 'the export carries no ledger entries, so there is no chain to check', first_failing: 'ledger is empty' };
  }
  const ledger = verifyLedger(exp.ledger);
  if (!ledger.ok) {
    return { ...base, status: 'fail', detail: `chain breaks at entry ${ledger.first_broken_seq}: ${ledger.reason}`, first_failing: `seq ${ledger.first_broken_seq}` };
  }
  if (ledger.head_hash !== exp.ledger_head_hash) {
    return {
      ...base,
      status: 'fail',
      detail: `recomputed head ${ledger.head_hash?.slice(0, 16)}… does not match the stated head ${String(exp.ledger_head_hash).slice(0, 16)}…`,
      first_failing: 'ledger_head_hash',
    };
  }
  return { ...base, status: 'pass', detail: `${exp.ledger.length} entr${exp.ledger.length === 1 ? 'y' : 'ies'} re-hashed from content, every link checked, head ${ledger.head_hash?.slice(0, 16)}…`, first_failing: null };
}

function checkGroundedIds(exp: DecisionExport): VerifyCheck {
  const base = { id: 'qloo_ids', name: 'Every shown item has a Qloo entity id in this run\'s evidence set' };
  const ids = new Set(exp.evidence.entity_ids);
  if (!exp.decision.items.length) {
    return { ...base, status: 'fail', detail: 'the proposal shows no items, so the grounding claim was not exercised', first_failing: 'no items' };
  }
  const bad = exp.decision.items.find((it) => !it.entity_id || !ids.has(it.entity_id));
  if (bad) {
    return { ...base, status: 'fail', detail: `${bad.name} (rank ${bad.rank}) cites ${bad.entity_id || 'no id'}, which is not among the ${ids.size} stored evidence id(s)`, first_failing: bad.entity_id || bad.name };
  }
  return { ...base, status: 'pass', detail: `${exp.decision.items.length} shown item(s) all present in a ${ids.size}-row evidence set`, first_failing: null };
}

function checkRanking(exp: DecisionExport): VerifyCheck {
  const base = { id: 'ranking', name: 'The order is Qloo\'s own returned order, not a re-sort' };
  const rankById = new Map(exp.evidence.candidates.map((c) => [c.entity_id, c.qloo_rank]));
  const items = exp.decision.items;
  if (!items.length) {
    return { ...base, status: 'fail', detail: 'no items to order', first_failing: 'no items' };
  }
  for (const it of items) {
    const qlooRank = rankById.get(it.entity_id);
    if (qlooRank === undefined) {
      return { ...base, status: 'fail', detail: `${it.name} has no Qloo rank in the evidence set, so its position cannot be attributed to Qloo`, first_failing: it.entity_id };
    }
    if (qlooRank !== it.qloo_rank) {
      return { ...base, status: 'fail', detail: `${it.name} is recorded at Qloo rank ${it.qloo_rank} but the evidence set has it at ${qlooRank}`, first_failing: it.entity_id };
    }
  }
  const expected = [...items].sort((a, b) => a.qloo_rank - b.qloo_rank);
  const misplaced = expected.findIndex((it, i) => it.entity_id !== items[i].entity_id);
  if (misplaced >= 0) {
    const want = expected[misplaced];
    return { ...base, status: 'fail', detail: `position ${misplaced + 1} holds ${items[misplaced].name} (Qloo rank ${items[misplaced].qloo_rank}) but Qloo's order puts ${want.name} (rank ${want.qloo_rank}) there`, first_failing: items[misplaced].entity_id };
  }
  const rankMismatch = items.findIndex((it, i) => it.rank !== i + 1);
  if (rankMismatch >= 0) {
    const it = items[rankMismatch];
    return { ...base, status: 'fail', detail: `${it.name} is labelled rank ${it.rank} but sits at position ${rankMismatch + 1}`, first_failing: it.entity_id };
  }
  return { ...base, status: 'pass', detail: `${items.length} item(s) in ascending Qloo rank, positions 1..${items.length} contiguous, no app-side re-sort`, first_failing: null };
}

function checkRules(exp: DecisionExport): VerifyCheck {
  const base = { id: 'rules', name: 'Each rule verdict re-evaluates under the pinned rule set' };
  const byId = new Map(exp.rules.rules.map((r) => [r.id, r]));
  const subjectById = new Map(exp.rule_subjects.map((s) => [s.entity_id, s]));
  const candidateById = new Map(exp.evidence.candidates.map((c) => [c.entity_id, c]));
  let reevaluated = 0;
  for (const it of exp.decision.items) {
    const subject = subjectById.get(it.entity_id);
    const candidate = candidateById.get(it.entity_id);
    if (!subject || !candidate) {
      return { ...base, status: 'fail', detail: `${it.name} cannot be re-evaluated: the export carries no rule subject or evidence row for ${it.entity_id}`, first_failing: it.entity_id };
    }
    for (const stored of it.rule_results) {
      const rule = byId.get(stored.rule_id);
      if (!rule) {
        return { ...base, status: 'fail', detail: `${it.name}: verdict records rule "${stored.rule_id}" which is not in the pinned rule set (${exp.rules.pinned_version.slice(0, 12)}…)`, first_failing: `${it.entity_id}/${stored.rule_id}` };
      }
      const rebuilt: RuleSubject = {
        name: subject.name,
        fields: subject.fields,
        tags: [...subject.offer_tags.map((t) => t.toLowerCase()), ...candidate.tag_names],
        tag_ids: candidate.qloo_tags.map((t) => t.id),
        qloo: asCandidate(candidate),
      };
      const recomputed = evaluateAll([rule], rebuilt)[0];
      reevaluated += 1;
      if (recomputed.status !== stored.status) {
        return { ...base, status: 'fail', detail: `${it.name} / ${rule.id}: recorded "${stored.status}" but the pinned rule re-evaluates to "${recomputed.status}" (${recomputed.reason})`, first_failing: `${it.entity_id}/${rule.id}` };
      }
    }
  }
  if (!reevaluated) {
    return { ...base, status: 'fail', detail: 'no rule verdict was recorded on any item, so nothing was exercised', first_failing: 'no verdicts' };
  }
  return { ...base, status: 'pass', detail: `${reevaluated} verdict(s) across ${exp.decision.items.length} item(s) recomputed from the pinned rule set ${exp.rules.pinned_version.slice(0, 16)}…; all match`, first_failing: null };
}

/**
 * The chain alone only proves the LEDGER rows were not edited: every other field
 * of the export is unsigned and can be rewritten into a self-consistent fiction.
 * The ledger detail is inside the hashed content, and it records the run's
 * rerun_hash and the canonicalisation version that produced it, so re-hashing the
 * exported decision steps under that version is what binds each item's Qloo entity
 * id, its name, its rank and its rule verdicts to a tamper-evident ledger record.
 * Version 1 hashed
 * a step on its id and left the name out, so those runs are additionally checked
 * against the approved name list inside the same hashed detail.
 */
function checkDecisionBound(exp: DecisionExport): VerifyCheck {
  const base = { id: 'decision_bound', name: 'The items, order and verdicts shown are the ones the hashed ledger recorded' };
  type Recorded = { hash: string; version: 1 | 2; seq: number };
  const recorded: Recorded[] = exp.ledger.flatMap((e) => {
    const d = e.detail as { rerun_hash?: unknown; rerun_hash_version?: unknown } | undefined;
    if (typeof d?.rerun_hash !== 'string' || d.rerun_hash.length === 0) return [];
    return [{ hash: d.rerun_hash, version: d.rerun_hash_version === 2 ? 2 as const : 1 as const, seq: e.seq }];
  });
  if (!recorded.length) {
    return { ...base, status: 'fail', detail: 'no hash-protected ledger entry records a rerun_hash, so nothing binds this ranking to a tamper-evident ledger record', first_failing: 'ledger detail.rerun_hash' };
  }
  const steps = exp.decision.trace?.steps ?? [];
  // Each canonicalisation is tried only against the hashes recorded under it, so a
  // v1 run cannot be satisfied by a v2 re-hash of edited steps, or the other way.
  const attempts = [...new Set(recorded.map((r) => r.version))]
    .map((v) => ({ v, hash: rerunHash(steps, v) }));
  const hit = attempts.find((a) => recorded.some((r) => r.version === a.v && r.hash === a.hash));
  if (!hit) {
    return {
      ...base,
      status: 'fail',
      detail: `the ${steps.length} decision step(s) in this export re-hash to ${attempts.map((a) => `v${a.v} ${a.hash}`).join(' and ')}, but the hash-protected ledger records ${recorded.map((r) => `v${r.version} ${r.hash}`).join(' / ')} — items, order, names or verdicts were changed after the run`,
      first_failing: attempts.map((a) => `rerun_hash v${a.v} ${a.hash}`).join(', '),
    };
  }
  // Version 1 hashed a step on its id and skipped the name, so for those runs the
  // names are bound by the approved list inside the hashed ledger detail instead.
  const signed = exp.ledger
    .map((e) => (e.detail as { approved?: unknown } | undefined)?.approved)
    .filter((a): a is { name: string; qloo_rank: number }[] => Array.isArray(a))
    .flat();
  const byRank = new Map(exp.decision.items.map((i) => [i.qloo_rank, i.name]));
  const misnamed = signed.filter((s) => typeof s?.qloo_rank === 'number' && byRank.has(s.qloo_rank) && byRank.get(s.qloo_rank) !== s.name);
  if (misnamed.length) {
    return {
      ...base,
      status: 'fail',
      detail: `rank ${misnamed.map((m) => m.qloo_rank).join(', ')} ${misnamed.length === 1 ? 'is' : 'are'} recorded as ${misnamed.map((m) => JSON.stringify(m.name)).join(', ')} inside the hashed ledger, but this export shows ${misnamed.map((m) => JSON.stringify(byRank.get(m.qloo_rank))).join(', ')}`,
      first_failing: `ledger approved list, rank ${misnamed[0].qloo_rank}`,
    };
  }
  const namesNote = hit.v === 2
    ? 'names included'
    : `${signed.length} approved name(s) cross-checked against the ledger`;
  return { ...base, status: 'pass', detail: `${steps.length} decision step(s) re-hashed to ${hit.hash} under canonicalisation v${hit.v}, matching the rerun_hash carried inside the hash-protected ledger detail (${namesNote})`, first_failing: null };
}

function checkModes(exp: DecisionExport): VerifyCheck {
  const base = { id: 'modes', name: 'Mode is recorded on every step and the badge does not overstate it' };
  const steps = exp.decision.trace.steps;
  const noMode = steps.findIndex((s) => !s.mode);
  if (noMode >= 0) {
    return { ...base, status: 'fail', detail: `trace step ${noMode + 1} ("${steps[noMode].label}") carries no mode`, first_failing: `step ${noMode + 1}` };
  }
  const badItem = exp.decision.items.find((it) => !it.mode || !it.evidence?.mode);
  if (badItem) {
    return { ...base, status: 'fail', detail: `${badItem.name} has no mode on the item or its evidence card`, first_failing: badItem.entity_id };
  }
  const mix: Record<string, number> = { live: 0, cached: 0, replay: 0 };
  for (const s of steps) if (s.mode) mix[s.mode] = (mix[s.mode] ?? 0) + 1;
  if (!steps.length) {
    return { ...base, status: 'fail', detail: 'the export carries no trace steps, so "mode recorded on every step" was never exercised', first_failing: 'empty trace' };
  }
  if (exp.decision.mode === 'live' && mix.live === 0) {
    return { ...base, status: 'fail', detail: `badge says live but not one of ${steps.length} steps was fetched live (${mix.cached} cached, ${mix.replay} replay)`, first_failing: exp.decision.proposal_id };
  }
  // Cached claims a stored Qloo answer. If none of the steps are cached or live,
  // every row came from the synthetic fixtures and the badge overstates — the
  // same class of lie as a live badge, just one step down.
  if (exp.decision.mode === 'cached' && mix.cached === 0 && mix.live === 0) {
    return { ...base, status: 'fail', detail: `badge says cached (a stored Qloo answer) but all ${mix.replay} labelled step(s) are replay — synthetic fixtures, never fetched`, first_failing: exp.decision.proposal_id };
  }
  return { ...base, status: 'pass', detail: `${steps.length} step(s) all labelled: ${mix.live} live, ${mix.cached} cached, ${mix.replay} replay; badge reads "${exp.decision.mode}"`, first_failing: null };
}

export interface VerifyRunResult {
  report: VerifyReport;
  export?: DecisionExport;
}

export function verifyExport(raw: unknown): VerifyReport {
  const ranAt = new Date().toISOString();
  const exp = raw as DecisionExport;
  if (!exp || typeof exp !== 'object' || exp.schema !== DECISION_EXPORT_SCHEMA) {
    return {
      ran_at: ranAt, ok: false, passed: 0, failed: 1, checks: [],
      proposal_id: null, schema: exp?.schema ?? null,
      error: `not a ${DECISION_EXPORT_SCHEMA} file`,
    };
  }
  const checks = [
    checkChain(exp),
    checkDecisionBound(exp),
    checkGroundedIds(exp),
    checkRanking(exp),
    checkRules(exp),
    checkModes(exp),
  ];
  const failed = checks.filter((c) => c.status === 'fail');
  return {
    ran_at: ranAt,
    ok: failed.length === 0,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
    proposal_id: exp.provenance?.proposal_id ?? null,
    schema: exp.schema,
    error: null,
  };
}

export function formatReport(report: VerifyReport): string {
  if (report.error) return `ERROR: ${report.error}`;
  const lines = report.checks.map((c) => `${c.status === 'pass' ? 'PASS' : 'FAIL'}  ${c.id.padEnd(9)} ${c.name}\n      ${c.detail}${c.first_failing ? `\n      first failing record: ${c.first_failing}` : ''}`);
  return [
    `Taste Brain verifier — proposal ${report.proposal_id} at ${report.ran_at}`,
  ].concat(lines, [`${report.ok ? 'PASS' : 'FAIL'}  ${report.passed}/${report.checks.length} checks`]).join('\n');
}
