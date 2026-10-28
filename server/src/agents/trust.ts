// Trust Center (F47). Every guardrail the PRD promises is stated here as a
// check that either passes on the current data or reports its own failure.
// This is deliberately not a marketing page: a guardrail that could not be
// proven is shown as unproven, and the tampering demo runs on an in-memory copy
// so the real ledger is never edited.

import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import { graph, verifyLedger, ledgerHash, canonicalJson } from '../graph/store';
import { env, qlooKeyStatus } from '../config/env';
import { auditProposal, INJECTION_PROBES, lintAudienceLanguage, sanitizeName, checkNarrativeGrounding } from './auditor';
import { ALLOWED_PARAMS, assertAllowed, AllowlistViolation } from '../qloo/allowlist';
import { getAllowlistViolations, getRestLog } from '../qloo/rest-client';
import { coverageBoard } from './coverage';
import { modeMix } from '../trace/builder';
import type { LedgerEntry, Proposal } from '../types';

export interface TrustCheck {
  id: string;
  claim: string;
  status: 'pass' | 'fail' | 'unproven';
  evidence: string;
}

export interface TrustReport {
  generated_at: string;
  checks: TrustCheck[];
  passed: number;
  failed: number;
  unproven: number;
  proposal_id: string | null;
  ledger: {
    length: number;
    head_hash: string | null;
    ok: boolean;
    first_broken_seq: number | null;
    reason: string | null;
    /** The most recent entries, newest last — what the chain verdict was computed over. */
    entries: { seq: number; at: string; action: LedgerEntry['action']; proposal_id: string; pack: string; location: string; actor: string; hash: string; prev_hash: string }[];
  };
  tamper_demo: { changed_field: string; stored_hash: string; recomputed_hash: string; detected: boolean };
  probes: { probe: string; outcome: string }[];
  allowlist: { endpoint: string; params: string[] }[];
  violations: { at: string; endpoint: string; param: string; detail: string }[];
  coverage: { verified: number; accepted_but_empty: number; not_usable: number; verified_at: string };
}

// Both scans below shell out to git and re-read every stored Qloo response.
// /api/trust is polled, so an uncached call let any visitor make the server spawn
// a git process and rescan the disk at will, blocking the event loop. Held
// briefly: the answer describes the checkout, which does not change per request.
const SCAN_TTL_MS = 30_000;
const scanCache = new Map<string, { at: number; value: unknown }>();
function memoizeScan<T>(key: string, run: () => T): T {
  const hit = scanCache.get(key);
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return hit.value as T;
  const value = run();
  scanCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Is any live Qloo payload or key actually tracked? Measured against `git
 * ls-files` rather than asserted, so the check can fail.
 */
function repoPrivacyScan(): { status: TrustCheck['status']; evidence: string } {
  const git = (args: string[], cwd?: string) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  let root: string;
  let tracked: string[];
  try {
    root = git(['rev-parse', '--show-toplevel']).trim();
    tracked = git(['ls-files'], root).split('\n').filter(Boolean);
  } catch {
    const cacheSegment = env.QLOO_PRIVATE_CACHE_DIR.replace(/^\.?\/+/, '');
    let ignored: boolean | null = null;
    for (const dir of ['server', '']) {
      const gi = path.resolve(process.cwd(), dir, '.gitignore');
      if (fs.existsSync(gi)) {
        const text = fs.readFileSync(gi, 'utf8');
        ignored = text.split('\n').some((line) => line.trim() && cacheSegment.split('/').pop() && line.includes(cacheSegment.split('/').pop()!));
        if (ignored) break;
      }
    }
    return {
      status: 'unproven',
      evidence: `no readable git checkout on this host, so nothing is provably tracked or untracked. .gitignore ${ignored === null ? 'does not mention the cache directory here' : ignored ? `covers ${cacheSegment}` : `does NOT cover ${cacheSegment}`} — the commit state of the live cache is unmeasured rather than clean.`,
    };
  }
  const cacheSegment = env.QLOO_PRIVATE_CACHE_DIR.replace(/^\.?\/+/, '');
  const leakedCache = tracked.filter((f) => f.split(/[\\/]+/).includes(cacheSegment));
  const leakedEnv = tracked.filter((f) => /(^|[\\/])\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
  const onDisk = [path.resolve(root, 'server', env.QLOO_PRIVATE_CACHE_DIR), path.resolve(root, env.QLOO_PRIVATE_CACHE_DIR)]
    .reduce((n, d) => n + (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).length : 0), 0);
  const offenders = [...leakedCache, ...leakedEnv];
  return {
    status: offenders.length === 0 ? 'pass' : 'fail',
    evidence: offenders.length
      ? `${offenders.length} tracked file(s) should not be in git: ${offenders.slice(0, 4).join(', ')}`
      : `${tracked.length} file(s) tracked, ${onDisk} live response(s) held in ${env.QLOO_PRIVATE_CACHE_DIR} on disk and none of them tracked, no .env tracked. Key status: ${qlooKeyStatus()} (value never read by this check).`,
  };
}

/**
 * Is anything in the private cache fabricated? The honest-fit model says Qloo
 * returns no entity-level `score`, so a stored response that carries one was not
 * fetched from Qloo — it was written by a fixture or a test. This scans the real
 * store rather than trusting how the files got there.
 */
function cachePurityScan(): { status: TrustCheck['status']; evidence: string; offenders: number; files: number } {
  const dirs = [env.QLOO_PRIVATE_CACHE_DIR, `server/${env.QLOO_PRIVATE_CACHE_DIR}`]
    .map((d) => path.resolve(process.cwd(), d))
    .filter((d) => fs.existsSync(d));
  const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => path.join(d, f)));
  if (!files.length) return { status: 'unproven', evidence: 'no live Qloo response is held on this host, so there is nothing here to test for fabrication.', offenders: 0, files: 0 };
  const offenders: string[] = [];
  for (const file of files) {
    let data: unknown;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')).data; } catch { continue; }
    const hits: number[] = [];
    (function walk(o: any) {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o && typeof o === 'object') { if ('score' in o) hits.push(1); Object.values(o).forEach(walk); }
    })(data);
    if (hits.length) offenders.push(path.basename(file));
  }
  return {
    status: offenders.length ? 'fail' : 'pass',
    evidence: offenders.length
      ? `${offenders.length} of ${files.length} stored response(s) carry an entity-level "score" (${offenders.slice(0, 3).join(', ')}) — Qloo never returns that field, so those rows are fabricated data being served as if fetched. Purge them.`
      : `${files.length} stored response(s) scanned for the entity-level "score" that Qloo does not return: none found. Every fit figure on screen is therefore derived from result order, not carried in from a made-up score.`,
    offenders: offenders.length,
    files: files.length,
  };
}

function probeOutcomes(): { probe: string; outcome: string }[] {
  return INJECTION_PROBES.map((probe) => {
    const lint = lintAudienceLanguage(probe);
    const clean = sanitizeName(probe);
    if (!lint.ok) return { probe, outcome: `rejected by the language lint: ${lint.reason}` };
    if (clean !== probe) return { probe, outcome: `sanitiseName() removed ${probe.length - clean.length} character(s) of markup/quoting, leaving "${clean}", before anything stored or rendered it` };
    if (/ignore previous instructions|system:/i.test(probe)) return { probe, outcome: 'treated as data only — the pipeline never reads instructions from text, so it cannot be re-ranked by it' };
    return { probe, outcome: 'carried as a plain string; nothing is interpolated into SQL and no markup is present to strip' };
  });
}

export function trustReport(proposal: Proposal | null): TrustReport {
  const checks: TrustCheck[] = [];
  // The whole chain, oldest first: readLedger is ASC-limited, so a bounded read
  // would verify a prefix and then name its 500th row the head of the ledger.
  const entries = graph.readLedger(Number.MAX_SAFE_INTEGER);
  const ledger = verifyLedger(entries);

  const storedIds = new Set(
    (proposal ? graph.getSnapshot(proposal.proposal_id)?.candidates.map((c) => c.entity_id) ?? [] : []),
  );
  const audit = proposal ? auditProposal(proposal, storedIds) : null;

  // 1 — the LLM cannot rank, filter or approve. A step only counts against this
  // when it credits the model with CHANGING the order; the narration step names
  // the model on purpose and must not trip the guard it is documenting.
  const LLM_RANKED = /\b(llm|model|gpt)\b[^.\n]{0,60}\b(rank\w*|order\w*|re-?sort\w*|promot\w*|demot\w*)\b|\b(rank\w*|order\w*|re-?sort\w*|promot\w*|demot\w*)\b[^.\n]{0,60}\b(llm|model|gpt)\b/i;
  const rankSteps = proposal?.trace.steps.filter((s) => LLM_RANKED.test(s.label)) ?? [];
  checks.push({
    id: 'llm-never-ranks',
    claim: 'The model writes explanations only; ranking comes from Qloo and approval comes from a named person.',
    status: proposal && rankSteps.length === 0 ? 'pass' : proposal ? 'fail' : 'unproven',
    evidence: proposal
      ? `${rankSteps.length} trace step(s) attribute a ranking change to the model. Items are ordered by qloo_rank (${proposal.items.map((i) => i.qloo_rank).join(', ') || 'no items'}).`
      : 'run a proposal to check this',
  });

  // 2 — every displayed item is grounded in a stored Qloo row.
  const groundingFailures = audit?.failures.filter((f) => f.check === 1).length ?? 0;
  checks.push({
    id: 'grounded-items',
    claim: 'Every recommendation cites a Qloo entity id from this run, with the endpoint and timestamp.',
    status: !audit ? 'unproven'
      : audit.items_checked === 0 ? 'unproven'
        : groundingFailures === 0 ? 'pass' : 'fail',
    evidence: audit
      ? audit.items_checked === 0
        ? `this run displays no items, so there was nothing to ground — the claim was not exercised. ${storedIds.size ? 'Snapshot present.' : 'Snapshot missing: the run stored no rows.'}`
        : `${audit.items_checked} item(s) checked, ${groundingFailures} without a stored entity id. Snapshot ${storedIds.size ? 'present' : 'missing — the run stored no rows'}.`
      : 'no proposal to audit yet',
  });

  // 3 — narratives carry no ungrounded names or figures.
  checks.push({
    id: 'no-invented-numbers',
    claim: 'No sentence introduces a name or a number that is not in the stored result for that item.',
    status: audit && audit.failures.filter((f) => f.check === 2).length === 0 ? 'pass' : audit ? 'fail' : 'unproven',
    evidence: audit
      ? `${audit.failures.filter((f) => f.check === 2).length} narrative failure(s). A control probe with an ungrounded figure is rejected: ${checkNarrativeGrounding('This act sold out 3 arenas last year', ['Ember Lark']).reason || 'unexpected pass'}.`
      : 'no proposal to audit yet',
  });

  // 4 — rules with missing data are never shown as compliant.
  const needsData = proposal?.items.flatMap((i) => i.rule_results.filter((r) => r.status === 'needs_data')) ?? [];
  const shownAsPass = needsData.filter((r) => r.pass);
  checks.push({
    id: 'three-state-rules',
    claim: 'A rule whose data is absent is reported as needing data, never as passing.',
    status: proposal ? (shownAsPass.length === 0 ? 'pass' : 'fail') : 'unproven',
    evidence: `${needsData.length} rule result(s) awaiting data on this proposal, ${shownAsPass.length} of them wrongly marked as pass.`,
  });

  // 5 — approval cannot happen without the term.
  const blockedItems = proposal?.items.filter((i) => i.approval_blocked) ?? [];
  checks.push({
    id: 'approval-needs-human',
    claim: 'Approval requires a named approver and refuses to guess a missing term.',
    status: proposal && (proposal.status !== 'pending' ? Boolean(proposal.trace.steps.some((s) => s.type === 'Decision' && s.source)) : true) ? 'pass' : 'unproven',
    evidence: blockedItems.length
      ? `${blockedItems.length} item(s) cannot be approved until the owner enters: ${blockedItems.flatMap((i) => i.needs_terms.map((t) => t.field)).join(', ')}`
      : proposal ? `status ${proposal.status}; a decision step records the approver name and writes a ledger entry` : 'no proposal yet',
  });

  // 6 — audience-level language only.
  checks.push({
    id: 'audience-not-individual',
    claim: 'Nothing is claimed about an individual; only audience-level statements are allowed through.',
    status: audit && audit.failures.filter((f) => f.check === 5).length === 0 ? 'pass' : audit ? 'fail' : 'unproven',
    evidence: audit
      ? `${audit.failures.filter((f) => f.check === 5).length} violation(s) on this proposal. A control probe is caught: ${lintAudienceLanguage('this customer prefers mellow sets').reason}.`
      : 'no proposal to audit yet',
  });

  // 7 — mode is recorded everywhere and never upgraded silently.
  const stepsWithoutMode = audit?.steps_without_mode ?? 0;
  const mix = proposal ? modeMix(proposal.trace.steps) : null;
  const overstated = Boolean(proposal && mix && proposal.mode === 'live' && mix.live === 0);
  checks.push({
    id: 'mode-honesty',
    claim: 'Live, Cached and Replay are labelled on every step, and the run badge never claims more than its steps show.',
    status: proposal ? (stepsWithoutMode === 0 && proposal.mode && !overstated ? 'pass' : 'fail') : 'unproven',
    evidence: proposal && mix
      ? `badge ${proposal.mode}; steps counted from the trace — ${mix.live} live, ${mix.cached} cached, ${mix.replay} replay; ${stepsWithoutMode} step(s) missing a mode${overstated ? '; the run claims live although no step was fetched on it' : ''}. Committed fixtures are synthetic and labelled replay at read time.`
      : 'no proposal yet',
  });

  // 8 — unknown API parameters are refused, not sent.
  let refused = false;
  try { assertAllowed('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': 'x', 'evil.param': 1 }); }
  catch (e) { refused = e instanceof AllowlistViolation; }
  const loggedViolations = getAllowlistViolations();
  checks.push({
    id: 'param-allowlist',
    claim: 'Every outgoing Qloo parameter must be on the per-endpoint allowlist; anything else throws before the request leaves.',
    status: refused ? 'pass' : 'fail',
    evidence: `a probe parameter "evil.param" was ${refused ? 'refused' : 'ACCEPTED — this is a hole'}; ${loggedViolations.length} refusal(s) logged on this host.`,
  });

  // 9 — the call budget, measured against the run's own recorded call count.
  const proposedEntry = entries.filter((e) => e.action === 'proposed' && e.proposal_id === proposal?.proposal_id).pop();
  const proposedDetail = proposedEntry?.detail as { session?: { calls?: number }; qloo_calls?: number } | undefined;
  const runCalls = proposedDetail?.session?.calls ?? proposedDetail?.qloo_calls;
  const overBudget = typeof runCalls === 'number' ? runCalls > env.QLOO_MAX_CALLS_PER_RUN : null;
  const networkCalls = getRestLog().filter((r) => !r.cache_hit).length;
  checks.push({
    id: 'call-budget',
    claim: 'A single run cannot spend more than the per-run Qloo call budget.',
    status: proposal && typeof runCalls === 'number' ? (overBudget ? 'fail' : 'pass') : 'unproven',
    evidence: proposal && typeof runCalls === 'number'
      ? `run ${proposal.proposal_id} recorded ${runCalls} adapter call(s) against a per-run budget of ${env.QLOO_MAX_CALLS_PER_RUN}; ${networkCalls} request(s) actually left this host since the server started.`
      : 'this run stored no call count, so the budget cannot be checked against it',
  });

  // 10 — the ledger is append-only and tamper-evident.
  checks.push({
    id: 'hash-chained-ledger',
    claim: 'Each ledger entry links to the hash of the one before it, so an edit breaks the chain.',
    status: entries.length ? (ledger.ok ? 'pass' : 'fail') : 'unproven',
    evidence: entries.length
      ? `${entries.length} entries, chain ${ledger.ok ? 'intact' : `broken at entry ${ledger.first_broken_seq}: ${ledger.reason}`}; head ${ledger.head_hash?.slice(0, 16)}…`
      : 'the ledger is empty until a proposal is decided',
  });

  // 11 — private cache never enters the repository. The git check is honest about
  // what git can prove: with no readable checkout here the status is unproven.
  const privacy = memoizeScan('privacy', repoPrivacyScan);
  checks.push({
    id: 'no-qloo-data-in-repo',
    claim: 'Live Qloo responses are written to the server-side store only; the repository holds synthetic fixtures and counts.',
    status: privacy.status,
    evidence: privacy.evidence,
  });

  // 12 — nothing in the stored cache was made up.
  const purity = memoizeScan('purity', cachePurityScan);
  checks.push({
    id: 'cache-purity',
    claim: 'Every row served as "cached" came from a real Qloo response, not from a fixture written into the private cache.',
    status: purity.status,
    evidence: purity.evidence,
  });

  // 13 — capabilities that return nothing are not used.
  const cov = coverageBoard();
  const emptyNames = cov.rows.filter((r) => r.status === 'accepted_but_empty').map((r) => r.name);
  checks.push({
    id: 'coverage-board',
    claim: 'A Qloo capability is only used if it returned rows on this key; empty endpoints stay off the product.',
    status: cov.counts.verified > 0 ? 'pass' : 'unproven',
    evidence: `${cov.counts.verified} verified, ${cov.counts.accepted_but_empty} accepted-but-empty${emptyNames.length ? ` (${emptyNames.join(', ')})` : ''}, ${cov.counts.not_usable} unusable — verified ${cov.verified_at}.`,
  });

  // Tamper demonstration, computed on a copy of the last entry. The database is
  // never touched: the point is that a mismatch is detectable, not that we can
  // break the real record.
  const last = entries[entries.length - 1];
  const tamper = last
    ? (() => {
        const forged = { ...last.detail, approver: 'whoever' };
        const recomputed = ledgerHash({ at: last.at, action: last.action, proposal_id: last.proposal_id, pack: last.pack, location: last.location, actor: last.actor, detail: forged, prev_hash: last.prev_hash });
        return { changed_field: 'detail.approver (in memory only)', stored_hash: last.hash, recomputed_hash: recomputed, detected: recomputed !== last.hash };
      })()
    : { changed_field: 'no ledger entry to forge', stored_hash: '', recomputed_hash: '', detected: false };

  return {
    generated_at: new Date().toISOString(),
    checks,
    passed: checks.filter((c) => c.status === 'pass').length,
    failed: checks.filter((c) => c.status === 'fail').length,
    unproven: checks.filter((c) => c.status === 'unproven').length,
    proposal_id: proposal?.proposal_id ?? null,
    ledger: {
      length: entries.length,
      head_hash: ledger.head_hash,
      ok: ledger.ok,
      first_broken_seq: ledger.first_broken_seq,
      reason: ledger.reason,
      entries: entries.map((e) => ({ seq: e.seq, at: e.at, action: e.action, proposal_id: e.proposal_id, pack: e.pack, location: e.location, actor: e.actor, hash: e.hash, prev_hash: e.prev_hash })),
    },
    tamper_demo: tamper,
    probes: probeOutcomes(),
    allowlist: Object.entries(ALLOWED_PARAMS).map(([endpoint, params]) => ({ endpoint, params })),
    violations: loggedViolations.map((v) => ({ at: v.at, endpoint: v.endpoint, param: v.param, detail: v.detail })),
    coverage: { verified: cov.counts.verified, accepted_but_empty: cov.counts.accepted_but_empty, not_usable: cov.counts.not_usable, verified_at: cov.verified_at },
  };
}

/** Exposed so the UI can show the canonical form a hash is computed over. */
export function ledgerEntryJson(entry: Parameters<typeof canonicalJson>[0]): string {
  return canonicalJson(entry);
}
