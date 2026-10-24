// Break-it Challenge (W6). Six attacks, each run against the defence that is
// meant to stop it — the same functions the pipeline calls on a real run.
//
// The rule for this file: an attack may only be reported blocked if a
// production check actually ran and actually refused. Nothing is staged, so a
// defence that stops working turns the scoreboard red instead of hiding.
//
// Sandbox: the attacks run over the committed synthetic Replay sample in
// verification/sample-export.json. The stored ledger is only ever read, never
// written, and no attack path reaches the network.

import * as fs from 'fs';
import * as path from 'path';
import { auditProposal, checkNarrativeGrounding, INJECTION_PROBES, sanitizeName } from '../agents/auditor';
import { evaluateAll, evaluateRule, itemVerdict, type RuleSubject } from '../agents/rule-checker';
import { graph, ledgerHash, verifyLedger } from '../graph/store';
import { AllowlistViolation, allowlistFor, assertAllowed } from '../qloo/allowlist';
import { networkCallCount } from '../qloo/rest-client';
import type { DecisionExport } from '../verify/export';
import type { LedgerEntry, Proposal, Rule, RuleResult } from '../types';

const SAMPLE = path.join(__dirname, '..', '..', 'verification', 'sample-export.json');

export interface AttackOutcome {
  id: string;
  name: string;
  /** What the visitor asked for, in their own terms. */
  attempted: string;
  /** The check that stopped it, named and located. */
  defence: { check: string; where: string };
  blocked: boolean;
  detail: string;
  /** The engine's own line about the attempt — never a sentence written here. */
  log_entry: Record<string, unknown>;
}

export interface BreakItReport {
  ran_at: string;
  sandbox: {
    basis: string;
    mode: 'replay';
    real_ledger_written: false;
    real_ledger_still_intact: boolean | null;
    network_calls_before: number;
    network_calls_after: number;
  };
  blocked: number;
  total: number;
  ok: boolean;
  attacks: AttackOutcome[];
}

function loadSample(): DecisionExport {
  return JSON.parse(fs.readFileSync(SAMPLE, 'utf8')) as DecisionExport;
}

// ── 1. put an item on the proposal that Qloo never returned ─────────────────

function attackUnsupportedItem(exp: DecisionExport): AttackOutcome {
  const INVENTED_ID = 'qloo:brand:invented_by_nobody';
  const proposal = JSON.parse(JSON.stringify(exp.decision)) as Proposal;
  const planted = JSON.parse(JSON.stringify(proposal.items[0])) as Proposal['items'][number];
  planted.entity_id = INVENTED_ID;
  planted.name = 'Velvet Antler';
  planted.rank = proposal.items.length + 1;
  proposal.items.push(planted);

  const report = auditProposal(proposal, new Set(exp.evidence.entity_ids));
  const hit = report.failures.find((f) => f.check === 1 && f.item === 'Velvet Antler');
  return {
    id: 'unsupported_item',
    name: 'Put an item on the proposal that Qloo never returned',
    attempted: `append "${planted.name}" with entity id ${INVENTED_ID} to a ${proposal.items.length}-item proposal`,
    defence: { check: 'Grounding Auditor check 1 — the entity id must exist in this run\'s stored results', where: 'server/src/agents/auditor.ts:101' },
    blocked: !!hit,
    detail: hit
      ? `The Auditor refused it: ${hit.reason}. It is carried as a rejection, never as a recommendation.`
      : `The Auditor let an entity id absent from the stored evidence set through to the proposal.`,
    log_entry: hit ? { check: hit.check, item: hit.item, reason: hit.reason } : { check: 1, item: planted.name, reason: 'no refusal recorded' },
  };
}

// ── 2. injection payload in an entity name ─────────────────────────────────

function attackEntityName(exp: DecisionExport): AttackOutcome {
  const probes = [INJECTION_PROBES[2], INJECTION_PROBES[1]];   // <script>… and Robert"); DROP TABLE proposals; --
  const before = graph.listProposals().length;
  const cleaned = probes.map((p) => ({ sent: p, stored: sanitizeName(p) }));
  const stillExecutable = cleaned.filter((c) => /[<>"'`]|javascript:/i.test(c.stored));
  const after = graph.listProposals().length;

  const names = [...exp.decision.items.map((i) => i.name), ...exp.evidence.candidates.map((c) => c.name)];
  const narrative = checkNarrativeGrounding('This run adds Velvet Antler, which the audience loves.', names, []);

  const tableSurvived = after === before;
  const blocked = stillExecutable.length === 0 && narrative.ok === false && tableSurvived;
  return {
    id: 'entity_name_injection',
    name: 'Inject a script tag and a SQL statement through an entity name',
    attempted: probes.map((p) => `"${p}"`).join(' and '),
    defence: { check: 'sanitizeName before storage, then Grounding Auditor check 2 on the narrative', where: 'server/src/agents/auditor.ts:134 and :45' },
    blocked,
    detail: !blocked
      ? `The name path let something through: ${stillExecutable.length} sanitized name(s) still carry executable characters; narrative refusal: ${narrative.ok ? 'not refused' : 'refused'}; proposals table intact: ${tableSurvived}.`
      : `${cleaned.length} name(s) stripped to inert text, the proposals table still answers (${after} rows before and after), and a narrative naming an entity outside this run's results was refused: ${narrative.reason}.`,
    log_entry: {
      sanitized: cleaned,
      proposals_before: before,
      proposals_after: after,
      narrative_check: { ok: narrative.ok, reason: narrative.reason },
    },
  };
}

// ── 3. injection payload in a policy sentence ──────────────────────────────

function attackPolicyText(exp: DecisionExport): AttackOutcome {
  const rule = exp.rules.rules.find((r) => r.id === 'budget_cap');
  if (!rule) {
    return {
      id: 'policy_text_injection', name: 'Inject an instruction into a policy sentence',
      attempted: 'rule budget_cap not present in the pinned rule set',
      defence: { check: 'Rule Checker', where: 'server/src/agents/rule-checker.ts' },
      blocked: false, detail: 'The synthetic sample carries no budget_cap rule, so this attack could not be run.', log_entry: {},
    };
  }
  const injected: Rule = {
    ...rule,
    snippet: [INJECTION_PROBES[0], INJECTION_PROBES[4], rule.snippet].filter(Boolean).join(' '),
    source: `${rule.source} ${INJECTION_PROBES[0]}`,
  };
  const subject: RuleSubject = { name: 'Over-budget candidate', fields: { unit_cost: (rule.value ?? 40) + 15 }, tags: [] };

  const clean = evaluateRule(rule, subject);
  const withInjection = evaluateRule(injected, subject);
  const verdict = itemVerdict(evaluateAll([injected], subject));
  // A policy sentence is data here: the verdict must not move when the text
  // around the numbers changes, and the rule must not be able to approve itself.
  const unchanged = clean.status === withInjection.status && clean.reason === withInjection.reason;
  const blocked = unchanged && verdict.rejected && verdict.first_failure?.rule_id === 'budget_cap';
  return {
    id: 'policy_text_injection',
    name: 'Inject an instruction into the policy sentence a rule is quoted from',
    attempted: `"${injected.snippet}"`,
    defence: { check: 'Deterministic Rule Checker — a verdict is computed from fields, never from prose, and no model is in this path', where: 'server/src/agents/rule-checker.ts:51' },
    blocked,
    detail: blocked
      ? `The instruction was read as text. The verdict is identical with and without it (${withInjection.status}: ${withInjection.reason}) and the item is still rejected.`
      : `The policy sentence changed the outcome: clean=${clean.status}, injected=${withInjection.status}, rejected=${verdict.rejected}.`,
    log_entry: {
      without_injection: { status: clean.status, reason: clean.reason },
      with_injection: { status: withInjection.status, reason: withInjection.reason },
      item_verdict: { rejected: verdict.rejected, first_failure: verdict.first_failure?.rule_id ?? null },
    },
  };
}

// ── 4. tamper a ledger row after it was written ────────────────────────────

function attackLedger(exp: DecisionExport): AttackOutcome {
  const entries = exp.ledger as LedgerEntry[];
  const intact = verifyLedger(entries);
  const target = entries[entries.length - 1];
  const forged: LedgerEntry = { ...target, action: target.action === 'approved' ? 'rejected' : 'approved', actor: `${target.actor} (edited)` };
  // The stored hash is deliberately left as it was — that is the whole attack.
  const broken = verifyLedger([...entries.slice(0, -1), forged]);
  const real = graph.readLedger();
  const realIntact = real.length ? verifyLedger(real).ok : null;

  const detected = !broken.ok && broken.first_broken_seq === forged.seq;
  const recomputed = ledgerHash({
    at: forged.at, action: forged.action, proposal_id: forged.proposal_id, pack: forged.pack,
    location: forged.location, actor: forged.actor, detail: forged.detail, prev_hash: forged.prev_hash,
  });
  return {
    id: 'ledger_tamper',
    name: 'Edit a ledger row after it was written, keeping its old hash',
    attempted: `change entry seq ${target.seq} from "${target.action}" by "${target.actor}" to "${forged.action}" and leave hash ${target.hash.slice(0, 16)}… in place`,
    defence: { check: 'Hash chain recompute — every entry is re-hashed from its content and re-linked to its predecessor', where: 'server/src/graph/store.ts:210' },
    blocked: detected && intact.ok && realIntact !== false,
    detail: detected
      ? `Verification stopped at seq ${broken.first_broken_seq}: the edited content re-hashes to ${recomputed.slice(0, 16)}… but the row still carries ${target.hash.slice(0, 16)}… The unedited copy verifies end to end, and the stored ledger was only read.`
      : `An edited row passed chain verification (${broken.ok ? 'chain reported intact' : `chain broke at seq ${broken.first_broken_seq}, not the edited row`}).`,
    log_entry: {
      stored_hash: target.hash,
      recomputed_hash: recomputed,
      first_broken_seq: broken.first_broken_seq,
      reason: broken.reason,
      unedited_copy_verifies: intact.ok,
      stored_ledger_read_only: true,
      stored_ledger_still_intact: realIntact,
    },
  };
}

// ── 5. breach the room's budget rule ───────────────────────────────────────

function attackBudget(exp: DecisionExport): AttackOutcome {
  const rule = exp.rules.rules.find((r) => r.id === 'budget_cap') ?? exp.rules.rules[0];
  const ceiling = rule.value ?? 40;
  const subject: RuleSubject = { name: 'Expensive candidate', fields: { [rule.field ?? 'unit_cost']: ceiling + 15 }, tags: [] };
  const result: RuleResult = evaluateRule(rule, subject);
  const verdict = itemVerdict([result]);
  const blocked = result.status === 'fail' && verdict.rejected && result.observed !== undefined && result.threshold === ceiling;
  return {
    id: 'budget_exceeded',
    name: 'Offer an item that breaks the room\'s budget ceiling',
    attempted: `${rule.field} = ${ceiling + 15} against ${rule.source} ("${rule.snippet ?? rule.id}")`,
    defence: { check: `Rule Checker ${rule.kind} against the SOP line the rule cites`, where: 'server/src/agents/rule-checker.ts:59' },
    blocked,
    detail: blocked
      ? `Refused before it could be shown: ${result.reason}. The ceiling is read from ${result.source}; the item is rejected rather than quietly repriced.`
      : `An over-ceiling ${rule.field} was not rejected (status ${result.status}).`,
    log_entry: {
      rule_id: result.rule_id, status: result.status, reason: result.reason,
      observed: result.observed, threshold: result.threshold, source: result.source,
      item_rejected: verdict.rejected,
    },
  };
}

// ── 6. send a parameter Qloo has never verified ────────────────────────────

function attackAllowlist(): AttackOutcome {
  const endpoint = '/v2/insights';
  const params = { 'filter.type': 'urn:entity:artist', take: 25, filter_popularity: 0.9, signal_interests: 'qloo:brand:nike' };
  const callsBefore = networkCallCount();
  let violation: { param: string; detail: string } | null = null;
  try {
    assertAllowed(endpoint, params);
  } catch (e) {
    if (e instanceof AllowlistViolation) violation = { param: e.param, detail: e.message };
    else throw e;
  }
  const callsAfter = networkCallCount();
  const blocked = !!violation && callsAfter === callsBefore;
  return {
    id: 'unverified_parameter',
    name: 'Send a parameter outside the verified allowlist',
    attempted: `GET ${endpoint} with ${Object.keys(params).join(', ')} — two of them invented, spelled with underscores`,
    defence: { check: 'Parameter allowlist — an unverified name is refused and recorded before the request is built', where: 'server/src/qloo/allowlist.ts:82' },
    blocked,
    detail: violation
      ? `Refused before it left: ${violation.detail}. Bytes crossed no wire — the outbound-call counter reads ${callsAfter} both before and after.`
      : `The request was built with unverified parameters and would have gone out; Qloo ignores parameters it does not know, so the answer would have looked filtered while being unfiltered.`,
    log_entry: {
      endpoint,
      refused_param: violation?.param ?? null,
      sent_names: Object.keys(params),
      recognised_on_this_endpoint: Object.keys(params).filter((k) => allowlistFor(endpoint).includes(k)),
      network_calls_before: callsBefore,
      network_calls_after: callsAfter,
    },
  };
}

// The six buttons. Order is the order the page lists them in.
const ATTACKS: { id: string; run: (exp: DecisionExport) => AttackOutcome }[] = [
  { id: 'unsupported_item', run: attackUnsupportedItem },
  { id: 'entity_name_injection', run: attackEntityName },
  { id: 'policy_text_injection', run: attackPolicyText },
  { id: 'ledger_tamper', run: attackLedger },
  { id: 'budget_exceeded', run: attackBudget },
  { id: 'unverified_parameter', run: () => attackAllowlist() },
];

/** Run all six attacks against the real defences. Synchronous and side-effect
 *  free apart from reads, so the tests and the page see the same thing. */
export function runAllAttacks(): BreakItReport {
  const exp = loadSample();
  const before = networkCallCount();
  const attacks = ATTACKS.map((a) => a.run(exp));
  const after = networkCallCount();
  const real = graph.readLedger();
  const blocked = attacks.filter((a) => a.blocked).length;
  return {
    ran_at: new Date().toISOString(),
    sandbox: {
      basis: 'verification/sample-export.json — a synthetic Replay run; the stored ledger and cache were opened read-only',
      mode: 'replay',
      real_ledger_written: false,
      real_ledger_still_intact: real.length ? verifyLedger(real).ok : null,
      network_calls_before: before,
      network_calls_after: after,
    },
    blocked,
    total: attacks.length,
    ok: blocked === attacks.length,
    attacks,
  };
}

/** One attack, for the button that fires it. Returns null for an unknown id
 *  rather than guessing which attack the visitor meant. */
export function runAttack(id: string): AttackOutcome | null {
  const def = ATTACKS.find((a) => a.id === id);
  return def ? def.run(loadSample()) : null;
}

export const ATTACK_IDS = ATTACKS.map((a) => a.id);
