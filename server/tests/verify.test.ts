// W1 Verifier tests. The acceptance bar in the PRD is not "the checks pass" but
// "a tampered export fails at the exact altered record", so every forgery here
// asserts which record is named, not merely that something failed.

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runPipeline, decide } from '../src/agents/pipeline';
import { exportFromStore } from '../src/verify/buildFromStore';
import { verifyExport, type VerifyCheck } from '../src/verify/verifier';
import { DECISION_EXPORT_SCHEMA, exportAllowedForMode, rulesPinnedVersion } from '../src/verify/export';
import type { DecisionExport } from '../src/verify/export';

const SAMPLE = path.join(__dirname, '..', 'verification', 'sample-export.json');

function check(report: { checks: VerifyCheck[] }, id: string): VerifyCheck {
  const c = report.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check with id ${id}`);
  return c;
}

/** A deep copy, because every forgery test must mutate a throwaway object. */
function forge(mutate: (exp: DecisionExport) => void): DecisionExport {
  const clone = JSON.parse(JSON.stringify(baseExport)) as DecisionExport;
  mutate(clone);
  return clone;
}

let baseExport: DecisionExport;

beforeAll(async () => {
  const proposal = await runPipeline({ pack: 'retail', location: 'store_3', goal: 'Add 4 brands for spring', mode: 'replay' });
  const decided = decide(proposal, 'approved', 'Test Approver', {});
  if (decided.error) throw new Error(`test decision refused: ${decided.error}`);
  baseExport = exportFromStore(proposal.proposal_id);
});

describe('the committed sample export', () => {
  it('is a real export file and it verifies 5/5', () => {
    const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8')) as DecisionExport;
    expect(raw.schema).toBe(DECISION_EXPORT_SCHEMA);
    const report = verifyExport(raw);
    expect(report.error).toBeNull();
    expect(report.checks).toHaveLength(5);
    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
  });

  it('carries no live Qloo payload — it was generated from Replay fixtures', () => {
    const raw = JSON.parse(fs.readFileSync(SAMPLE, 'utf8')) as DecisionExport;
    expect(raw.provenance.decision_mode).toBe('replay');
    expect(raw.honest_scope.proves.length).toBeGreaterThan(0);
    expect(raw.honest_scope.does_not_prove.join(' ')).toMatch(/Qloo/);
  });
});

describe('a freshly built export', () => {
  it('passes all five checks', () => {
    const report = verifyExport(baseExport);
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
  });

  it('names the rule set it pinned, and the pin is content-derived', () => {
    expect(baseExport.rules.pinned_version).toBe(rulesPinnedVersion(baseExport.rules.rules));
    expect(verifyExport(baseExport).checks.find((c) => c.id === 'rules')?.detail).toContain(baseExport.rules.pinned_version.slice(0, 16));
  });

  it('refuses a file that is not an export', () => {
    const report = verifyExport({ hello: 'world' });
    expect(report.ok).toBe(false);
    expect(report.error).toContain(DECISION_EXPORT_SCHEMA);
  });
});

describe('live data cannot be exported', () => {
  it('permits Replay only', () => {
    expect(exportAllowedForMode('replay').ok).toBe(true);
    expect(exportAllowedForMode('live').ok).toBe(false);
    expect(exportAllowedForMode('cached').ok).toBe(false);
    expect(exportAllowedForMode('live').reason).toMatch(/until Qloo confirms/i);
  });

  it('still refuses when the proposal badge says live but no override is given', () => {
    const live = forge((exp) => { exp.decision.mode = 'live'; });
    const report = verifyExport(live);
    // The modes check now fails: a live badge with not one live step is the exact
    // overstatement the PRD forbids.
    expect(check(report, 'modes').status).toBe('fail');
    expect(check(report, 'modes').detail).toMatch(/badge says live/);
  });
});

describe('each forgery fails at the record that was altered', () => {
  it('check 1 — an edited ledger entry breaks the chain at its own seq', () => {
    const tampered = forge((exp) => {
      exp.ledger[0].detail = { ...exp.ledger[0].detail, forged: 'approved by nobody' };
    });
    const c = check(verifyExport(tampered), 'chain');
    expect(c.status).toBe('fail');
    expect(c.first_failing).toBe(`seq ${tampered.ledger[0].seq}`);
    expect(c.detail).toMatch(/does not match its recorded hash/);
  });

  it('check 1 — a stale head hash is caught even with a re-forged chain', () => {
    const tampered = forge((exp) => { exp.ledger_head_hash = 'f'.repeat(64); });
    const c = check(verifyExport(tampered), 'chain');
    expect(c.status).toBe('fail');
    expect(c.first_failing).toBe('ledger_head_hash');
  });

  it('check 2 — an invented entity id is named, not silently dropped', () => {
    const tampered = forge((exp) => { exp.decision.items[0].entity_id = 'qloo:artist:invented_by_nobody'; });
    const c = check(verifyExport(tampered), 'qloo_ids');
    expect(c.status).toBe('fail');
    expect(c.first_failing).toBe('qloo:artist:invented_by_nobody');
    expect(c.detail).toMatch(/not among the \d+ stored evidence id/);
  });

  it('check 3 — re-sorting the list by anything other than Qloo order is caught', () => {
    const tampered = forge((exp) => {
      exp.decision.items.reverse();
      exp.decision.items.forEach((it, i) => { it.rank = i + 1; });
    });
    const c = check(verifyExport(tampered), 'ranking');
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/Qloo's order puts/);
    expect(c.first_failing).toBeTruthy();
  });

  it('check 3 — a claimed Qloo rank that the evidence set disagrees with is caught', () => {
    const tampered = forge((exp) => { exp.decision.items[0].qloo_rank = 999; });
    const c = check(verifyExport(tampered), 'ranking');
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/but the evidence set has it at/);
  });

  it('check 4 — flipping one rule verdict is caught on that item and rule', () => {
    // Shown items rarely carry a 'fail' (the Auditor rejects those into
    // rejections), so the forgery flips away from whatever was recorded.
    const item = baseExport.decision.items[0];
    const stored = item.rule_results[0];
    const flipped = stored.status === 'fail' ? 'pass' : 'fail';
    const tampered = forge((exp) => {
      const rr = exp.decision.items.find((it) => it.entity_id === item.entity_id)!.rule_results.find((r) => r.rule_id === stored.rule_id)!;
      rr.status = flipped as typeof rr.status;
      rr.pass = flipped === 'pass';
    });
    const c = check(verifyExport(tampered), 'rules');
    expect(c.status).toBe('fail');
    expect(c.first_failing).toBe(`${item.entity_id}/${stored.rule_id}`);
    expect(c.detail).toContain(`re-evaluates to "${stored.status}"`);
  });

  it('check 4 — a verdict citing a rule outside the pinned set is caught', () => {
    const tampered = forge((exp) => { exp.decision.items[0].rule_results[0].rule_id = 'rule_that_was_never_shipped'; });
    const c = check(verifyExport(tampered), 'rules');
    expect(c.status).toBe('fail');
    expect(c.first_failing).toContain('rule_that_was_never_shipped');
  });

  it('check 4 — editing an operator term without editing the verdict is caught', () => {
    // A passing numeric_max ceiling is the cleanest forgery: move the number past
    // the ceiling and the recorded 'pass' can no longer be recomputed.
    let target: { entity_id: string; metric: string; threshold: number } | null = null;
    for (const it of baseExport.decision.items) {
      const rr = it.rule_results.find((r) => r.status === 'pass' && r.direction === 'max' && typeof r.threshold === 'number' && r.metric && !r.metric.startsWith('qloo_'));
      if (rr) { target = { entity_id: it.entity_id, metric: rr.metric!, threshold: rr.threshold! }; break; }
    }
    expect(target, 'the sample run needs a passing numeric ceiling to forge against').toBeTruthy();
    const tampered = forge((exp) => {
      const subject = exp.rule_subjects.find((s) => s.entity_id === target!.entity_id)!;
      subject.fields[target!.metric] = target!.threshold + 1;
    });
    const c = check(verifyExport(tampered), 'rules');
    expect(c.status).toBe('fail');
    expect(c.first_failing).toContain(target!.entity_id);
    expect(c.detail).toMatch(/exceeds the ceiling/);
  });

  it('check 5 — a step stripped of its mode is named by position', () => {
    const tampered = forge((exp) => { delete (exp.decision.trace.steps[3] as { mode?: string }).mode; });
    const c = check(verifyExport(tampered), 'modes');
    expect(c.status).toBe('fail');
    expect(c.first_failing).toBe('step 4');
  });

  it('leaves the real store untouched while all that forging happens', () => {
    const report = verifyExport(exportFromStore(baseExport.provenance.proposal_id));
    expect(report.ok).toBe(true);
  });
});
