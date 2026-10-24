// Flip Point engine (F40).
//
// Answers the question an owner actually asks: "exactly what would have to
// change in my own policy for this act to be allowed?" It only ever reports a
// threshold on a rule that already has real data behind it. Where the data is
// missing it says so rather than inventing a number, and where the blocker is
// the operator's own history list it does not suggest editing history.

import type { AuditRejection, FlipPoint, QlooEntityResult, Rule, RuleResult } from '../types';
import { evaluateRule, type RuleSubject } from './rule-checker';

/** Smallest unit we are willing to quote, so "one step less" is well defined. */
function quantum(metric: string, observed: number, threshold: number): number {
  if (metric.startsWith('qloo_popularity')) return 0.001;
  if (metric.startsWith('qloo_')) return 1;
  const scale = Math.max(Math.abs(observed), Math.abs(threshold), 1);
  if (scale >= 1000) return 100;
  if (scale >= 100) return 10;
  return 1;
}

function subjectFor(c: QlooEntityResult, fields: Record<string, number>): RuleSubject {
  return {
    name: c.name,
    fields,
    tags: c.tag_names,
    tag_ids: c.qloo_tags.map((t) => t.id),
    qloo: c,
  };
}

export function computeFlipPoints(
  rejections: AuditRejection[],
  candidates: QlooEntityResult[],
  rules: Rule[],
  _pack: string,
  _location: string,
  fieldsFor: (entityId: string) => Record<string, number> = () => ({}),
): FlipPoint[] {
  const out: FlipPoint[] = [];
  for (const rej of rejections) {
    if (!rej.rule_id || rej.check !== 3) continue;
    const cand = candidates.find((c) => c.entity_id === rej.entity_id);
    const rule = rules.find((r) => r.id === rej.rule_id);
    if (!cand || !rule) continue;

    const subject = subjectFor(cand, fieldsFor(cand.entity_id));
    const res = evaluateRule(rule, subject);
    if (res.status !== 'fail' || !res.metric || res.observed === undefined || res.threshold === undefined || !res.direction) continue;

    const q = quantum(res.metric, res.observed, res.threshold);
    // Required threshold: the smallest quoted change that provably admits the item.
    // A ceiling must reach the observed value; a floor must sit at or under it.
    const required = res.direction === 'max'
      ? Math.ceil(res.observed / q) * q
      : Math.floor(res.observed / q) * q;

    // Prove it: flip passes, one step back does not.
    const flipped = evaluateRule(withThreshold(rule, required, res.direction), subject);
    const oneStepBack = evaluateRule(withThreshold(rule, res.direction === 'max' ? required - q : required + q, res.direction), subject);
    if (flipped.status !== 'pass' || oneStepBack.status === 'pass') continue;

    out.push({
      entity_id: cand.entity_id,
      name: cand.name,
      rule_id: rule.id,
      metric: res.metric,
      observed: res.observed,
      current_threshold: res.threshold,
      required_threshold: required,
      delta: +(required - res.threshold).toFixed(6),
      direction: res.direction,
      note: res.direction === 'max'
        ? `raising the ${res.metric} ceiling from ${res.threshold} to ${required} admits ${cand.name}; at ${required - q} it still fails`
        : `lowering the ${res.metric} floor from ${res.threshold} to ${required} admits ${cand.name}; at ${required + q} it still fails`,
    });
  }
  return out;
}

function withThreshold(rule: Rule, value: number, direction: 'max' | 'min'): Rule {
  if (rule.kind === 'band') {
    const band = { ...rule.band! };
    // A band flip moves whichever edge was violated.
    if (direction === 'max') band.max = value; else band.min = value;
    return { ...rule, band };
  }
  return { ...rule, value };
}

/** Flip points for an explicit item, used by the Why-not screen. */
export function flipForRule(rule: Rule, subject: RuleSubject, prior: RuleResult): FlipPoint | null {
  if (prior.status !== 'fail' || !prior.metric || prior.observed === undefined || prior.threshold === undefined || !prior.direction) return null;
  const q = quantum(prior.metric, prior.observed, prior.threshold);
  const required = prior.direction === 'max' ? Math.ceil(prior.observed / q) * q : Math.floor(prior.observed / q) * q;
  if (evaluateRule(withThreshold(rule, required, prior.direction), subject).status !== 'pass') return null;
  return {
    entity_id: subject.qloo?.entity_id ?? '',
    name: subject.name,
    rule_id: rule.id,
    metric: prior.metric,
    observed: prior.observed,
    current_threshold: prior.threshold,
    required_threshold: required,
    delta: +(required - prior.threshold).toFixed(6),
    direction: prior.direction,
    note: `changing ${prior.metric} from ${prior.threshold} to ${required} would admit ${subject.name}`,
  };
}
