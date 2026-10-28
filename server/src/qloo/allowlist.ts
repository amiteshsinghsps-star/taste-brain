// Parameter allowlist (PRD §6.2 guardrail #1).
//
// Why this exists: Qloo silently ignores query parameters it does not understand.
// A typo would therefore look like a working feature while returning an
// unfiltered answer, and a "verified" claim would be false. So every outbound
// parameter is checked against the set verified live for that endpoint, and an
// unknown parameter is REFUSED and RECORDED instead of being sent or dropped.
//
// Each entry is annotated with how it was confirmed (see server/verification/).

export class AllowlistViolation extends Error {
  constructor(public endpoint: string, public param: string, public detail: string) {
    super(`allowlist: refusing unsupported parameter "${param}" on ${endpoint} (${detail})`);
    this.name = 'AllowlistViolation';
  }
}

/** Params verified live on the hackathon key, 2026-10-24. */
export const ALLOWED_PARAMS: Record<string, string[]> = {
  '/search': [
    'query',   // verified
    'type',    // verified: urn:entity:artist | brand | place | movie | tv_show
    'take',    // verified
  ],
  '/v2/tags': [
    'filter.query', // verified: returns tag ids like urn:tag:subgenre:qloo:indie
    'take',
  ],
  '/v2/insights': [
    'filter.type',              // verified
    'take',                     // verified
    'signal.interests.entities',// verified (comma-separated uuids)
    'signal.interests.tags',    // verified (tag ids)
    'signal.location.query',    // verified: changes ranking (overlap@10 = 8/10 vs no location)
    'filter.location.query',    // verified: accepted, 400 if given plain filter.location
    'filter.exclude.entities',  // verified: excluded uuid was absent from results
    'filter.exclude.tags',      // verified
    'filter.results.entities',  // verified: restricts ranking to a shortlist
    'filter.popularity.min',    // verified: must be a float 0..1 (integers are rejected 400)
    'filter.popularity.max',    // verified: must be a float 0..1
    'bias.trends',              // verified: off|very_low|low|mid|medium|high|very_high
    'feature.explainability',   // accepted; descriptions are present with or without it
  ],
  '/v2/analysis/compare': [
    'filter.type',
    'a.signal.interests.entities', // verified: bare signal.* names are rejected 400
    'b.signal.interests.entities',
    'a.signal.location.query',
    'b.signal.location.query',
    'take',
  ],
  '/v2/trending': [
    'filter.type',
    'signal.interests.entities',
    'filter.start_date', // required by the API
    'filter.end_date',   // required by the API; endpoint returns 0 rows on this key
    'take',
  ],
};

const TREND_VALUES = ['off', 'very_low', 'low', 'mid', 'medium', 'high', 'very_high'];

/** Extra per-param value rules, enforced locally because the API rejects late. */
function valueIsSensible(endpoint: string, param: string, value: string | number): string | null {
  if (param === 'filter.popularity.min' || param === 'filter.popularity.max') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return `must be a float between 0 and 1, got ${value}`;
    }
  }
  if (param === 'bias.trends' && !TREND_VALUES.includes(String(value))) {
    return `must be one of ${TREND_VALUES.join('|')}, got ${value}`;
  }
  if (param === 'filter.type' && endpoint === '/v2/insights') {
    const ok = ['urn:entity:artist', 'urn:entity:brand', 'urn:entity:place', 'urn:entity:movie', 'urn:entity:tv_show', 'urn:tag', 'urn:demographics', 'urn:heatmap'];
    if (!ok.includes(String(value))) return `unverified filter.type ${value}`;
  }
  return null;
}

/** Throw AllowlistViolation for any unknown or badly-formed parameter. */
export function assertAllowed(endpoint: string, params: Record<string, string | number | undefined>): void {
  const allowed = ALLOWED_PARAMS[endpoint];
  if (!allowed) throw new AllowlistViolation(endpoint, '*', `no verified contract for ${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (!allowed.includes(k)) throw new AllowlistViolation(endpoint, k, 'not in the verified set');
    // One value per name, always. An array or object would reach the URL through
    // String(v) — "a,b" for a list, "[object Object]" otherwise — so a caller that
    // forgot to join deliberately would quietly change the request, and a repeated
    // name would be collapsed to its last value. Comma lists are built by the
    // caller that knows the parameter takes one; the transport refuses anything else.
    if (Array.isArray(v) || typeof v === 'object') {
      throw new AllowlistViolation(endpoint, k, 'array or object value would collapse in the URL — join a list before calling');
    }
    const bad = valueIsSensible(endpoint, k, v);
    if (bad) throw new AllowlistViolation(endpoint, k, bad);
  }
}

export function allowlistFor(endpoint: string): string[] {
  return ALLOWED_PARAMS[endpoint] ?? [];
}
