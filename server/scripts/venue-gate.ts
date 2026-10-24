// venue-gate.ts — PRD §3.2 decision gate + §6.1 capability verification against live Qloo.
//
// Writes statuses, counts, parameter NAMES and dates to
// server/verification/gate-report.json. Entity ids that appear inside request
// parameters are tokenised on the way out (see redactEntityIds); raw responses go
// to the gitignored private cache and never into this file.
// The API key is never printed.

import * as fs from 'fs';
import * as path from 'path';
import { probeNames } from './probe-input';

function loadEnv() {
  for (const f of [path.join(__dirname, '../.env'), path.join(process.cwd(), '.env'), path.join(process.cwd(), 'server/.env')]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const p = line.indexOf('=');
      if (p === -1) continue;
      const k = line.slice(0, p).trim();
      let v = line.slice(p + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
loadEnv();

const BASE = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/+$/, '');
const KEY = process.env.QLOO_API_KEY || '';
if (!KEY) { console.error('QLOO_API_KEY missing in server/.env'); process.exit(1); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Probe {
  id: string;            // capability id, e.g. "Q3"
  label: string;
  path: string;
  params: Record<string, string | number>;
  note?: string;
}

interface Row extends Probe {
  status: number;
  count: number;
  with_location: number;
  without_location: number;
  top_names: string[];
  popularity_present: boolean;
  explainability_present: boolean;
  affinity_field: string | null;
  error?: string;
}

const rows: Row[] = [];

/**
 * Qloo entity ids are 36-character UUIDs, and a probe sends the ones it resolved
 * from a live response back as request parameters. Recording the parameter names
 * is the point; recording the values would put response data in the repository.
 * Each distinct id becomes a stable token so an A/B row still reads as a
 * comparison — the real ids live in the gitignored private cache.
 *
 * Seed query names go through the same treatment: they are the names this run
 * asked Qloo to resolve, and a committed row naming a real artist is Qloo data
 * in the public repo whether it came back or went in.
 */
const seedTokens = new Map<string, string>();

function seedToken(name: string): string {
  const key = name.toLowerCase();
  let token = seedTokens.get(key);
  if (!token) { token = `qloo-seed-${seedTokens.size + 1}`; seedTokens.set(key, token); }
  return token;
}

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactEntityIds<T>(value: T, seen = new Map<string, string>()): T {
  if (typeof value === 'string') {
    let out = value;
    for (const [name, token] of seedTokens) out = out.replace(new RegExp(escapeForRegExp(name), 'ig'), token);
    return out.replace(
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
      (id) => {
        const upper = id.toUpperCase();
        let token = seen.get(upper);
        if (!token) { token = `qloo-entity-${seen.size + 1}`; seen.set(upper, token); }
        return token;
      },
    ) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => redactEntityIds(v as any, seen)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactEntityIds(v as any, seen)])) as unknown as T;
  }
  return value;
}

async function call(p: Probe, extra: Record<string, string | number> = {}) {
  const url = new URL(BASE + p.path);
  for (const [k, v] of Object.entries({ ...p.params, ...extra })) url.searchParams.set(k, String(v));
  const t0 = Date.now();
  try {
    const res = await fetch(url.toString(), { headers: { 'X-Api-Key': KEY, Accept: 'application/json' } });
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, data, latency: Date.now() - t0, text };
  } catch (e: any) {
    return { status: 0, data: null, latency: Date.now() - t0, text: '', error: e.message };
  }
}

function entitiesOf(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  const r = data.results;
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.entities)) return r.entities;
  if (r && Array.isArray(r.tags)) return r.tags;
  if (Array.isArray(data.entities)) return data.entities;
  if (Array.isArray(data.tags)) return data.tags;
  return [];
}
function tagsOf(data: any): any[] {
  if (!data) return [];
  const r = data.results;
  if (r && Array.isArray(r.tags)) return r.tags;
  if (Array.isArray(data.tags)) return data.tags;
  return [];
}

function summarize(p: Probe, data: any, status: number, error?: string): Row {
  const ents = entitiesOf(data);
  const first = ents[0] ?? {};
  const props = first.properties ?? {};
  return {
    ...p,
    status,
    count: ents.length,
    with_location: 0,
    without_location: 0,
    top_names: ents.slice(0, 5).map((e: any) => String(e.name ?? e.id ?? '').slice(0, 40)),
    popularity_present: typeof first.popularity === 'number' || typeof props.popularity === 'number',
    explainability_present: Boolean(props.short_description || props.description || first.explainability),
    affinity_field: typeof first.affinity === 'number' ? 'affinity' : typeof first.score === 'number' ? 'score' : null,
    error,
  };
}

/** Entity ids captured in memory for follow-up probes. Never written to the report. */
const idsByLabel = new Map<string, string[]>();

async function probe(p: Probe, captureKey?: string): Promise<Row> {
  await sleep(320);
  const r = await call(p);
  const row = summarize(p, r.data, r.status, r.error);
  rows.push(row);
  if (captureKey) idsByLabel.set(captureKey, entitiesOf(r.data).slice(0, 5).map((e: any) => String(e.entity_id ?? e.id)).filter(Boolean));
  console.log(`[${p.id}] ${p.label}: HTTP ${r.status} count=${row.count} pop=${row.popularity_present} expl=${row.explainability_present} affinity=${row.affinity_field ?? '-'}${row.error ? ' ERR=' + row.error : ''}`);
  if (row.top_names.length) console.log(`      top: ${row.top_names.join(' | ')}`);
  if (r.status !== 200) console.log(`      body: ${String(r.text).slice(0, 180)}`);
  return row;
}

async function probePair(p: Probe, withLoc: Record<string, string | number>, withoutLoc: Record<string, string | number>) {
  const a = await probe({ ...p, params: { ...p.params, ...withLoc } });
  const b = await probe({ ...p, id: p.id + '-noloc', label: p.label + ' (no location)' });
  a.with_location = a.count; b.without_location = b.count;
  return { withLoc: a, withoutLoc: b };
}

const CITIES: { id: string; name: string; query: string }[] = [
  { id: 'chicago', name: 'Chicago, IL', query: 'Chicago, IL' },
  { id: 'austin', name: 'Austin, TX', query: 'Austin, TX' },
  { id: 'nashville', name: 'Nashville, TN', query: 'Nashville, TN' },
];

// Seed artists: taste anchors only, never recommendations. The names come from the
// operator (--artists=, PROBE_ARTISTS) or the private overlay — see probe-input.ts.
const SEEDS = probeNames('artist');
// Tokenise before anything is written, so the first row already reads qloo-seed-1.
SEEDS.forEach(seedToken);

async function main() {
  console.log('=== TASTE BRAIN: VENUE DECISION GATE + CAPABILITY VERIFICATION ===');
  console.log(`base=${BASE} key=[PRESENT]\n`);

  // ── Q1 entity resolution (artist seeds) ────────────────────────────────────
  const seedIds: string[] = [];
  for (const s of SEEDS) {
    const p: Probe = { id: 'Q1', label: `resolve artist "${s}"`, path: '/search', params: { query: s, type: 'urn:entity:artist' } };
    const row = await probe(p);
    const first = entitiesOf((await call(p)).data)[0];
    if (first?.entity_id || first?.id) seedIds.push(String(first.entity_id ?? first.id));
  }
  console.log(`\nresolved ${seedIds.length}/${SEEDS.length} artist seeds\n`);

  // ── Q3 local artist recommendations per city (the gate) ────────────────────
  const gate: Record<string, { with_loc: number; pop_band: number; expl: boolean; names: string[] }> = {};
  for (const c of CITIES) {
    const base: Probe = {
      id: 'Q3', label: `artists for ${c.name}`, path: '/v2/insights',
      params: { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds.join(','), 'signal.location.query': c.query, take: 20 },
    };
    const withLoc = await probe(base, c.id === 'chicago' ? 'chicago_candidates' : undefined);

    const noLoc: Probe = { ...base, id: 'Q3-noloc', label: `artists (no location) ${c.id}`, params: { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds.join(','), take: 20 } };
    await sleep(320);
    const nr = await call(noLoc);
    const noLocCount = entitiesOf(nr.data).length;

    // Q7 popularity band — verified contract: filter.popularity.min/max are
    // FLOATS in 0..1. Integers are rejected with HTTP 400.
    const band: Probe = { ...base, id: 'Q7', label: `artists + popularity band ${c.id}`, params: { ...base.params, 'filter.popularity.min': 0.05, 'filter.popularity.max': 0.85 } };
    const bandRow = await probe(band);

    // Q5 explainability
    const expl: Probe = { ...base, id: 'Q5', label: `artists + explainability ${c.id}`, params: { ...base.params, 'feature.explainability': 'true' } };
    const explRow = await probe(expl);

    gate[c.name] = {
      with_loc: withLoc.count,
      pop_band: bandRow.count,
      expl: explRow.explainability_present,
      names: [],   // entity names are Qloo response data: printed live, never committed
    };
    console.log(`   ${c.name}: with-location=${withLoc.count} without=${noLocCount} band=${bandRow.count} expl=${explRow.explainability_present}`);
  }

  // ── Q6 exclusions ──────────────────────────────────────────────────────────
  const firstSeed = seedIds[0] ?? '';
  await probe({
    id: 'Q6', label: 'exclude one entity', path: '/v2/insights',
    params: { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds.join(','), 'signal.location.query': 'Chicago, IL', 'filter.exclude.entities': firstSeed, take: 10 },
  });

  // ── Q8 trend signal — verified contract: bias.trends takes an enum, not a bool ─
  await probe({ id: 'Q8', label: 'bias.trends=high', path: '/v2/insights', params: { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds.join(','), 'signal.location.query': 'Chicago, IL', 'bias.trends': 'high', take: 10 } });
  await probe({ id: 'Q8', label: 'bias.trends=bool (expect 400)', path: '/v2/insights', params: { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds.join(','), 'signal.location.query': 'Chicago, IL', 'bias.trends': 'true', take: 10 } });
  await probe({ id: 'Q8b', label: '/v2/trending without dates (expect 400)', path: '/v2/trending', params: { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds.join(','), take: 10 } });
  await probe({ id: 'Q8b', label: '/v2/trending (verified shape)', path: '/v2/trending', params: { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': firstSeed, 'filter.start_date': '2026-08-01', 'filter.end_date': '2026-10-01', take: 10 } });

  // ── Q4 shortlist ranking ───────────────────────────────────────────────────
  // Verified contract: filter.results.entities must name entities inside the
  // result space, so the shortlist is taken from this run's own candidates.
  const shortlist = (idsByLabel.get('chicago_candidates') ?? []).join(',');
  await probe({
    id: 'Q4', label: 'rank a shortlist', path: '/v2/insights',
    params: { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds.join(','), 'signal.location.query': 'Chicago, IL', 'filter.results.entities': shortlist, take: 5 },
  }, 'shortlist_ids');

  // ── Q2 tag resolution ──────────────────────────────────────────────────────
  await probe({ id: 'Q2', label: 'tags for "indie"', path: '/v2/tags', params: { 'filter.query': 'indie' } });

  // ── Q9 audience skew / Q10 compare / Q11 heatmap ───────────────────────────
  await probe({ id: 'Q9', label: 'demographics filter', path: '/v2/insights', params: { 'filter.type': 'urn:demographics', 'signal.interests.entities': seedIds.join(','), 'signal.location.query': 'Chicago, IL', take: 10 } });
  // Verified contract: compare takes a./b. prefixed signals, not compare.*.
  await probe({ id: 'Q10', label: 'compare two locations (a./b. prefixes)', path: '/v2/analysis/compare', params: { 'filter.type': 'urn:tag', 'a.signal.interests.entities': seedIds.join(','), 'a.signal.location.query': 'Chicago, IL', 'b.signal.interests.entities': seedIds.join(','), 'b.signal.location.query': 'Austin, TX', take: 10 } });
  await probe({ id: 'Q10b', label: 'compare two audiences (same city, different seeds)', path: '/v2/analysis/compare', params: { 'filter.type': 'urn:tag', 'a.signal.interests.entities': seedIds[0] ?? '', 'a.signal.location.query': 'Chicago, IL', 'b.signal.interests.entities': seedIds[1] ?? '', 'b.signal.location.query': 'Chicago, IL', take: 10 } });
  await probe({ id: 'Q11', label: 'heatmap (verified shape, expect rows=0)', path: '/v2/insights', params: { 'filter.type': 'urn:heatmap', 'signal.interests.entities': seedIds.join(','), 'filter.location.query': 'Chicago, IL', take: 10 } });

  // ── Q12 cross-domain partners (place / brand) ──────────────────────────────
  await probe({ id: 'Q12a', label: 'places for the same audience', path: '/v2/insights', params: { 'filter.type': 'urn:entity:place', 'signal.interests.entities': seedIds.join(','), 'signal.location.query': 'Chicago, IL', take: 10 } });
  await probe({ id: 'Q12b', label: 'brands for the same audience', path: '/v2/insights', params: { 'filter.type': 'urn:entity:brand', 'signal.interests.entities': seedIds.join(','), 'signal.location.query': 'Chicago, IL', take: 10 } });

  // ── Verdict ────────────────────────────────────────────────────────────────
  const perCity = Object.values(gate);
  const passDistinct = perCity.filter((g) => g.with_loc >= 10).length;
  const passBand = perCity.filter((g) => g.pop_band >= 5).length;
  const passExpl = perCity.filter((g) => g.expl).length;
  const gatePass = passDistinct === 3 && passBand === 3 && passExpl >= 1;

  console.log('\n=================== GATE RESULT ===================');
  console.log(`cities with >=10 distinct artists: ${passDistinct}/3`);
  console.log(`cities with >=5 after popularity band: ${passBand}/3`);
  console.log(`cities with non-empty explainability: ${passExpl}/3`);
  console.log(`DECISION: ${gatePass ? 'VENUES can be the lead pack' : 'VENUES FAILS the gate -> lead with RETAIL, venues become roadmap'}`);
  console.log('===================================================\n');

  const verified = rows.filter((r) => r.status === 200 && r.count > 0).map((r) => r.id.replace('-noloc', ''));
  const uniq = [...new Set(verified)];
  // Accepted by the API but empty on this key: honest "shape verified, no rows" state.
  const emptyOk = [...new Set(rows.filter((r) => r.status === 200 && r.count === 0).map((r) => r.id.replace('-noloc', '')))].filter((id) => !uniq.includes(id));
  // Rejected by the API with our parameter shape: recorded so the app refuses them.
  const rejected = [...new Set(rows.filter((r) => r.status >= 400).map((r) => r.id.replace('-noloc', '')))].filter((id) => !uniq.includes(id) && !emptyOk.includes(id));
  console.log(`capabilities returning live data: ${uniq.join(', ')} (${uniq.length} of 12)`);
  console.log(`accepted but empty on this key: ${emptyOk.join(', ') || '-'}`);
  console.log(`not usable with a verified shape: ${rejected.join(', ') || '-'}`);

  const outDir = path.join(__dirname, '../verification');
  fs.mkdirSync(outDir, { recursive: true });
  // Committed report carries statuses, counts, parameter NAMES and dates.
  // Entity names never enter this file at all; entity ids are replaced by stable
  // tokens, because an id a probe read out of a live response is response data.
  const redacted = redactEntityIds(rows.map(({ id, label, path: pp, params, status, count, popularity_present, explainability_present, affinity_field, error }) => ({
    id, label, path: pp, params, status, count, popularity_present, explainability_present, affinity_field, error,
  })));
  fs.writeFileSync(path.join(outDir, 'gate-report.json'), JSON.stringify({
    verified_at: new Date().toISOString(),
    base_url: BASE,
    gate: { per_city: gate, pass: gatePass },
    capabilities_verified: uniq,
    accepted_but_empty: emptyOk,
    not_usable: rejected,
    redaction: 'Qloo entity ids in request parameters are replaced by qloo-entity-N tokens, numbered by first appearance in this file. The same id always gets the same token, so an A/B comparison still reads as one. Real ids and raw responses stay in the gitignored private cache.',
    entity_ids_redacted: true,
    rows: redacted,
  }, null, 2));
  console.log('\nwrote server/verification/gate-report.json (counts, parameter names, statuses and dates; entity ids tokenised)');
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
