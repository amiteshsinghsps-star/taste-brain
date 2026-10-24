// probe-params3.ts — confirm exclusion semantics, location-only signal, obscurity spread.
import * as fs from 'fs';
import * as path from 'path';
import { probeNames } from './probe-input';
function loadEnv() {
  for (const f of [path.join(__dirname, '../.env')]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const p = line.indexOf('='); if (p === -1) continue;
      const k = line.slice(0, p).trim(); let v = line.slice(p + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
loadEnv();
const BASE = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/+$/, '');
const KEY = process.env.QLOO_API_KEY || '';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(pp: string, params: Record<string, string | number>, label: string) {
  await sleep(320);
  const url = new URL(BASE + pp);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { 'X-Api-Key': KEY, Accept: 'application/json' } });
  const text = await res.text(); let data: any = null; try { data = JSON.parse(text); } catch { /* */ }
  const ents = data?.results?.entities ?? (Array.isArray(data?.results) ? data.results : []);
  console.log(`### ${label} -> HTTP ${res.status} n=${ents.length}`);
  if (res.status !== 200) console.log(`   ERR ${text.slice(0, 260)}`);
  return { status: res.status, ents: Array.isArray(ents) ? ents : [] };
}
async function main() {
  const seedName = probeNames('artist')[0];
  const s = await get('/search', { query: seedName, type: 'urn:entity:artist' }, 'seed');
  const id = s.ents[0].entity_id;
  const base = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'signal.location.query': 'Chicago, IL', take: 20 }, 'baseline');
  const victim = base.ents[0].entity_id;
  const excl = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'signal.location.query': 'Chicago, IL', 'filter.exclude.entities': victim, take: 20 }, 'exclude first entity');
  console.log(`   exclusion removed target: ${!excl.ents.some((e: any) => e.entity_id === victim)} (n=${excl.ents.length})`);
  const locOnly = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.location.query': 'Chicago, IL', take: 20 }, 'location-only signal');
  const placeName = probeNames('place')[0];
  const place = await get('/search', { query: placeName, type: 'urn:entity:place' }, `place seed ${placeName}`);
  console.log(`   place results: ${place.ents.slice(0, 3).map((e: any) => e.name).join(' | ')}`);
  const placeRec = place.ents[0] ? await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': place.ents[0].entity_id, 'signal.location.query': 'Chicago, IL', take: 20 }, 'artists seeded by the place itself') : { ents: [] };
  const spread = base.ents.map((e: any) => ({ n: e.name, obs: e.properties?.obscurity_scale, pop: +(e.popularity ?? 0).toFixed(3), followers: e.external?.spotify?.[0]?.followers }));
  console.log('   obscurity/popularity/followers:'); spread.forEach((x) => console.log(`     ${x.n} obs=${x.obs} pop=${x.pop} spotify_followers=${x.followers}`));
  // trending with dates, seeded by a place, and with a wider window
  const t = await get('/v2/trending', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'filter.start_date': '2025-01-01', 'filter.end_date': '2026-10-01', take: 10 }, 'trending wide window');
  if (t.ents.length) console.log(`   trending[0]: ${t.ents[0].name} keys=${JSON.stringify(Object.keys(t.ents[0]))}`);
  // multi-seed insights (3 artists) — the real room profile shape
  const seed2Name = probeNames('artist')[1] ?? seedName;
  const s2 = await get('/search', { query: seed2Name, type: 'urn:entity:artist' }, 'seed2');
  const multi = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': `${id},${s2.ents[0].entity_id}`, 'signal.location.query': 'Chicago, IL', take: 20 }, 'multi-seed with location');
  console.log(`   multi-seed top5: ${multi.ents.slice(0, 5).map((e: any) => e.name).join(' | ')}`);
  console.log('=== done ===');
}
main().catch((e) => { console.error(e.message); process.exit(1); });
