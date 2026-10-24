// Qloo session adapter. One run gets one session, which owns:
//   - the mode actually served (live / cached / replay) and why it degraded,
//   - the per-run call budget (PRD §6.2: at most 12 Qloo calls per live run),
//   - the parameter allowlist enforcement and its violation record,
//   - the relax ladder for empty results,
//   - the redacted call log.
//
// Live   -> real REST calls, cached into the gitignored private cache.
// Cached -> the private cache from an earlier live call, or the run snapshot.
// Replay -> committed SYNTHETIC fixtures so a fresh clone works offline with no
//           credential. Replay data is never presented as live Qloo output.

import * as fs from 'fs';
import * as path from 'path';
import { env, qlooRestEnabled } from '../config/env';
import { graph } from '../graph/store';
import * as rest from './rest-client';
import { AllowlistViolation } from './allowlist';
import { effectiveMode } from '../agents/quota';
import type { QlooEntityResult, QlooTagRef, TasteMode } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Aggregate log across sessions, for the Qloo call log screen. Entries carry
// workflow, variant, mode, cache state and counts only — never payloads or keys.
const _globalLog: (SessionCallLog & { pack: string; location: string })[] = [];
function pushGlobalLog(e: SessionCallLog & { pack: string; location: string }) {
  _globalLog.push(e);
  if (_globalLog.length > 300) _globalLog.shift();
}
export function callLog(): (SessionCallLog & { pack: string; location: string })[] {
  return _globalLog.slice().reverse();
}
export function clearCallLog() { _globalLog.length = 0; }

export interface SessionCallLog {
  seq: number;
  workflow: string;
  variant: string;
  mode: TasteMode;
  cache_hit: boolean;
  endpoint: string;
  entity_count: number;
  /** Wall time of the adapter call, including any network wait it triggered. */
  latency_ms: number;
  /** Counts and shapes only — never the seed names, payloads or key. */
  inputs_redacted: Record<string, unknown>;
  at: string;
  note?: string;
}

export interface SessionOptions {
  pack: string;
  location: string;
  requestedMode?: TasteMode;
  ip?: string;
}

export interface Session {
  pack: string;
  location: string;
  mode: TasteMode;
  degrade_reason: string;
  calls: SessionCallLog[];
  violations: string[];
  relaxations: string[];
  live_calls: number;
  budget_left: () => number;
  resolveSeeds: (labels: string[], type: string) => Promise<{ ids: string[]; names: string[]; unresolved: { input: string; candidates: string[] }[]; mode: TasteMode }>;
  audienceTags: (seeds: string[], locationQuery?: string) => Promise<{ tags: QlooTagRef[]; mode: TasteMode }>;
  insights: (opts: {
    variant: string;
    filterType: string;
    seeds?: string[];
    locationQuery?: string;
    useLocation?: boolean;
    locationOnly?: boolean;
    trendBias?: boolean;
    excludeEntities?: string[];
    excludeTags?: string[];
    popularityMin?: number;
    popularityMax?: number;
    take?: number;
  }) => Promise<{ entities: QlooEntityResult[]; mode: TasteMode }>;
  compare: (a: { entities?: string[]; location?: string }, b: { entities?: string[]; location?: string }) => Promise<{ shared: QlooTagRef[]; distinguishing: QlooTagRef[]; mode: TasteMode }>;
}

function readFixture(pack: string, location: string, workflow: string): QlooEntityResult[] {
  const p = path.join(FIXTURES_DIR, `${pack}.${location}.${workflow}.json`);
  if (!fs.existsSync(p)) return [];
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const items: any[] = Array.isArray(raw) ? raw : raw.results ?? [];
  const at = raw.fetched_at ?? '1970-01-01T00:00:00.000Z';
  return items.map((it, i) => ({
    entity_id: String(it.entity_id),
    name: String(it.name),
    type: String(it.type ?? ''),
    qloo_rank: it.qloo_rank ?? i + 1,
    fit: it.fit ?? +(1 - i / Math.max(items.length, 1)).toFixed(4),
    popularity: it.popularity,
    obscurity: it.obscurity,
    followers: it.followers,
    listeners: it.listeners,
    primary_genres: Array.isArray(it.primary_genres) ? it.primary_genres : [],
    qloo_tags: Array.isArray(it.qloo_tags) ? it.qloo_tags : [],
    tag_names: (Array.isArray(it.qloo_tags) ? it.qloo_tags : []).map((t: QlooTagRef) => String(t.name).toLowerCase()),
    explainability: it.explainability,
    source: { workflow, mode: 'replay' as TasteMode, fetched_at: at, endpoint: 'fixture' },
  }));
}

/** Fixtures may be looked up per variant; fall back to the base workflow file. */
function fixtureFor(pack: string, location: string, workflow: string, variant: string): QlooEntityResult[] {
  const specific = readFixture(pack, location, `${workflow}.${variant}`);
  if (specific.length) return specific;
  if (variant === 'default') return readFixture(pack, location, workflow);
  return [];
}

/**
 * Whether this room has any committed candidate fixture at all. An absent file is
 * not an empty answer from Qloo, and a run must not report the ladder as having
 * relaxed filters when no query was ever made.
 */
export function hasReplayFixture(pack: string, location: string): boolean {
  if (!fs.existsSync(FIXTURES_DIR)) return false;
  const prefix = `${pack}.${location}.recommend`;
  return fs.readdirSync(FIXTURES_DIR).some((f) => f === `${prefix}.json` || f.startsWith(`${prefix}.`));
}

type SessionState = Pick<Session, 'pack' | 'location' | 'mode' | 'degrade_reason' | 'calls' | 'violations' | 'relaxations' | 'live_calls'>;

export function createSession(opts: SessionOptions): Session {
  const eff = effectiveMode(opts.requestedMode, opts.ip);
  let mode: TasteMode = eff.mode;
  if (mode === 'live' && !qlooRestEnabled()) {
    mode = 'cached';
    eff.reason = eff.reason || 'Live requested but no Qloo credential is configured on this host.';
  }

  // Mutable state; the Session object is assembled from it at the end of this
  // function so the counters and the call log stay the same objects.
  const s: SessionState = {
    pack: opts.pack,
    location: opts.location,
    mode,
    degrade_reason: eff.reason,
    calls: [],
    violations: [],
    relaxations: [],
    live_calls: 0,
  };

  const _logSink = (entry: Omit<SessionCallLog, 'seq' | 'at' | 'latency_ms'>, startedAt?: number) => {
    s.calls.push({
      seq: s.calls.length + 1,
      at: new Date().toISOString(),
      latency_ms: startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt),
      ...entry,
    });
    pushGlobalLog({ ...s.calls[s.calls.length - 1], pack: s.pack, location: s.location });
  };
  const logCall = _logSink;
  /** Bumped only when bytes crossed the wire, so a cache hit cannot claim a miss. */
  const netNow = () => rest.networkCallCount();

  // helper kept tiny: seeds are passed through closure set by insights/audience calls

  async function resolveSeeds(labels: string[], type: string): Promise<{ ids: string[]; names: string[]; unresolved: { input: string; candidates: string[] }[]; mode: TasteMode }> {
    const ids: string[] = [];
    const names: string[] = [];
    const unresolved: { input: string; candidates: string[] }[] = [];
    const modes: TasteMode[] = [];
    for (const label of labels) {
      const t0 = Date.now();
      const n0 = netNow();
      const inputs = { type, lookup_performed: s.mode !== 'replay' && qlooRestEnabled() };
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(label);
      if (isUuid) { ids.push(label); names.push(label); continue; }
      if (s.mode === 'replay' || !qlooRestEnabled()) {
        // Replay resolves by fixture lookup only; nothing is guessed.
        unresolved.push({ input: label, candidates: [] });
        continue;
      }
      try {
        const r = await rest.resolveEntity(label, type);
        // The step is stamped with where the answer came in, not what was asked for.
        const served: TasteMode = netNow() === n0 ? 'cached' : 'live';
        modes.push(served);
        logCall({ workflow: 'resolve_seed', variant: 'default', mode: served, cache_hit: served === 'cached', endpoint: '/search', entity_count: r.status === 'resolved' ? 1 : (r.candidates?.length ?? 0), inputs_redacted: inputs }, t0);
        if (r.status === 'resolved' && r.entity_id) { ids.push(r.entity_id); names.push(r.name ?? label); }
        else if (r.status === 'needs_input') unresolved.push({ input: label, candidates: (r.candidates ?? []).map((c) => c.name) });
        else unresolved.push({ input: label, candidates: [] });
      } catch (err: any) {
        const served: TasteMode = netNow() === n0 ? 'cached' : 'live';
        modes.push(served);
        logCall({ workflow: 'resolve_seed', variant: 'default', mode: served, cache_hit: served === 'cached', endpoint: '/search', entity_count: 0, inputs_redacted: inputs, note: String(err?.message ?? err).slice(0, 80) }, t0);
        unresolved.push({ input: label, candidates: [] });
      }
    }
    // Seeds given as ids touch no network, so an empty mode list is not a live read.
    const mode = modes.includes('live') ? 'live' : modes.length || s.mode !== 'replay' ? 'cached' : 'replay';
    return { ids, names, unresolved, mode };
  };

  async function audienceTags(seeds: string[], locationQuery?: string): Promise<{ tags: QlooTagRef[]; mode: TasteMode }> {
    const t0 = Date.now();
    const n0 = netNow();
    const inputs = { seed_count: seeds.length, location_supplied: Boolean(locationQuery) };
    const fx = readFixture(s.pack, s.location, 'audience_tags');
    if (s.mode === 'replay') {
      logCall({ workflow: 'audience_tags', variant: 'default', mode: 'replay', cache_hit: true, endpoint: 'fixture', entity_count: fx.length, inputs_redacted: inputs }, t0);
      return { tags: fx.map((f) => ({ id: f.entity_id, name: f.name, type: 'urn:tag' })), mode: 'replay' };
    }
    try {
      if (s.mode === 'live') s.live_calls++;
      const { tags, mode } = await rest.describeAudience(seeds, locationQuery);
      logCall({ workflow: 'audience_tags', variant: 'default', mode, cache_hit: netNow() === n0, endpoint: '/v2/insights', entity_count: tags.length, inputs_redacted: inputs }, t0);
      if (tags.length) return { tags, mode };
      if (fx.length) {
        s.relaxations.push('audience tags came back empty live; used the stored portrait for this room');
        return { tags: fx.map((f) => ({ id: f.entity_id, name: f.name, type: 'urn:tag' })), mode: 'cached' };
      }
      return { tags: [], mode };
    } catch (err: any) {
      if (err instanceof AllowlistViolation) { s.violations.push(`${err.endpoint} → ${err.param}: ${err.detail}`); throw err; }
      if (fx.length) {
        logCall({ workflow: 'audience_tags', variant: 'default', mode: 'cached', cache_hit: true, endpoint: 'fallback', entity_count: fx.length, inputs_redacted: inputs, note: String(err?.message ?? err).slice(0, 80) }, t0);
        return { tags: fx.map((f) => ({ id: f.entity_id, name: f.name, type: 'urn:tag' })), mode: 'cached' };
      }
      throw err;
    }
  };

  type InsightsOpts = Parameters<Session['insights']>[0];
  async function insights(o: InsightsOpts): Promise<{ entities: QlooEntityResult[]; mode: TasteMode }> {
    const t0 = Date.now();
    const n0 = netNow();
    const variant = o.variant;
    const workflow = 'recommend';
    const take = o.take ?? 20;
    const inputs = {
      filter_type: o.filterType,
      seed_count: (o.seeds ?? []).length,
      location_supplied: Boolean(o.locationQuery),
      use_location: o.useLocation !== false,
      excluded_entity_count: (o.excludeEntities ?? []).length,
      excluded_tag_count: (o.excludeTags ?? []).length,
      popularity_band: o.popularityMin === undefined && o.popularityMax === undefined ? 'run default' : [o.popularityMin ?? 'open', o.popularityMax ?? 'open'],
      take,
    };

    const buildLive = (): Promise<{ entities: QlooEntityResult[]; mode: TasteMode }> => {
      if (o.locationOnly) {
        return rest.recommendLocationOnly({ filterType: o.filterType, locationQuery: o.locationQuery ?? '', take });
      }
      if (o.trendBias) {
        return rest.recommendTrendBias({ filterType: o.filterType, signalEntityIds: o.seeds ?? [], locationQuery: o.useLocation === false ? undefined : o.locationQuery, take });
      }
      if (o.useLocation === false) {
        return rest.recommendNoLocation({ filterType: o.filterType, signalEntityIds: o.seeds ?? [], take });
      }
      return rest.recommend({
        filterType: o.filterType,
        signalEntityIds: o.seeds ?? [],
        locationQuery: o.locationQuery,
        excludeEntities: o.excludeEntities,
        excludeTags: o.excludeTags,
        popularityMin: o.popularityMin,
        popularityMax: o.popularityMax,
        take,
      });
    };

    if (s.mode === 'replay') {
      const fx = fixtureFor(s.pack, s.location, workflow, variant);
      logCall({ workflow, variant, mode: 'replay', cache_hit: true, endpoint: 'fixture', entity_count: fx.length, inputs_redacted: inputs }, t0);
      return { entities: fx, mode: 'replay' };
    }

    if (s.mode === 'live' && s.live_calls >= env.QLOO_MAX_CALLS_PER_RUN) {
      const fx = fixtureFor(s.pack, s.location, workflow, variant);
      s.relaxations.push(`per-run budget of ${env.QLOO_MAX_CALLS_PER_RUN} calls reached before "${variant}"; served the stored copy`);
      logCall({ workflow, variant, mode: 'cached', cache_hit: true, endpoint: 'budget', entity_count: fx.length, inputs_redacted: inputs }, t0);
      return { entities: fx, mode: 'cached' };
    }

    try {
      if (s.mode === 'live') s.live_calls++;
      const r = await buildLive();
      logCall({ workflow, variant, mode: r.mode, cache_hit: netNow() === n0, endpoint: '/v2/insights', entity_count: r.entities.length, inputs_redacted: inputs }, t0);
      return r;
    } catch (err: any) {
      if (err instanceof AllowlistViolation) {
        s.violations.push(`${err.endpoint} → ${err.param}: ${err.detail}`);
        throw err;
      }
      const fx = fixtureFor(s.pack, s.location, workflow, variant);
      if (fx.length) {
        logCall({ workflow, variant, mode: 'cached', cache_hit: true, endpoint: 'fallback', entity_count: fx.length, inputs_redacted: inputs, note: String(err?.message ?? err).slice(0, 80) }, t0);
        s.relaxations.push(`"${variant}" failed live (${String(err?.message ?? err).slice(0, 60)}); served the stored copy`);
        return { entities: fx, mode: 'cached' };
      }
      logCall({ workflow, variant, mode: s.mode, cache_hit: false, endpoint: 'fallback', entity_count: 0, inputs_redacted: inputs, note: String(err?.message ?? err).slice(0, 80) }, t0);
      throw err;
    }
  };

  async function compare(a: { entities?: string[]; location?: string }, b: { entities?: string[]; location?: string }): Promise<{ shared: QlooTagRef[]; distinguishing: QlooTagRef[]; mode: TasteMode }> {
    const t0 = Date.now();
    const n0 = netNow();
    const inputs = { a_seed_count: (a.entities ?? []).length, b_seed_count: (b.entities ?? []).length, a_location_supplied: Boolean(a.location), b_location_supplied: Boolean(b.location) };
    if (s.mode === 'replay' || !qlooRestEnabled()) {
      logCall({ workflow: 'compare', variant: 'default', mode: s.mode === 'replay' ? 'replay' : 'cached', cache_hit: true, endpoint: 'fixture', entity_count: 0, inputs_redacted: inputs }, t0);
      return { shared: [], distinguishing: [], mode: s.mode };
    }
    try {
      if (s.mode === 'live') s.live_calls++;
      const r = await rest.compareAudiences(a, b);
      logCall({ workflow: 'compare', variant: 'default', mode: r.mode, cache_hit: netNow() === n0, endpoint: '/v2/analysis/compare', entity_count: r.shared.length + r.distinguishing.length, inputs_redacted: inputs }, t0);
      return r;
    } catch (err: any) {
      if (err instanceof AllowlistViolation) { s.violations.push(`${err.endpoint} → ${err.param}: ${err.detail}`); throw err; }
      logCall({ workflow: 'compare', variant: 'default', mode: s.mode, cache_hit: false, endpoint: '/v2/analysis/compare', entity_count: 0, inputs_redacted: inputs, note: String(err?.message ?? err).slice(0, 80) }, t0);
      return { shared: [], distinguishing: [], mode: s.mode };
    }
  };

  // Persist the session mode so the coverage/log screens can report it.
  graph.upsertNode('Pack', `session:${opts.pack}:${opts.location}`, { mode, degrade_reason: eff.reason });
  return {
    pack: s.pack,
    location: s.location,
    mode: s.mode,
    degrade_reason: s.degrade_reason,
    calls: s.calls,
    violations: s.violations,
    relaxations: s.relaxations,
    // A spread would freeze the counter at 0 and every caller reading
    // session.live_calls would be told no call was made.
    get live_calls() { return s.live_calls; },
    budget_left: () => Math.max(0, env.QLOO_MAX_CALLS_PER_RUN - s.live_calls),
    resolveSeeds, audienceTags, insights, compare,
  };
}

/**
 * The mode the data actually arrived in. A live request whose every answer was
 * already in the private cache read nothing, so it must not be labelled live.
 */
export function servedMode(session: Session): TasteMode {
  if (session.mode !== 'live') return session.mode;
  return session.calls.some((c) => c.mode === 'live' && !c.cache_hit) ? 'live' : 'cached';
}

/**
 * Relax ladder (PRD §6.2 #3): when a constrained query comes back empty, loosen
 * one constraint at a time, in a fixed order, and record which step produced the
 * answer. An empty result is never silently presented as "no candidates".
 */
export const RELAX_ORDER = [
  'drop exclude_tags',
  'drop popularity band',
  'drop location filter (keep seeds and location signal)',
  'drop all but the first seed',
] as const;

export type RelaxStep = (typeof RELAX_ORDER)[number];
