import type { Rule, RuleResult, QlooEntityResult, NeedsTerm } from '../types';

// Deterministic Rule Checker. The LLM never runs this and never alters a verdict.
//
// Three outcomes, not two:
//   pass       - the rule is satisfied on data that exists
//   fail       - the rule is violated on data that exists
//   needs_data - the data is not on file. We never assume compliance and never
//                invent a number. on_missing decides what happens next:
//                'block' -> treated as a rejection; 'flag' -> visible but not
//                approvable until the operator enters the term.

export interface RuleSubject {
  name: string;
  fields: Record<string, number>;   // operator-entered terms
  tags: string[];                   // lower-cased tag names available for matching
  tag_ids?: string[];
  qloo?: QlooEntityResult;          // Qloo-reported attributes for band rules
}

function result(
  rule: Rule,
  status: RuleResult['status'],
  reason: string,
  extra: Partial<RuleResult> = {},
): RuleResult {
  return {
    rule_id: rule.id,
    status,
    pass: status === 'pass',
    reason,
    source: rule.source,
    on_missing: rule.on_missing ?? 'block',
    ...extra,
  };
}

/** Read a Qloo-reported attribute a band rule can be evaluated against. */
function bandValue(subject: RuleSubject, field: string): number | undefined {
  const q = subject.qloo;
  if (!q) return undefined;
  switch (field) {
    case 'qloo_popularity': return q.popularity;
    case 'qloo_obscurity': return q.obscurity;
    case 'qloo_followers': return q.followers;
    case 'qloo_listeners': return q.listeners;
    default: return subject.fields[field];
  }
}

export function evaluateRule(rule: Rule, subject: RuleSubject): RuleResult {
  const onMissing = rule.on_missing ?? 'block';
  const metricName = rule.kind === 'band' ? rule.band!.field : rule.field ?? '';
  const missing = (what: string) =>
    result(rule, 'needs_data', `${what} is not on file — not guessed (${onMissing === 'block' ? 'cannot be shown as compliant' : 'enter it to unblock approval'})`,
      { metric: metricName });

  switch (rule.kind) {
    case 'numeric_max': {
      const v = subject.fields[rule.field!];
      if (v === undefined) return missing(rule.field!);
      const pass = v <= rule.value!;
      return result(rule, pass ? 'pass' : 'fail',
        pass ? `${rule.field} ${v} <= ${rule.value}` : `${rule.field} ${v} exceeds the ceiling ${rule.value}`,
        { metric: rule.field, observed: v, threshold: rule.value, direction: 'max' });
    }
    case 'numeric_min': {
      const v = subject.fields[rule.field!];
      if (v === undefined) return missing(rule.field!);
      const pass = v >= rule.value!;
      return result(rule, pass ? 'pass' : 'fail',
        pass ? `${rule.field} ${v} >= ${rule.value}` : `${rule.field} ${v} is below the minimum ${rule.value}`,
        { metric: rule.field, observed: v, threshold: rule.value, direction: 'min' });
    }
    case 'band': {
      const b = rule.band!;
      const v = bandValue(subject, b.field);
      if (v === undefined) return missing(b.field.replace('qloo_', 'Qloo '));
      const lo = b.min ?? -Infinity;
      const hi = b.max ?? Infinity;
      const pass = v >= lo && v <= hi;
      const bandText = `[${b.min ?? 'no floor'}, ${b.max ?? 'no ceiling'}]`;
      return result(rule, pass ? 'pass' : 'fail',
        pass ? `${b.field} ${v} sits inside the band ${bandText}`
             : `${b.field} ${v} sits outside the band ${bandText} — ${v > hi ? 'too large for this room' : 'too small for this room'}`,
        { metric: b.field, observed: v, threshold: v > hi ? hi : lo, direction: v > hi ? 'max' : 'min' });
    }
    case 'exclude_tags': {
      const hit = (rule.tags ?? []).find((t) => subject.tags.includes(t.toLowerCase()) || subject.tag_ids?.includes(t));
      return hit
        ? result(rule, 'fail', `carries excluded tag "${hit}"`)
        : result(rule, 'pass', 'no excluded tag present');
    }
    case 'require_tags': {
      const need = (rule.tags ?? []).map((t) => t.toLowerCase());
      const absent = need.filter((t) => !subject.tags.includes(t));
      return absent.length
        ? result(rule, 'fail', `missing required tag(s): ${absent.join(', ')}`)
        : result(rule, 'pass', 'all required tags present');
    }
    case 'allow_list': {
      const ok = (rule.list ?? []).some((x) => x.toLowerCase() === subject.name.toLowerCase());
      return result(rule, ok ? 'pass' : 'fail', ok ? 'on the approved list' : 'not on the approved list');
    }
    case 'deny_list': {
      const hit = (rule.list ?? []).find((x) => x.toLowerCase() === subject.name.toLowerCase());
      return hit ? result(rule, 'fail', `on the deny list ("${hit}")`) : result(rule, 'pass', 'not on the deny list');
    }
    case 'exclude_recent': {
      const hit = (rule.list ?? []).find((x) => x.toLowerCase() === subject.name.toLowerCase());
      return hit
        ? result(rule, 'fail', `already played recently ("${hit}") — inside the no-repeat window`)
        : result(rule, 'pass', 'not inside the no-repeat window');
    }
    case 'require_present': {
      const v = subject.fields[rule.field!];
      return v === undefined
        ? result(rule, 'fail', `${rule.field} must be present`)
        : result(rule, 'pass', `${rule.field} present`);
    }
    default:
      return result(rule, 'fail', `unknown rule kind "${(rule as Rule).kind}"`);
  }
}

export function evaluateAll(rules: Rule[], subject: RuleSubject): RuleResult[] {
  return rules.map((r) => evaluateRule(r, subject));
}

/**
 * Item-level verdict from a set of rule results.
 * - any 'fail'                  -> rejected
 * - any 'needs_data' with block -> rejected
 * - any 'needs_data' with flag  -> shown, approval blocked
 */
export function itemVerdict(results: RuleResult[]): {
  rejected: boolean; approval_blocked: boolean; needs_terms: NeedsTerm[]; first_failure?: RuleResult;
} {
  const failed = results.filter((r) => r.status === 'fail');
  const blocking = results.filter((r) => r.status === 'needs_data' && (r.on_missing ?? 'block') === 'block');
  const flagging = results.filter((r) => r.status === 'needs_data' && r.on_missing === 'flag');
  const needs_terms: NeedsTerm[] = flagging.map((r) => {
    const field = r.metric ?? '';
    return {
      rule_id: r.rule_id,
      field,
      enterable: !!field && !field.startsWith('qloo_'),
      label: field.startsWith('qloo_')
        ? `Qloo did not return ${field.replace('qloo_', '')} for this entity — nothing to enter, the rule simply cannot be checked`
        : `${field.replace(/_/g, ' ')} is not on file — enter it to unblock approval`,
    };
  });
  return {
    rejected: failed.length > 0 || blocking.length > 0,
    // Only a missing operator-entered term blocks approval; a missing Qloo
    // attribute is reported but cannot be "entered" by anyone.
    approval_blocked: needs_terms.some((t) => t.enterable),
    needs_terms,
    first_failure: failed[0] ?? blocking[0],
  };
}
