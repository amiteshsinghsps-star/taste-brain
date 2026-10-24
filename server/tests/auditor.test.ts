import { describe, it, expect } from 'vitest';
import { runPipeline, auditItem } from '../src/agents/pipeline';
import { evaluateRule, itemVerdict } from '../src/agents/rule-checker';
import type { EvidenceCard, ProposalItem, Rule } from '../src/types';

// A minimal evidence card as the pipeline would build one for a Replay row.
const evidence = (over: Partial<EvidenceCard> = {}): EvidenceCard => ({
  entity_id: 'qloo:brand:x', endpoint: '/v2/insights', workflow: 'recommend', mode: 'replay',
  fetched_at: '1970-01-01T00:00:00.000Z', qloo_rank: 1, primary_genres: ['test'], qloo_tags: [],
  fit_note: 'fit is derived by Taste Brain from Qloo rank', ...over,
});

const pass = { rule_id: 'r1', status: 'pass' as const, pass: true, reason: 'ok', source: 'S#L1' };
const fail = { rule_id: 'r1', status: 'fail' as const, pass: false, reason: 'over the ceiling', source: 'S#L1' };

const baseItem = (over: Partial<ProposalItem> = {}): ProposalItem => ({
  entity_id: 'qloo:brand:x', offer_id: 'o1', rank: 1, name: 'X', type: 'brand',
  fit: 1, qloo_rank: 1, tags: [],
  explanation: "X is Qloo's rank 1 for this audience.",
  rule_results: [pass], evidence: evidence(), mode: 'replay',
  approval_blocked: false, needs_terms: [], ...over,
});

describe('Grounding Auditor checks (PRD §7.5)', () => {
  const stored = new Set(['qloo:brand:x']);

  it('check 1: rejects an item with no Qloo entity id', () => {
    const v = auditItem(baseItem({ entity_id: '' }), stored);
    expect(v.ok).toBe(false);
    expect(v.check).toBe(1);
  });

  it('check 1: rejects an item whose id is not in this run\'s stored results', () => {
    const v = auditItem(baseItem({ entity_id: 'qloo:brand:invented' }), stored);
    expect(v.ok).toBe(false);
    expect(v.check).toBe(1);
  });

  it('check 3: rejects an item that violates a rule', () => {
    const v = auditItem(baseItem({ rule_results: [fail] }), stored);
    expect(v.ok).toBe(false);
    expect(v.check).toBe(3);
  });

  it('check 3: a needs_data rule with on_missing=block is treated as unproven', () => {
    const v = auditItem(baseItem({
      rule_results: [{ rule_id: 'guarantee_ceiling', status: 'needs_data', pass: false, reason: 'guarantee_usd is not on file', source: 'S#L11', on_missing: 'block' }],
    }), stored);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('cannot be proven');
  });

  it('check 4: rejects an item with no mode on the item or its evidence', () => {
    expect(auditItem(baseItem({ mode: undefined as any }), stored).check).toBe(4);
    expect(auditItem(baseItem({ evidence: evidence({ mode: undefined as any }) }), stored).check).toBe(4);
  });

  it('check 5: rejects individual-level language', () => {
    const v = auditItem(baseItem({ explanation: 'This patron comes back every week and prefers her usual table.' }), stored);
    expect(v.ok).toBe(false);
    expect(v.check).toBe(5);
  });

  it('passes a grounded, rule-compliant, audience-level item', () => {
    const v = auditItem(baseItem(), stored);
    expect(v.ok).toBe(true);
  });
});

describe('Three-state rule engine', () => {
  const num = (kind: Rule['kind'], field: string, value: number, on_missing?: Rule['on_missing']): Rule =>
    ({ id: 'r', kind, field, value, source: 'S#L1', on_missing });

  it('numeric_max passes and fails on real numbers', () => {
    expect(evaluateRule(num('numeric_max', 'guarantee_usd', 8000), { name: 'a', fields: { guarantee_usd: 5000 }, tags: [], qloo: {} as any }).pass).toBe(true);
    expect(evaluateRule(num('numeric_max', 'guarantee_usd', 8000), { name: 'a', fields: { guarantee_usd: 9500 }, tags: [], qloo: {} as any }).status).toBe('fail');
  });

  it('a missing term is needs_data, never an assumed pass', () => {
    const r = evaluateRule(num('numeric_max', 'guarantee_usd', 8000, 'flag'), { name: 'a', fields: {}, tags: [] });
    expect(r.status).toBe('needs_data');
    expect(r.pass).toBe(false);
    expect(itemVerdict([r]).approval_blocked).toBe(true);
    expect(itemVerdict([r]).rejected).toBe(false);
  });

  it('a missing Qloo attribute cannot be "entered" by the operator', () => {
    const band: Rule = { id: 'room_fit', kind: 'band', band: { field: 'qloo_popularity', min: 0.05, max: 0.85 }, source: 'S#L14', on_missing: 'flag' };
    const r = evaluateRule(band, { name: 'a', fields: {}, tags: [] });
    expect(r.status).toBe('needs_data');
    const v = itemVerdict([r]);
    expect(v.approval_blocked).toBe(false);
    expect(v.needs_terms[0].enterable).toBe(false);
  });

  it('band rules report which edge was breached, for the Flip Point engine', () => {
    const band: Rule = { id: 'room_fit', kind: 'band', band: { field: 'qloo_popularity', min: 0.05, max: 0.85 }, source: 'S#L14' };
    const subject = (p: number) => ({ name: 'a', fields: {}, tags: [], qloo: { popularity: p } as any });
    expect(evaluateRule(band, subject(0.4)).pass).toBe(true);
    const tooBig = evaluateRule(band, subject(0.94));
    expect(tooBig.status).toBe('fail');
    expect(tooBig.direction).toBe('max');
    expect(tooBig.observed).toBe(0.94);
    const tooSmall = evaluateRule(band, subject(0.01));
    expect(tooSmall.direction).toBe('min');
  });

  it('exclude_tags matches a Qloo tag id, not only a name', () => {
    const r: Rule = { id: 'matinee_content', kind: 'exclude_tags', tags: ['urn:tag:music:qloo:explicit'], source: 'S#L6' };
    expect(evaluateRule(r, { name: 'a', fields: {}, tags: [], tag_ids: ['urn:tag:music:qloo:explicit'] }).status).toBe('fail');
    expect(evaluateRule(r, { name: 'a', fields: {}, tags: ['folk'], tag_ids: ['urn:tag:music:qloo:singer_songwriter'] }).pass).toBe(true);
  });

  it('exclude_recent fires on the operator\'s own list', () => {
    const r: Rule = { id: 'no_repeat', kind: 'exclude_recent', list: ['Paper Lanterns'], source: 'S#L19' };
    expect(evaluateRule(r, { name: 'Paper Lanterns', fields: {}, tags: [] }).status).toBe('fail');
    expect(evaluateRule(r, { name: 'DJ Marlow', fields: {}, tags: [] }).pass).toBe(true);
  });
});

describe('Venue pack, Red Room (offline worked example, V1–V4)', () => {
  it('ranks on Qloo order, refuses the over-ceiling act and the recent play, and reports a flip point', async () => {
    const p = await runPipeline({ pack: 'venues', location: 'venue_redroom', goal: 'Book 2 acts for autumn', mode: 'replay' });
    expect(p.mode).toBe('replay');
    const names = p.items.map((i) => i.name);
    expect(names).toContain('DJ Marlow');
    expect(names).not.toContain('Vex');                 // guarantee 9500 > 8000
    expect(names).not.toContain('Paper Lanterns');      // inside the no-repeat window
    // Ranking is Qloo's own order, not a re-sort by our derived value.
    expect(p.items.map((i) => i.qloo_rank)).toEqual([...p.items.map((i) => i.qloo_rank)].sort((a, b) => a - b));
    expect(p.rejections.some((r) => r.name === 'Vex' && r.check === 3)).toBe(true);
    const flip = p.flip_points.find((f) => f.name === 'Vex');
    expect(flip?.rule_id).toBe('guarantee_ceiling');
    expect(flip?.required_threshold).toBe(9500);
    // Derived chips come from the stored comparison variants.
    expect(p.items[0].local_lift).not.toBeNull();
    expect(p.audience_tags.length).toBeGreaterThan(0);
    for (const it of p.items) {
      expect(it.evidence.mode).toBe('replay');
      expect(it.evidence.fit_note).toContain('derived by Taste Brain');
    }
  });

  it('a second run of the same inputs reproduces the same ranking and hash', async () => {
    const a = await runPipeline({ pack: 'venues', location: 'venue_redroom', goal: 'g', mode: 'replay' });
    const b = await runPipeline({ pack: 'venues', location: 'venue_redroom', goal: 'g', mode: 'replay' });
    expect(a.trace.rerun_hash).toBe(b.trace.rerun_hash);
    expect(a.items.map((i) => i.offer_id)).toEqual(b.items.map((i) => i.offer_id));
  });
});

describe('Retail store_3 (the same engine, different configuration)', () => {
  it('refuses the top Qloo match on budget, refuses the over-order brand, keeps unknown brands visible as unsupported', async () => {
    const p = await runPipeline({ pack: 'retail', location: 'store_3', goal: 'Add 4 brands for spring', mode: 'replay' });
    const names = p.items.map((i) => i.name);
    expect(names).not.toContain('Riverstone Co.');       // budget_cap
    expect(names).not.toContain('Mesa & Main');          // min_order
    expect(names).not.toContain('Boggy Creek Vapor Co.');    // brand_safety
    expect(p.unsupported.some((u) => u.name === 'Unknown Indie Label')).toBe(true);
    expect(p.rejections.some((r) => r.check === 3)).toBe(true);
    for (const it of p.items) {
      expect(it.entity_id).toBeTruthy();
      expect(it.rule_results.every((r) => r.status === 'pass')).toBe(true);
      expect(it.mode).toBe('replay');
    }
  });
});
