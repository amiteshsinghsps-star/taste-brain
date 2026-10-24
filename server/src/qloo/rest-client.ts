// Qloo REST client.
//
// Security rules (hard):
//  - The API key is read only from env.QLOO_API_KEY and used only in X-Api-Key.
//  - It is never logged, never returned in a response, never sent to the client.
//  - Raw Qloo responses are written ONLY to the gitignored private cache.
//  - Log entries carry ids, counts and parameter hashes only.
//
// Contract facts verified live on the hackathon key (2026-10-24):
//  - Base URL https://hackathon.api.qloo.com, GET only, auth header X-Api-Key.
//  - /search params: query, type.
//  - /v2/tags param: filter.query -> results.tags[].id like urn:tag:subgenre:qloo:indie
//  - /v2/insights params: filter.type, take, signal.interests.entities,
//    signal.interests.tags, signal.location.query, filter.location.query,
//    filter.exclude.entities, filter.exclude.tags, filter.results.entities,
//    filter.popularity.min/max (floats 0..1), bias.trends (enum).
//  - Entity results carry NO affinity/score field. Qloo's relevance ordering is
//    the signal; results also carry popularity (0..1) and properties such as
//    obscurity_scale, primary_genres, short_descriptions, plus external.spotify
//    followers and external.lastfm listeners.
//  - Rate limit is 100001: a 100-request burst over 5 seconds (429).
//  - filter.popularity.min as an integer returns 400; filter.location as plain
//    text returns 400; trending requires filter.start_date and filter.end_date.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { env, qlooKeyStatus, qlooRestEnabled } from '../config/env';
import { assertAllowed, AllowlistViolation } from './allowlist';
import type { QlooEntityResult, QlooTagRef, TasteMode } from '../types';

// ── Call log ────────────────────────────────────────────────────────────────

let _seq = 0;

export interface RestCallLogEntry {
  seq: number;
  workflow: string;
  path: string;
  status: number;
  latency_ms: number;
  cache_hit: boolean;
  mode: TasteMode;
  entity_count: number;
  inputs_redacted: Record<string, unknown>;
  at: string;
}

const _restLog: RestCallLogEntry[] = [];
const _violations: { endpoint: string; param: string; detail: string; at: string }[] = [];

export function getRestLog(): RestCallLogEntry[] { return _restLog.slice(-200).reverse(); }
export function getAllowlistViolations() { return _violations.slice(-50).reverse(); }

function addRestLog(entry: Omit<RestCallLogEntry, 'seq' | 'at'>) {
  const e: RestCallLogEntry = { seq: ++_seq, at: new Date().toISOString(), ...entry };
  _restLog.push(e);
}

// ── Private cache (gitignored) ──────────────────────────────────────────────

function privateCache(): string {
  const dir = path.resolve(path.join(__dirname, '../../', env.QLOO_PRIVATE_CACHE_DIR));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cacheFilePath(method: string, endpointPath: string, params: Record<string, string | number | undefined>): string {
  const sorted = Object.entries(params).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const hash = crypto.createHash('sha256').update(`${method}:${endpointPath}:${sorted}`).digest('hex').slice(0, 16);
  return path.join(privateCache(), `${hash}.json`);
}

function readPrivateCache(file: string): { data: unknown; fetched_at: string } | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

function writePrivateCache(file: string, data: unknown): void {
  try { fs.writeFileSync(file, JSON.stringify({ data, fetched_at: new Date().toISOString() })); } catch { /* non-fatal */ }
}

// ── Caches and throttling ───────────────────────────────────────────────────

const _inFlight = new Map<string, Promise<unknown>>();
const _memCache = new Map<string, { value: unknown; fetched_at: string }>();
const MEM_MAX = 300;

function memGet(key: string) {
  const e = _memCache.get(key);
  if (e) { _memCache.delete(key); _memCache.set(key, e); }
  return e ?? null;
}
function memSet(key: string, value: unknown, fetched_at: string) {
  if (_memCache.size >= MEM_MAX) {
    const first = _memCache.keys().next().value;
    if (first !== undefined) _memCache.delete(first);
  }
  _memCache.set(key, { value, fetched_at });
}

let _lastCallTime = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const now = Date.now();
  const elapsed = now - _lastCallTime;
  const min = Math.max(env.QLOO_THROTTLE_MS, 220); // ~4.5 req/s, under the 100-per-5s burst cap
  if (elapsed < min) await sleep(min - elapsed);
  _lastCallTime = Date.now();
}

// ── Daily quota tracker ─────────────────────────────────────────────────────

let _dailyCalls = 0;
let _dailyResetDate = new Date().toDateString();
// Only ever bumped where bytes actually crossed the wire. The call-log screen
// quotes it to prove that a Cached row came from disk, not from Qloo.
let _networkCalls = 0;

export function networkCallCount() { return _networkCalls; }

function countCall(): boolean {
  const today = new Date().toDateString();
  if (today !== _dailyResetDate) { _dailyCalls = 0; _dailyResetDate = today; }
  _dailyCalls++;
  return _dailyCalls <= env.QLOO_DAILY_SOFT_LIMIT;
}

export function quotaStatus() {
  return { used: _dailyCalls, soft_limit: env.QLOO_DAILY_SOFT_LIMIT, within_limit: _dailyCalls <= env.QLOO_DAILY_SOFT_LIMIT };
}

// ── HTTP ────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = env.QLOO_TIMEOUT_MS;
const MAX_RETRIES = 3;

export class QlooApiError extends Error {
  constructor(message: string, public status: number, public body?: string) { super(message); this.name = 'QlooApiError'; }
}

async function qlooFetch(endpointPath: string, params: Record<string, string | number | undefined>) {
  assertAllowed(endpointPath, params); // throws AllowlistViolation before anything leaves the box
  // The one network exit in this module. Nothing reaches `fetch` unless live Qloo
  // is switched on for this host, whatever mode the caller asked for.
  if (!qlooRestEnabled()) throw new QlooApiError(`live Qloo is disabled on this host — refusing to call ${endpointPath}`, 0);
  const baseUrl = env.QLOO_BASE_URL.replace(/\/+$/, '');
  const url = new URL(baseUrl + endpointPath);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

  await throttle();

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'X-Api-Key': env.QLOO_API_KEY!, Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const latency_ms = Date.now() - start;
      const text = await res.text();
      let data: unknown = null;
      try { data = JSON.parse(text); } catch { /* keep text for the error message */ }

      if (res.status === 429 || res.status >= 500) {
        lastError = new QlooApiError(`Qloo ${res.status}`, res.status, text.slice(0, 200));
        if (attempt < MAX_RETRIES) {
          // 100001 is a burst window: back off hard enough to clear 5 seconds.
          const backoff = res.status === 429 ? 2000 * (attempt + 1) : Math.min(1000 * 2 ** attempt, 8000);
          await sleep(backoff + Math.random() * 200);
          continue;
        }
        throw lastError;
      }
      if (!res.ok) {
        // 400 = our contract is wrong, not transient. Surface it, do not retry.
        throw new QlooApiError(`Qloo ${res.status} on ${endpointPath}`, res.status, text.slice(0, 300));
      }
      return { data, status: res.status, latency_ms };
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof QlooApiError && err.status === 400) throw err;
      if (err?.name === 'AbortError') throw new QlooApiError(`Qloo request timeout after ${TIMEOUT_MS}ms`, 0);
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(1000 * 2 ** attempt + Math.random() * 200);
    }
  }
  throw lastError instanceof Error ? lastError : new QlooApiError('Qloo fetch failed', 0);
}

// ── Response parsing ────────────────────────────────────────────────────────

function rawResults(data: any): any[] {
  if (!data || typeof data !== 'object') return [];
  const r = data.results;
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.entities)) return r.entities;
  if (Array.isArray(r?.tags)) return r.tags;
  if (Array.isArray(data.entities)) return data.entities;
  if (Array.isArray(data.tags)) return data.tags;
  return [];
}

/** English short description, falling back to the longer biography. */
function pickDescription(props: any): string | undefined {
  const shorts = Array.isArray(props?.short_descriptions) ? props.short_descriptions : [];
  const en = shorts.find((s: any) => Array.isArray(s?.languages) && s.languages.includes('en'));
  if (en?.value) return String(en.value);
  if (shorts.length && typeof shorts[0]?.value === 'string') return shorts[0].value;
  if (typeof props?.description === 'string') return props.description;
  return undefined;
}

function toTagRefs(arr: any): QlooTagRef[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((t: any) => (typeof t === 'string'
      ? { id: t, name: t.split(':').pop() ?? t, type: 'urn:tag' }
      : { id: String(t.id ?? t.tag_id ?? ''), name: String(t.name ?? t.id ?? ''), type: String(t.type ?? t.subtype ?? 'urn:tag') }))
    .filter((t) => t.id || t.name);
}

/**
 * Map a raw Qloo entity into our result type.
 * `fit` is derived from Qloo's own result ORDER (rank), not invented:
 *   fit = 1 - (rank - 1) / n, so rank 1 of n gets the highest fit.
 * The formula is stated on every evidence card.
 */
export function parseEntities(data: unknown, workflow: string, endpoint: string, mode: TasteMode, fetched_at: string): QlooEntityResult[] {
  const arr = rawResults(data);
  const n = Math.max(arr.length, 1);
  return arr.map((e: any, idx: number) => {
    const props = e.properties ?? {};
    const pop = typeof e.popularity === 'number' ? e.popularity : undefined;
    const spotify = Array.isArray(e.external?.spotify) ? e.external.spotify[0] : undefined;
    const lastfm = Array.isArray(e.external?.lastfm) ? e.external.lastfm[0] : undefined;
    const tags = toTagRefs(e.tags);
    const rank = idx + 1;
    return {
      entity_id: String(e.entity_id ?? e.id ?? ''),
      name: String(e.name ?? e.label ?? ''),
      type: String(e.subtype ?? e.type ?? '').replace(/^urn:entity:/, ''),
      qloo_rank: rank,
      fit: +(1 - (rank - 1) / n).toFixed(4),
      popularity: pop,
      obscurity: typeof props.obscurity_scale === 'number' ? props.obscurity_scale : undefined,
      followers: typeof spotify?.followers === 'number' ? spotify.followers : undefined,
      listeners: typeof lastfm?.listeners === 'number' ? lastfm.listeners : undefined,
      start_year: typeof props.start_year === 'number' ? props.start_year : undefined,
      primary_genres: Array.isArray(props.primary_genres) ? props.primary_genres.map(String) : [],
      qloo_tags: tags,
      tag_names: tags.map((t) => t.name.toLowerCase()),
      explainability: pickDescription(props),
      source: { workflow, mode, fetched_at, endpoint },
    };
  }).filter((r) => r.entity_id);
}

function dedupeById(results: QlooEntityResult[]): QlooEntityResult[] {
  const seen = new Set<string>();
  const out: QlooEntityResult[] = [];
  for (const r of results) {
    if (!r.entity_id || seen.has(r.entity_id)) continue;
    seen.add(r.entity_id);
    out.push(r);
  }
  // Re-derive fit over the deduped order so the derived value stays truthful.
  out.forEach((r, i) => { r.qloo_rank = i + 1; r.fit = +(1 - i / Math.max(out.length, 1)).toFixed(4); });
  return out;
}

// ── Core cached fetch ───────────────────────────────────────────────────────

async function cachedFetch(
  workflow: string,
  endpointPath: string,
  params: Record<string, string | number | undefined>,
): Promise<{ data: unknown; mode: TasteMode; fetched_at: string }> {
  const file = cacheFilePath('GET', endpointPath, params);
  const mem = memGet(file);
  if (mem) {
    addRestLog({ workflow, path: endpointPath, status: 200, latency_ms: 0, cache_hit: true, mode: 'cached', entity_count: rawResults(mem.value).length, inputs_redacted: { params_hash: path.basename(file, '.json'), fetched_at: mem.fetched_at } });
    return { data: mem.value, mode: 'cached', fetched_at: mem.fetched_at };
  }
  const persisted = readPrivateCache(file);
  if (persisted) {
    memSet(file, persisted.data, persisted.fetched_at);
    addRestLog({ workflow, path: endpointPath, status: 200, latency_ms: 0, cache_hit: true, mode: 'cached', entity_count: rawResults(persisted.data).length, inputs_redacted: { params_hash: path.basename(file, '.json'), fetched_at: persisted.fetched_at } });
    return { data: persisted.data, mode: 'cached', fetched_at: persisted.fetched_at };
  }
  if (_inFlight.has(file)) {
    const data = await (_inFlight.get(file) as Promise<unknown>);
    return { data, mode: 'live', fetched_at: new Date().toISOString() };
  }
  // The single gate on leaving this box. QLOO_ENABLED=false means the key is
  // present but live is switched off, and a Cached request must then be served
  // from the private cache or the fixtures — never from the network. Without
  // this, "no live key on this host" was only true of the session mode, and a
  // cache miss still spent real quota.
  if (!qlooRestEnabled()) throw new QlooApiError('live Qloo is disabled on this host', 0);
  if (!countCall()) throw new QlooApiError('QLOO_QUOTA_EXCEEDED', 0);

  const at = new Date().toISOString();
  const promise = qlooFetch(endpointPath, params).then(({ data, status, latency_ms }) => {
    _networkCalls++;
    _inFlight.delete(file);
    if (status >= 200 && status < 300) { writePrivateCache(file, data); memSet(file, data, at); }
    addRestLog({ workflow, path: endpointPath, status, latency_ms, cache_hit: false, mode: 'live', entity_count: rawResults(data).length, inputs_redacted: { params_hash: path.basename(file, '.json') } });
    return data;
  });
  _inFlight.set(file, promise);
  const data = await promise;
  return { data, mode: 'live', fetched_at: at };
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface InsightsParams {
  filterType: string;
  signalEntities?: string[];
  signalTags?: string[];
  filterLocationQuery?: string;
  signalLocationQuery?: string;
  excludeEntities?: string[];
  excludeTags?: string[];
  resultEntities?: string[];
  popularityMin?: number;
  popularityMax?: number;
  biasTrends?: string;
  take?: number;
}

function insightParams(p: InsightsParams): Record<string, string | number> {
  const out: Record<string, string | number> = { 'filter.type': p.filterType, take: p.take ?? 20 };
  if (p.signalEntities?.length) out['signal.interests.entities'] = p.signalEntities.join(',');
  if (p.signalTags?.length) out['signal.interests.tags'] = p.signalTags.join(',');
  if (p.filterLocationQuery) out['filter.location.query'] = p.filterLocationQuery;
  if (p.signalLocationQuery) out['signal.location.query'] = p.signalLocationQuery;
  if (p.excludeEntities?.length) out['filter.exclude.entities'] = p.excludeEntities.join(',');
  if (p.excludeTags?.length) out['filter.exclude.tags'] = p.excludeTags.join(',');
  if (p.resultEntities?.length) out['filter.results.entities'] = p.resultEntities.join(',');
  if (p.popularityMin !== undefined) out['filter.popularity.min'] = p.popularityMin;
  if (p.popularityMax !== undefined) out['filter.popularity.max'] = p.popularityMax;
  if (p.biasTrends) out['bias.trends'] = p.biasTrends;
  return out;
}

export async function search(query: string, type?: string): Promise<QlooEntityResult[]> {
  const params: Record<string, string> = { query };
  if (type) params.type = type;
  const { data, mode, fetched_at } = await cachedFetch('search', '/search', params);
  return parseEntities(data, 'search', '/search', mode, fetched_at);
}

export interface EntityResolution {
  status: 'resolved' | 'needs_input' | 'unresolved';
  entity_id?: string;
  name?: string;
  candidates?: QlooEntityResult[];
  input: string;
}

/** Seed resolution never guesses: one exact match resolves, several need input. */
export async function resolveEntity(input: string, type?: string): Promise<EntityResolution> {
  const results = await search(input, type);
  if (results.length === 0) return { status: 'unresolved', input };
  const exact = results.find((r) => r.name.toLowerCase().trim() === input.toLowerCase().trim());
  if (exact) return { status: 'resolved', entity_id: exact.entity_id, name: exact.name, input };
  if (results.length === 1) return { status: 'resolved', entity_id: results[0].entity_id, name: results[0].name, input };
  return { status: 'needs_input', candidates: results.slice(0, 6), input };
}

export async function findTags(keyword: string): Promise<QlooTagRef[]> {
  const { data } = await cachedFetch('find_tags', '/v2/tags', { 'filter.query': keyword });
  return toTagRefs((data as any)?.results?.tags ?? rawResults(data));
}

export async function insights(p: InsightsParams, workflow = 'insights'): Promise<{ entities: QlooEntityResult[]; mode: TasteMode }> {
  const { data, mode, fetched_at } = await cachedFetch(workflow, '/v2/insights', insightParams(p));
  return { entities: dedupeById(parseEntities(data, workflow, '/v2/insights', mode, fetched_at)), mode };
}

export async function recommend(p: {
  filterType: string; signalEntityIds: string[]; locationQuery?: string; take?: number;
  excludeEntities?: string[]; excludeTags?: string[]; popularityMin?: number; popularityMax?: number;
}): Promise<{ entities: QlooEntityResult[]; mode: TasteMode }> {
  return insights({
    filterType: p.filterType,
    signalEntities: p.signalEntityIds,
    filterLocationQuery: p.locationQuery,
    excludeEntities: p.excludeEntities,
    excludeTags: p.excludeTags,
    popularityMin: p.popularityMin,
    popularityMax: p.popularityMax,
    take: p.take ?? 20,
  }, 'recommend');
}

/** Location-free run of the same seeds: the comparison behind local lift + ablation. */
export async function recommendNoLocation(p: {
  filterType: string; signalEntityIds: string[]; take?: number;
}): Promise<{ entities: QlooEntityResult[]; mode: TasteMode }> {
  return insights({ filterType: p.filterType, signalEntities: p.signalEntityIds, take: p.take ?? 20 }, 'recommend_no_location');
}

/** Location-only run (no taste seeds): ablation arm B. Verified to return rows. */
export async function recommendLocationOnly(p: {
  filterType: string; locationQuery: string; take?: number;
}): Promise<{ entities: QlooEntityResult[]; mode: TasteMode }> {
  return insights({ filterType: p.filterType, signalLocationQuery: p.locationQuery, take: p.take ?? 20 }, 'recommend_location_only');
}

/** Same seeds with the trend bias applied: the comparison behind the rising chip. */
export async function recommendTrendBias(p: {
  filterType: string; signalEntityIds: string[]; locationQuery?: string; take?: number;
}): Promise<{ entities: QlooEntityResult[]; mode: TasteMode }> {
  return insights({
    filterType: p.filterType,
    signalEntities: p.signalEntityIds,
    signalLocationQuery: p.locationQuery,
    biasTrends: 'high',
    take: p.take ?? 20,
  }, 'recommend_trend_bias');
}

export async function rankShortlist(p: {
  filterType: string; signalEntityIds: string[]; candidateEntityIds: string[]; locationQuery?: string;
}): Promise<{ entities: QlooEntityResult[]; mode: TasteMode }> {
  return insights({
    filterType: p.filterType,
    signalEntities: p.signalEntityIds,
    resultEntities: p.candidateEntityIds,
    signalLocationQuery: p.locationQuery,
    take: p.candidateEntityIds.length,
  }, 'rank_shortlist');
}

/** Aggregate audience tags for a room. filter.type=urn:tag was verified live. */
export async function describeAudience(signalEntityIds: string[], locationQuery?: string): Promise<{ tags: QlooTagRef[]; mode: TasteMode }> {
  const { data, mode } = await cachedFetch('describe_audience', '/v2/insights', insightParams({
    filterType: 'urn:tag',
    signalEntities: signalEntityIds,
    filterLocationQuery: locationQuery,
    take: 25,
  }));
  return { tags: toTagRefs((data as any)?.results?.tags ?? rawResults(data)), mode };
}

/** Two rooms or two seed sets compared. Returns shared + distinguishing tags. */
export async function compareAudiences(a: { entities?: string[]; location?: string }, b: { entities?: string[]; location?: string }, filterType = 'urn:tag'): Promise<{ shared: QlooTagRef[]; distinguishing: QlooTagRef[]; mode: TasteMode }> {
  const params: Record<string, string | number> = { 'filter.type': filterType, take: 20 };
  if (a.entities?.length) params['a.signal.interests.entities'] = a.entities.join(',');
  if (b.entities?.length) params['b.signal.interests.entities'] = b.entities.join(',');
  if (a.location) params['a.signal.location.query'] = a.location;
  if (b.location) params['b.signal.location.query'] = b.location;
  if (!params['a.signal.interests.entities'] && !params['a.signal.location.query']) {
    const err = new AllowlistViolation('/v2/analysis/compare', 'a.signal.interests.entities', 'a-side signal required');
    _violations.push({ endpoint: '/v2/analysis/compare', param: 'a.signal', detail: err.detail, at: new Date().toISOString() });
    throw err;
  }
  const { data, mode } = await cachedFetch('compare', '/v2/analysis/compare', params);
  const r: any = (data as any)?.results ?? data ?? {};
  return {
    shared: toTagRefs(r.shared?.tags ?? r.shared ?? []),
    distinguishing: toTagRefs(r.distinguishing?.tags ?? r.tags ?? []),
    mode,
  };
}

export function qlooKeyPresent(): boolean { return qlooKeyStatus() === 'set'; }
export { AllowlistViolation };
