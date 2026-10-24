// Why-not (F12). The owner's most common question is not "what did you pick"
// but "why isn't X on the list". This answers it from the stored run only — no
// Qloo call, no re-ranking, and no invented reason. If the engine cannot prove
// why an item is absent, it says that instead of guessing.

import type { QlooEntityResult, RunSnapshot } from '../types';
import { evaluateAll, itemVerdict } from './rule-checker';
import { flipForRule } from './flip';
import type { RuleSubject } from './rule-checker';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function findIn(list: QlooEntityResult[], query: string): QlooEntityResult | undefined {
  const q = norm(query);
  if (!q) return undefined;
  return list.find((e) => e.entity_id.toLowerCase() === query.toLowerCase())
    ?? list.find((e) => norm(e.name) === q)
    ?? list.find((e) => norm(e.name).includes(q));
}

export interface WhyNotAnswer {
  query: string;
  verdict: 'in_proposal' | 'rule_rejected' | 'awaiting_term' | 'filtered_before_query' | 'not_returned_by_qloo' | 'exists_but_not_returned' | 'unknown_entity';
  headline: string;
  detail: string[];
  entity_id: string | null;
  qloo_rank: number | null;
  failing_rule: string | null;
  flip: { rule_id: string; metric: string; current_threshold: number; required_threshold: number; note: string } | null;
  proven_from: string;
}

export interface WhyNotInput {
  snapshot: RunSnapshot;
  query: string;
  /** Terms on file for an entity, resolved by the caller (catalogue + operator entries). */
  fieldsFor: (entityId: string, entityName?: string) => Record<string, number>;
  /** Ids the room excludes before asking Qloo at all. */
  excluded_ids?: string[];
  /** Names the operator listed as recently played. */
  recent_plays?: string[];
  /** When the item is not in the stored rows, ask Qloo whether the entity exists at all. */
  resolveLive?: (name: string) => Promise<{ exists: boolean; entity_id?: string }>;
}

export async function whyNot(input: WhyNotInput): Promise<WhyNotAnswer> {
  const { snapshot, query } = input;
  const snapNote = `stored run ${snapshot.proposal_id} (${snapshot.mode} mode, ${snapshot.candidates.length} Qloo rows)`;
  const cand = findIn(snapshot.candidates, query);

  const answer = (v: WhyNotAnswer['verdict'], headline: string, detail: string[], extra: Partial<WhyNotAnswer> = {}): WhyNotAnswer => ({
    query, verdict: v, headline, detail,
    entity_id: cand?.entity_id ?? null,
    qloo_rank: cand?.qloo_rank ?? null,
    failing_rule: null,
    flip: null,
    proven_from: snapNote,
    ...extra,
  });

  if (cand) {
    const pos = snapshot.item_ids.indexOf(cand.entity_id);
    if (pos >= 0) {
      return answer('in_proposal', `${cand.name} is on the list, at rank ${pos + 1}.`, [
        `Qloo put it at position ${cand.qloo_rank} of ${snapshot.candidates.length} for this room's seeds and location`,
        `every applicable rule passed: ${snapshot.rules.map((r) => r.id).join(', ')}`,
      ]);
    }

    if ((input.excluded_ids ?? []).includes(cand.entity_id)) {
      return answer('filtered_before_query', `${cand.name} is on this room's exclusion list, so Qloo was asked to leave it out.`, [
        'exclusion applied as a query filter, before ranking',
        'remove it from the room configuration to see it ranked',
      ]);
    }

    const recent = (input.recent_plays ?? []).map(norm);
    if (recent.includes(norm(cand.name))) {
      return answer('filtered_before_query', `${cand.name} is inside this room's no-repeat window.`, [
        'the operator listed it as recently played, so it was dropped before ranking',
        'nothing about the act itself is being judged — clearing the history entry is enough to have it ranked again',
      ]);
    }

    const subject: RuleSubject = {
      name: cand.name,
      fields: input.fieldsFor(cand.entity_id),
      tags: cand.tag_names,
      tag_ids: cand.qloo_tags.map((t) => t.id),
      qloo: cand,
    };
    const results = evaluateAll(snapshot.rules, subject);
    const verdict = itemVerdict(results);
    const failed = results.find((r) => r.status === 'fail');
    const blocking = results.find((r) => r.status === 'needs_data' && (r.on_missing ?? 'block') === 'block');
    const flagging = results.find((r) => r.status === 'needs_data' && r.on_missing === 'flag');

    if (failed) {
      const flip = flipForRule(snapshot.rules.find((r) => r.id === failed.rule_id)!, subject, failed);
      return answer('rule_rejected', `${cand.name} was returned by Qloo (rank ${cand.qloo_rank}) and then vetoed by ${failed.rule_id}.`, [
        failed.reason,
        `rule source: ${failed.source}`,
        flip ? flip.note : 'this rule has no numeric threshold to move, so a flip point cannot be quoted for it',
      ], { failing_rule: failed.rule_id, flip: flip ? { rule_id: flip.rule_id, metric: flip.metric, current_threshold: flip.current_threshold, required_threshold: flip.required_threshold, note: flip.note } : null });
    }
    if (blocking) {
      return answer('rule_rejected', `${cand.name} cannot be shown as compliant: ${blocking.rule_id} has no data to check.`, [
        blocking.reason,
        `rule source: ${blocking.source}`,
        'Taste Brain never marks an unchecked rule as passing',
      ], { failing_rule: blocking.rule_id });
    }
    if (flagging) {
      return answer('awaiting_term', `${cand.name} passes every checkable rule and is waiting on one term the owner has not entered.`, [
        flagging.reason,
        `rule source: ${flagging.source}`,
        'enter the term and approval unlocks — the engine will not guess a figure',
      ], { failing_rule: flagging.rule_id });
    }
    return answer('unknown_entity', `${cand.name} cleared every rule but is not in the accepted list.`, [
      'this is a defect, not a judgement: the run recorded it as a candidate and no rule failed it',
      'check the trace for an Auditor veto on this item',
    ]);
  }

  // Not in the constrained result set — where else did Qloo show it?
  const variants = Object.entries(snapshot.variants ?? {});
  for (const [name, list] of variants) {
    const hit = findIn(list, query);
    if (hit) {
      return answer('not_returned_by_qloo', `${query} appears in the "${name}" comparison run but not in the constrained query for this room.`, [
        `Qloo ranked it at ${hit.qloo_rank} when the query was loosened for that arm`,
        `the constrained query for this room asked for: ${snapshot.rules.length} policy rule(s)${snapshot.location_query ? `, location ${snapshot.location_query}` : ''}, ${snapshot.resolved_seeds.length} taste seed(s)`,
        'the difference is Qloo\'s answer, not a filter Taste Brain applied',
      ]);
    }
  }

  if (input.resolveLive) {
    try {
      const r = await input.resolveLive(query);
      if (r.exists) {
        return answer('exists_but_not_returned', `${query} is a real Qloo entity, but this run's constrained query did not return it.`, [
          "Qloo's audience model did not place it inside this room's seeds, location and filters",
          'it was not removed by a policy rule — no rule was ever evaluated for it',
          `run at ${snapshot.created_at} in ${snapshot.mode} mode; a fresh live run may differ`,
        ]);
      }
      return answer('unknown_entity', `Qloo has no entity matching "${query}", so nothing in this system could rank it.`, [
        'the name may be spelled differently than Qloo indexes it',
        'Taste Brain does not create entities to fill a gap',
      ]);
    } catch { /* fall through to the honest default below */ }
  }

  return answer('not_returned_by_qloo', `${query} is not in this run's stored Qloo rows for this room.`, [
    `${snapNote}`,
    'that is all this answer can prove offline: absence from the stored rows is not the same as a rejection',
    'run a live lookup from the Why-not screen to check whether Qloo knows the entity at all',
  ]);
}
