// probe-params.ts — second verification round: find the exact parameter names the
// hackathon API accepts for popularity banding, shortlist ranking, audience skew,
// compare and trending, by reading the API's own 400 messages.
// Prints error text (not response payloads) and the property keys present on results.

import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  for (const f of [path.join(__dirname, '../.env'), path.join(process.cwd(), '.env')]) {
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
if (!KEY) { console.error('QLOO_API_KEY missing'); process.exit(1); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(pp: string, params: Record<string, string | number>, label: string) {
  await sleep(320);
  const url = new URL(BASE + pp);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url.toString(), { headers: { 'X-Api-Key': KEY, Accept: 'application/json' } });
    const text = await res.text();
    let data: any = null; try { data = JSON.parse(text); } catch { /* */ }
    const ents = data?.results?.entities ?? (Array.isArray(data?.results) ? data.results : []);
    console.log(`\n### ${label}\n  GET ${pp}?${new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString().slice(0, 200)}`);
    console.log(`  HTTP ${res.status} | entities=${Array.isArray(ents) ? ents.length : 0}`);
    if (res.status !== 200) console.log(`  ERROR BODY: ${text.slice(0, 400)}`);
    return { status: res.status, data, ents: Array.isArray(ents) ? ents : [] };
  } catch (e: any) {
    console.log(`\n### ${label}\n  FAILED ${e.message}`);
    return { status: 0, data: null, ents: [] };
  }
}

async function main() {
  // resolve one artist seed to get a real id
  const seed = await get('/search', { query: 'Bon Iver', type: 'urn:entity:artist' }, 'Q1 resolve Bon Iver');
  const id = seed.ents[0]?.entity_id ?? seed.ents[0]?.id;
  console.log('seed id resolved:', Boolean(id));

  // what fields does an insights result actually carry?
  const base = await get('/v2/insights', {
    'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'signal.location.query': 'Chicago, IL', take: 20,
  }, 'Q3 baseline artists for Chicago');
  const e0 = base.ents[0] ?? {};
  console.log('  result keys:', JSON.stringify(Object.keys(e0)));
  console.log('  properties keys:', JSON.stringify(Object.keys(e0.properties ?? {})));
  const pops = base.ents.map((e: any) => e.popularity ?? e.properties?.popularity);
  console.log('  popularity values:', JSON.stringify(pops));
  const affs = base.ents.map((e: any) => e.affinity ?? e.score);
  console.log('  affinity/score values:', JSON.stringify(affs.slice(0, 20)));
  if (e0.properties) {
    const sd = e0.properties.short_description ?? e0.properties.description;
    console.log('  explainability sample (first 200 chars):', String(sd ?? '(none)').slice(0, 200));
  }

  // popularity band parameter variants
  for (const variant of [
    { 'filter.popularity.min': 20 },
    { 'filter.popularity.max': 80 },
    { 'filter.popularity.min': 20, 'filter.popularity.max': 80, 'filter.type': 'urn:entity:brand' },
  ]) {
    await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'signal.location.query': 'Chicago, IL', take: 20, ...variant }, `Q7 variant ${JSON.stringify(variant)}`);
  }

  // shortlist ranking: use two artists from the baseline result set
  const two = base.ents.slice(1, 3).map((e: any) => e.entity_id ?? e.id).filter(Boolean);
  if (two.length) {
    await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'filter.results.entities': two.join(','), take: 2 }, `Q4 rank shortlist of returned artists ${two.length} ids`);
    await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': [id, ...two].join(','), 'filter.results.entities': two.join(','), 'signal.location.query': 'Chicago, IL', take: 2 }, 'Q4 shortlist with location');
  }

  // trending variants
  for (const pp of ['/v2/trending', '/trending']) {
    await get(pp, { 'filter.type': 'urn:entity:artist', take: 10 }, `Q8 ${pp}`);
  }
  await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'bias.trends': true, take: 10 }, 'Q8 bias.trends boolean');

  // audience skew / demographics variants
  await get('/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': id, take: 20 }, 'Q9 demographics without location');
  await get('/v2/insights', { 'filter.type': 'urn:demographics', 'signal.location.query': 'Chicago, IL', take: 20 }, 'Q9 demographics location only');

  // compare variants
  await get('/v2/analysis/compare', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'compare.interests.entities': id, take: 10 }, 'Q10 compare entity vs entity');
  await get('/v2/insights/compare', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'compare.interests.entities': id, take: 10 }, 'Q10 /v2/insights/compare');

  // heatmap variants
  await get('/v2/insights', { 'filter.type': 'urn:heatmap', 'signal.interests.entities': id, 'signal.location.query': 'Chicago, IL', take: 20 }, 'Q11 heatmap');

  // tags / exclusions by tag
  const tg = await get('/v2/tags', { 'filter.query': 'indie' }, 'Q2 tags indie');
  const tagId = tg.data?.results?.tags?.[0]?.id ?? tg.data?.results?.[0]?.id;
  console.log('  first tag id:', String(tagId ?? '(none)').slice(0, 40));
  if (tagId) {
    await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'filter.exclude.tags': tagId, take: 10 }, 'Q6 exclude by tag id');
    await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.tags': tagId, take: 10 }, 'Q3 signal by tag only');
  }

  // explainability feature flag
  const ex = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'feature.explainability': true, take: 5 }, 'Q5 feature.explainability');
  const ee = ex.ents[0] ?? {};
  console.log('  keys with explainability flag:', JSON.stringify(Object.keys(ee)), '| properties:', JSON.stringify(Object.keys(ee.properties ?? {})));

  console.log('\n=== done ===');
}
main().catch((e) => { console.error('fatal', e.message); process.exit(1); });
