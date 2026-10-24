// Quota Guardian (F41).
//
// The hosted demo runs on a hackathon key with a shared budget, so live traffic
// is metered per visitor and globally, and a monthly floor switches live paths
// to Cached and then Replay rather than exhausting the key before judging ends.
// Counters live in SQLite so a restart does not silently reset the budget.

import { env } from '../config/env';
import { graph } from '../graph/store';
import type { QuotaState, TasteMode } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

function stamp(d = new Date()) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}
function hourStamp(d = new Date()) {
  return `${stamp(d)}${pad(d.getUTCHours())}`;
}

function keys(ip: string) {
  const d = new Date();
  return {
    visitor_hour: `vh:${ip}:${hourStamp(d)}`,
    visitor_day: `vd:${ip}:${stamp(d)}`,
    global_day: `gd:${stamp(d)}`,
    monthly: `mo:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`,
  };
}

function normalizeIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip;
}

/** Read current counters without incrementing. Used by /api/health. */
export function quotaState(ip: string | undefined): QuotaState {
  const k = keys(normalizeIp(ip));
  const st: QuotaState = {
    visitor_hour_used: graph.getCounter(k.visitor_hour),
    visitor_day_used: graph.getCounter(k.visitor_day),
    global_day_used: graph.getCounter(k.global_day),
    monthly_used: graph.getCounter(k.monthly),
    visitor_hour_limit: env.QUOTA_VISITOR_HOUR,
    visitor_day_limit: env.QUOTA_VISITOR_DAY,
    global_day_limit: env.QUOTA_GLOBAL_DAY,
    monthly_floor: env.QUOTA_MONTHLY_FLOOR,
    finals_override: env.FINALS_OVERRIDE,
    live_allowed: false,
    floor_reached: false,
  };
  st.floor_reached = st.monthly_used >= env.QUOTA_MONTHLY_FLOOR;
  st.live_allowed =
    !env.FINALS_OVERRIDE &&
    !st.floor_reached &&
    st.visitor_hour_used < env.QUOTA_VISITOR_HOUR &&
    st.visitor_day_used < env.QUOTA_VISITOR_DAY &&
    st.global_day_used < env.QUOTA_GLOBAL_DAY;
  return st;
}

/** Take the visitor's place in the budget. One reservation per live run, however
 *  many Qloo calls that run ends up making. Returns false when we must degrade. */
export function reserveLiveCall(ip: string | undefined): { ok: boolean; reason: string; state: QuotaState } {
  const state = quotaState(ip);
  // Finals Mode (F48): the stage demo must not depend on the network or the key,
  // so live calls are held back and the stored answer is served instead.
  if (env.FINALS_OVERRIDE) return { ok: false, reason: 'Finals Mode is on: live calls are held back so the demo runs on stored results', state };
  if (state.floor_reached) return { ok: false, reason: `monthly floor of ${state.monthly_floor} calls reached`, state };
  if (state.visitor_hour_used >= state.visitor_hour_limit) return { ok: false, reason: 'this visitor hit the hourly live-run budget', state };
  if (state.visitor_day_used >= state.visitor_day_limit) return { ok: false, reason: 'this visitor hit the daily live-run budget', state };
  if (state.global_day_used >= env.QUOTA_GLOBAL_DAY) return { ok: false, reason: 'the demo hit its global daily live-run budget', state };

  const k = keys(normalizeIp(ip));
  graph.bumpCounter(k.visitor_hour, 1);
  graph.bumpCounter(k.visitor_day, 1);
  graph.bumpCounter(k.global_day, 1);
  graph.bumpCounter(k.monthly, 1);
  return { ok: true, reason: '', state: quotaState(ip) };
}

/** The mode a request actually gets, after the guardian has had its say. */
export function effectiveMode(requested: TasteMode | undefined, ip: string | undefined): { mode: TasteMode; degraded_from?: TasteMode; reason: string } {
  const base = requested ?? env.DEFAULT_MODE;
  if (base !== 'live') return { mode: base, reason: '' };
  if (!qlooKeyAvailable()) {
    // A key sitting unused is a different fact from no key at all, and the
    // operator reading the badge needs the one that is true.
    const why = env.QLOO_API_KEY && env.QLOO_API_KEY.length > 0
      ? 'A Qloo key is present but live is switched off on this host (QLOO_ENABLED=false)'
      : 'No Qloo credential on this host';
    return { mode: 'cached', degraded_from: 'live', reason: `${why} — serving from the private cache, then from synthetic fixtures.` };
  }
  const { ok, reason, state } = reserveLiveCall(ip);
  if (ok) return { mode: 'live', reason: '' };
  if (state.floor_reached) {
    return { mode: 'replay', degraded_from: 'live', reason: `Monthly call floor reached (${state.monthly_used}/${state.monthly_floor}). Serving labelled Replay data so the key lasts through judging.` };
  }
  return { mode: 'cached', degraded_from: 'live', reason: `${reason}. Serving the cached copy of the same Qloo result instead — the mode badge says Cached.` };
}

export function qlooKeyAvailable(): boolean {
  return env.QLOO_ENABLED && !!env.QLOO_API_KEY && env.QLOO_API_KEY.length > 0;
}

/** Coarse budget buckets for /api/health. No secrets, no visitor identities. */
export function healthBuckets(ip: string | undefined) {
  const s = quotaState(ip);
  const pct = (used: number, limit: number) => (limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100)));
  return {
    visitor_hour: `${pct(s.visitor_hour_used, s.visitor_hour_limit)}% of ${s.visitor_hour_limit} live runs`,
    visitor_day: `${pct(s.visitor_day_used, s.visitor_day_limit)}% of ${s.visitor_day_limit} live runs`,
    global_day: `${pct(s.global_day_used, s.global_day_limit)}% of ${s.global_day_limit} live runs`,
    monthly: `${pct(s.monthly_used, s.monthly_floor)}% of the ${s.monthly_floor}-run floor (one unit per live request)`,
    live_allowed: s.live_allowed,
    floor_reached: s.floor_reached,
    finals_override: s.finals_override,
  };
}
