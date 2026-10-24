// What-if (F13). The owner changes one number and asks what happens to the
// list. This recomputes from the stored run snapshot: no Qloo call, no model
// call, no new ranking. The only thing that moves is the policy, so the diff is
// exactly attributable to the change that was made.

import type { QlooEntityResult, RunSnapshot } from '../types';
import { evaluateAll, itemVerdict } from './rule-checker';
import type { RuleSubject } from './rule-checker';
import { computeFlipPoints } from './flip';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface WhatIfInput {
  snapshot: RunSnapshot;
  /** rule id -> new threshold. A band rule's number moves its ceiling (the room size). */
  rule_overrides?: Record<string, number>;
  /** operator enters a missing term: entity id -> field -> value */
  offer_terms?: Record<string, Record<string, number>>;
  /** additions to the no-repeat window */
  recent_plays?: string[];
  /** re-cut the room's popularity band. Applied to stored rows only — labelled. */
  band?: { min?: number; max?: number };
  fieldsFor: (entityId: string) => Record<string, number>;
}

export interface WhatIfChange {
  name: string;
  entity_id: string;
  qloo_rank: number | null;
  direction: 'added' | 'removed';
  because: string;
}

export interface WhatIfResult {
  proposal_id: string;
  recomputed_at: string;
  qloo_calls_used: number;
  before: { entity_id: string; name: string; rank: number }[];
  after: { entity_id: string; name: string; rank: number }[];
  changes: WhatIfChange[];
  rules_applied: { id: string; snippet: string; overridden: boolean }[];
  notes: string[];
  flip_points_offered: { rule_id: string; name: string; required_threshold: number; note: string }[];
}

function subjectFor(c: QlooEntityResult, fields: Record<string, number>): RuleSubject {
  return { name: c.name, fields, tags: c.tag_names, tag_ids: c.qloo_tags.map((t) => t.id), qloo: c };
}

export function whatIf(input: WhatIfInput): WhatIfResult {
  const { snapshot } = input;
  const notes: string[] = [];
  const byId = new Map(snapshot.candidates.map((c) => [c.entity_id, c]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  // 1. Apply the threshold edits to the rule set, recording what was touched.
  const overrides = input.rule_overrides ?? {};
  const rules = snapshot.rules.map((r) => {
    const v = overrides[r.id];
    if (v === undefined) return { rule: r, overridden: false };
    if (r.kind === 'band') {
      const band = { ...r.band!, max: v };
      return { rule: { ...r, band, snippet: `${r.band!.field} must be within [${band.min}, ${v}]` }, overridden: true };
    }
    return { rule: { ...r, value: v, snippet: `${r.field} must be ${r.kind === 'numeric_min' ? '>=' : '<='} ${v}` }, overridden: true };
  });
  const unknown = Object.keys(overrides).filter((id) => !snapshot.rules.some((r) => r.id === id));
  for (const id of unknown) notes.push(`"${id}" is not a rule in this pack, so the override was refused rather than applied to something else`);

  const rulesApplied = rules.map(({ rule, overridden }) => ({ id: rule.id, snippet: rule.snippet ?? rule.id, overridden }));

  // 2. Re-run the deterministic rule checker over the SAME stored Qloo rows.
  const recent = (input.recent_plays ?? []).map(norm);
  const extraTerms = input.offer_terms ?? {};
  const accepted: string[] = [];
  const reasonFor = new Map<string, string>();

  for (const c of snapshot.candidates) {
    if (recent.includes(norm(c.name))) {
      reasonFor.set(c.entity_id, `listed by the owner as recently played inside the no-repeat window (${c.name})`);
      continue;
    }
    if (input.band && c.popularity !== undefined) {
      const lo = input.band.min ?? -Infinity;
      const hi = input.band.max ?? Infinity;
      if (c.popularity < lo || c.popularity > hi) {
        reasonFor.set(c.entity_id, `popularity ${c.popularity.toFixed(3)} falls outside the requested band [${input.band.min ?? 'no floor'}, ${input.band.max ?? 'no ceiling'}]`);
        continue;
      }
    }
    const fields = { ...(input.fieldsFor(c.entity_id) ?? {}), ...(extraTerms[c.entity_id] ?? {}) };
    const verdict = itemVerdict(evaluateAll(rules.map((r) => r.rule), subjectFor(c, fields)));
    if (verdict.rejected) {
      const first = verdict.first_failure;
      reasonFor.set(c.entity_id, first ? `${first.rule_id}: ${first.reason}` : 'a rule failed');
      continue;
    }
    accepted.push(c.entity_id);
  }

  if (input.band) {
    notes.push('the band was re-applied to the rows Qloo already returned. A different band sent to Qloo would also change which rows come back, so this is a filter preview, not a new Qloo answer.');
  }
  notes.push(`recomputed from the stored snapshot with 0 Qloo calls; ranking is still Qloo's own order (${snapshot.candidates.length} rows)`);

  // 3. Diff against the list the run actually produced.
  const beforeIds = snapshot.item_ids;
  const rankOf = (id: string) => byId.get(id)?.qloo_rank ?? null;
  const before = beforeIds.map((id, i) => ({ entity_id: id, name: nameOf(id), rank: i + 1 }));
  const after = accepted.map((id, i) => ({ entity_id: id, name: nameOf(id), rank: i + 1 }));

  const changes: WhatIfChange[] = [
    ...accepted.filter((id) => !beforeIds.includes(id)).map((id) => ({
      name: nameOf(id), entity_id: id, qloo_rank: rankOf(id), direction: 'added' as const,
      because: `Qloo ranked it ${rankOf(id)} for this room and every rule now passes it${Object.keys(overrides).length ? ` (changed rule(s): ${Object.keys(overrides).join(', ')})` : ''}`,
    })),
    ...beforeIds.filter((id) => !accepted.includes(id)).map((id) => ({
      name: nameOf(id), entity_id: id, qloo_rank: rankOf(id), direction: 'removed' as const,
      because: reasonFor.get(id) ?? 'a rule now fails it',
    })),
  ];

  // 4. Offer the next honest move: what single threshold would admit something.
  const rejectedNow = snapshot.candidates.filter((c) => !accepted.includes(c.entity_id) && !recent.includes(norm(c.name)));
  const flips = computeFlipPoints(
    rejectedNow.map((c) => {
      const subject = subjectFor(c, { ...input.fieldsFor(c.entity_id), ...(extraTerms[c.entity_id] ?? {}) });
      const res = evaluateAll(rules.map((r) => r.rule), subject).find((x) => x.status === 'fail');
      return { entity_id: c.entity_id, offer_id: `qloo_only:${c.entity_id}`, name: c.name, reason: res?.reason ?? 'filtered by the band or the no-repeat window', check: res ? 3 : 1, rule_id: res?.rule_id, at: new Date().toISOString() };
    }),
    rejectedNow,
    rules.map((r) => r.rule),
    snapshot.pack,
    snapshot.location,
    (id) => ({ ...input.fieldsFor(id), ...(extraTerms[id] ?? {}) }),
  );

  return {
    proposal_id: snapshot.proposal_id,
    recomputed_at: new Date().toISOString(),
    qloo_calls_used: 0,
    before, after, changes,
    rules_applied: rulesApplied,
    notes,
    flip_points_offered: flips.map((f) => ({ rule_id: f.rule_id, name: f.name, required_threshold: f.required_threshold, note: f.note })),
  };
}
