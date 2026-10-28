// Governance spine: the hash-chained ledger, run snapshots, Finals Mode, the
// ablation arms, what-if, why-not, approval blocking and the Trust Center.
// Everything here runs offline in Replay mode against the synthetic fixtures.

import { describe, it, expect, beforeAll } from 'vitest';
import { runPipeline, runFromSnapshot, decide } from '../src/agents/pipeline';
import { graph, verifyLedger, ledgerHash } from '../src/graph/store';
import { computeAblation } from '../src/agents/ablation';
import { whatIf } from '../src/agents/whatif';
import { whyNot } from '../src/agents/whynot';
import { approvalBrief } from '../src/agents/brief';
import { trustReport } from '../src/agents/trust';
import { coverageBoard } from '../src/agents/coverage';
import { findOffer } from '../src/packs/loader';
import type { Proposal } from '../src/types';

let proposal: Proposal;
let snapshot: NonNullable<ReturnType<typeof graph.getSnapshot>>;

beforeAll(async () => {
  proposal = await runPipeline({ pack: 'venues', location: 'venue_redroom', goal: 'Book 2 acts for autumn', mode: 'replay' });
  const s = graph.getSnapshot(proposal.proposal_id);
  if (!s) throw new Error('the run stored no snapshot');
  snapshot = s;
});

describe('Decision ledger (F15)', () => {
  it('links every entry to the previous hash, so the chain verifies', () => {
    const entries = graph.readLedger(500);
    expect(entries.length).toBeGreaterThan(0);
    const v = verifyLedger(entries);
    expect(v.ok).toBe(true);
    expect(v.first_broken_seq).toBeNull();
    expect(v.head_hash).toBe(entries[entries.length - 1].hash);
  });

  it('detects a rewritten entry, and a re-forged chain, too', async () => {
    // Two entries minimum, so the back-pointer check has something to check.
    await runPipeline({ pack: 'venues', location: 'venue_redroom', goal: 'second run', mode: 'replay' });
    const entries = graph.readLedger(500);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const forged = entries.map((e) => ({ ...e }));

    // 1. Edit the content and leave the chain alone: the hash stops matching.
    forged[0].detail = { ...forged[0].detail, tampered: 'the owner approved it' };
    expect(verifyLedger(forged).ok).toBe(false);
    expect(verifyLedger(forged).reason).toContain('does not match its recorded hash');
    // The database itself was never touched.
    expect(graph.readLedger(500)[0].detail.tampered).toBeUndefined();

    // 2. Re-hash the edited entry and re-point its neighbour: the neighbour's own
    //    hash was made over the old back-pointer, so verification still breaks.
    forged[0].hash = ledgerHash(forged[0] as any);
    forged[1] = { ...forged[1], prev_hash: forged[0].hash };
    const relayed = verifyLedger(forged);
    expect(relayed.ok).toBe(false);
    expect(relayed.first_broken_seq).toBe(forged[1].seq);
  });

  it('a bounded read keeps the newest end, so the head is never hidden', () => {
    for (let i = 0; i < 5; i++) {
      graph.appendLedger({
        at: new Date().toISOString(), action: 'proposed', proposal_id: `p_window_${i}`,
        pack: 'venues', location: 'venue_redroom', actor: 'operator:test', detail: { window: i },
      });
    }
    const window = graph.readLedger(3);
    expect(window.length).toBe(3);
    // Oldest first inside the window, and the window ends at the real head.
    expect(window.map((e) => e.seq)).toEqual([window[0].seq, window[0].seq + 1, window[0].seq + 2]);
    expect(window[2].hash).toBe(graph.headHash());
    // A slice that starts above entry 1 cannot claim the older links: it says so.
    const v = verifyLedger(window);
    expect(v.ok).toBe(true);
    expect(v.partial).toBe(true);
    // Tampering with the newest entry is inside the window, and is caught there.
    const forged = window.map((e) => ({ ...e }));
    forged[2].detail = { ...forged[2].detail, tampered: true };
    expect(verifyLedger(forged).ok).toBe(false);
  });
});

describe('Run snapshots and Finals Mode (F48)', () => {
  it('stores the Qloo rows, rules and comparison variants, and reruns with no live call', () => {
    expect(snapshot.candidates.length).toBeGreaterThan(0);
    expect(snapshot.rules.length).toBeGreaterThan(0);
    expect(Object.keys(snapshot.variants)).toContain('no_location');
    const again = runFromSnapshot({ pack: 'venues', location: 'venue_redroom', goal: 'Book 2 acts for autumn', snapshot_id: snapshot.proposal_id });
    expect(again).not.toBeNull();
    // Stored data is never re-labelled as live.
    expect(again!.mode).not.toBe('live');
    expect(again!.trace.steps[0].label).toContain('Finals Mode');
    expect(again!.items.map((i) => i.name)).toContain('DJ Marlow');
    expect(again!.items.map((i) => i.name)).not.toContain('Vex');
  });

  it('returns nothing rather than inventing a run for an unknown snapshot', () => {
    expect(runFromSnapshot({ pack: 'venues', location: 'venue_redroom', goal: 'g', snapshot_id: 'nope' })).toBeNull();
  });
});

describe('Ablation Lab (F11)', () => {
  it('reports five arms and the shuffled control matches the real order worse than the seed arm', () => {
    const r = computeAblation(snapshot);
    expect(r.rows.map((x) => x.arm)).toEqual(['full', 'location_only', 'seeds_only', 'no_qloo', 'shuffled_qloo']);
    expect(r.rows[0].available).toBe(true);
    expect(r.k).toBeGreaterThan(0);
    const overlap = (arm: string) => r.rows.find((x) => x.arm === arm)?.overlap_at_k;
    expect(overlap('shuffled_qloo')).toBeLessThanOrEqual(overlap('seeds_only')!);
    expect(r.rows.every((x) => x.note.length > 0)).toBe(true);
    // Nothing is invented: an arm with no stored rows is reported unavailable.
    expect(r.rows.filter((x) => !x.available).every((x) => x.overlap_at_k === null)).toBe(true);
  });

  it('is deterministic for the same snapshot', () => {
    // computed_at is the wall clock and legitimately differs; everything that
    // could be randomised by an LLM or a shuffle must not.
    const strip = (r: ReturnType<typeof computeAblation>) => JSON.stringify({ ...r, computed_at: '' });
    expect(strip(computeAblation(snapshot))).toEqual(strip(computeAblation(snapshot)));
  });
});

describe('What-if (F13)', () => {
  // Terms on file = the pack's catalogue plus whatever the operator entered,
  // exactly as the API resolves them.
  const fieldsFor = (id: string, name?: string) => ({
    ...(findOffer('venues', 'redroom', id, name)?.fields ?? {}),
    ...graph.getOfferTerms('venues', 'venue_redroom', id),
  });

  it('raises the guarantee ceiling and Vex appears, with no Qloo call', () => {
    const r = whatIf({ snapshot, rule_overrides: { guarantee_ceiling: 9600 }, fieldsFor: (id) => fieldsFor(id) });
    expect(r.qloo_calls_used).toBe(0);
    expect(r.after.some((a) => a.name === 'Vex')).toBe(true);
    expect(r.changes.some((c) => c.name === 'Vex' && c.direction === 'added')).toBe(true);
    expect(r.rules_applied.find((x) => x.id === 'guarantee_ceiling')?.overridden).toBe(true);
  });

  it('refuses an override for a rule this pack does not have', () => {
    const r = whatIf({ snapshot, rule_overrides: { made_up_rule: 5 }, fieldsFor: (id) => fieldsFor(id) });
    expect(r.changes.length).toBe(0);
    expect(r.notes.join(' ')).toMatch(/refused|not a rule/i);
  });

  it('an operator-entered term unblocks a needs_data item without touching Qloo', () => {
    const before = whatIf({ snapshot, fieldsFor: (id) => fieldsFor(id) });
    expect(before.after.some((a) => a.name === 'Vex')).toBe(false);
    const vex = snapshot.candidates.find((c) => c.name === 'Vex')!;
    const after = whatIf({ snapshot, offer_terms: { [vex.entity_id]: { guarantee_usd: 6000 } }, fieldsFor: (id) => fieldsFor(id) });
    expect(after.after.some((a) => a.name === 'Vex')).toBe(true);
    expect(after.changes.find((c) => c.name === 'Vex')?.direction).toBe('added');
  });

  it('adding a recent play removes that act, and says so', () => {
    const r = whatIf({ snapshot, recent_plays: ['DJ Marlow'], fieldsFor: (id) => fieldsFor(id) });
    expect(r.after.some((a) => a.name === 'DJ Marlow')).toBe(false);
    expect(r.changes.some((c) => c.name === 'DJ Marlow' && c.direction === 'removed')).toBe(true);
  });
});

describe('Why-not (F12)', () => {
  it('explains a rule rejection with the rule and the flip point', async () => {
    const a = await whyNot({ snapshot, query: 'Vex', fieldsFor: () => ({ guarantee_usd: 9500 }) });
    expect(a.verdict).toBe('rule_rejected');
    expect(a.failing_rule).toBe('guarantee_ceiling');
    expect(a.flip?.required_threshold).toBe(9500);
    expect(a.proven_from).toContain('stored run');
  });

  it('says plainly when an act is not in the stored rows at all', async () => {
    const a = await whyNot({ snapshot, query: 'Some Act Nobody Booked', fieldsFor: () => ({}) });
    expect(['not_returned_by_qloo', 'unknown_entity']).toContain(a.verdict);
  });

  it('reports the no-repeat window as the operator exclusion it is', async () => {
    const a = await whyNot({ snapshot, query: 'Paper Lanterns', fieldsFor: () => ({ guarantee_usd: 5000 }), recent_plays: ['Paper Lanterns'] });
    expect(a.verdict).toBe('filtered_before_query');
  });
});

describe('Approval is a human act, and blocking is real (V6)', () => {
  it('refuses to approve an item whose term is not on file', async () => {
    const p = await runPipeline({ pack: 'venues', location: 'venue_redroom', goal: 'Book 1 act', mode: 'replay' });
    const top = p.items[0];
    // The Red Room has terms on file, so approve normally...
    const ok = decide(p, 'approved', 'owner:alex', { entity_ids: [top.entity_id] });
    expect(ok.error).toBeUndefined();
    // ...then remove the term and show the engine refusing to guess one.
    const pending = await runPipeline({ pack: 'venues', location: 'venue_redroom', goal: 'Book 1 act', mode: 'replay' });
    const marlow = pending.items.find((i) => i.name === 'DJ Marlow')!;
    const blockedCopy: Proposal = {
      ...pending,
      items: pending.items.map((i) => (i.entity_id === marlow.entity_id
        ? { ...i, approval_blocked: true, needs_terms: [{ rule_id: 'guarantee_ceiling', field: 'guarantee_usd', enterable: true, label: 'guarantee usd is not on file — enter it to unblock approval' }] }
        : i)),
    };
    const res = decide(blockedCopy, 'approved', 'owner:alex', { entity_ids: [marlow.entity_id] });
    expect(res.error).toContain('never guesses');
    expect(blockedCopy.status).not.toBe('approved');
  });

  it('records a decision, links it in the ledger and names the approver', async () => {
    const p = await runPipeline({ pack: 'venues', location: 'venue_redroom', goal: 'Book 1 act', mode: 'replay' });
    const before = graph.readLedger(500).length;
    const res = decide(p, 'approved', 'owner:alex', { entity_ids: [p.items[0].entity_id] });
    expect(res.proposal.status).toBe('approved');
    const entries = graph.readLedger(500);
    expect(entries.length).toBeGreaterThan(before);
    const last = entries[entries.length - 1];
    expect(last.actor).toBe('owner:alex');
    expect(verifyLedger(entries).ok).toBe(true);
  });

  it('writes a brief that states what it does not guarantee', async () => {
    const p = await runPipeline({ pack: 'venues', location: 'venue_redroom', goal: 'Book 1 act', mode: 'replay' });
    const brief = approvalBrief(p, 'owner:alex');
    expect(brief.sections.some((s) => /does not/i.test(s.heading))).toBe(true);
    expect(brief.text).toContain(p.items[0].name);
    expect(brief.text.toUpperCase()).toContain('REPLAY');
    expect(brief.text).not.toMatch(/api key/i);
  });
});

describe('Trust Center (F47) and Coverage Board (F49)', () => {
  it('reports every named check against a real proposal', () => {
    const t = trustReport(proposal);
    expect(t.checks.length).toBeGreaterThanOrEqual(10);
    expect(t.checks.find((c) => c.id === 'llm-never-ranks')?.status).toBe('pass');
    expect(t.checks.find((c) => c.id === 'no-qloo-data-in-repo')).toBeDefined();
    expect(t.checks.every((c) => c.evidence.length > 0)).toBe(true);
    expect(t.ledger.ok).toBe(true);
    expect(t.tamper_demo.detected).toBe(true);
  });

  it('fails the grounding check when a displayed item is not from this run', () => {
    const tampered = JSON.parse(JSON.stringify(proposal)) as Proposal;
    tampered.items[0].entity_id = 'qloo:artist:invented';
    const t = trustReport(tampered);
    expect(t.checks.some((c) => c.status === 'fail')).toBe(true);
  });

  it('separates verified capabilities from accepted-but-empty ones', () => {
    const b = coverageBoard();
    expect(b.rows.length).toBeGreaterThan(0);
    expect(b.counts.verified).toBeGreaterThan(0);
    const empty = b.rows.filter((r) => r.status === 'accepted_but_empty');
    expect(empty.length).toBeGreaterThan(0);
    expect(b.gate.result).toBeTruthy();
    expect(b.method).toContain('probe');
  });
});
