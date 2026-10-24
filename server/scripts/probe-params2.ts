// probe-params2.ts — third round: confirm corrected parameters and measure whether
// the location signal changes the ranking (needed for local-lift + Ablation Lab).

import * as fs from 'fs';
import * as path from 'path';
import { probeNames } from './probe-input';

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function results(data: any): { entities: any[]; tags: any[] } {
  const r = data?.results ?? {};
  return {
    entities: Array.isArray(r.entities) ? r.entities : Array.isArray(data?.entities) ? data.entities : Array.isArray(r) ? r : [],
    tags: Array.isArray(r.tags) ? r.tags : Array.isArray(data?.tags) ? data.tags : [],
  };
}

async function get(pp: string, params: Record<string, string | number>, label: string) {
  await sleep(320);
  const url = new URL(BASE + pp);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { 'X-Api-Key': KEY, Accept: 'application/json' } });
  const text = await res.text();
  let data: any = null; try { data = JSON.parse(text); } catch { /* */ }
  const rr = results(data);
  console.log(`\n### ${label}\n  HTTP ${res.status} | entities=${rr.entities.length} tags=${rr.tags.length}`);
  if (res.status !== 200) console.log(`  ERROR: ${text.slice(0, 320)}`);
  else if (rr.tags.length) console.log(`  tag sample: ${JSON.stringify(rr.tags.slice(0, 4).map((t: any) => t.name ?? t.id))}`);
  return { status: res.status, data, ...rr };
}

async function main() {
  const seedName = probeNames('artist')[0];
  const seed = await get('/search', { query: seedName, type: 'urn:entity:artist' }, `resolve ${seedName}`);
  const id = seed.entities[0]?.entity_id;

  // 1. popularity band with corrected 0..1 floats
  const all = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'signal.location.query': 'Chicago, IL', take: 20 }, 'artists baseline');
  const pops = all.entities.map((e) => e.popularity);
  console.log(`  popularity range: min=${Math.min(...pops).toFixed(4)} max=${Math.max(...pops).toFixed(4)}`);
  const band = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'signal.location.query': 'Chicago, IL', 'filter.popularity.min': 0.99, 'filter.popularity.max': 0.999, take: 20 }, 'Q7 popularity band 0.99-0.999');
  console.log(`  band kept ${band.entities.length}/20`);

  // 2. structure of tags + obscurity/derived fields on one artist
  const e0 = all.entities[0] ?? {};
  console.log(`\n  artist[0] name=${e0.name} popularity=${e0.popularity}`);
  console.log(`  artist[0].tags = ${JSON.stringify(e0.tags)?.slice(0, 300)}`);
  console.log(`  artist[0].external = ${JSON.stringify(e0.external)?.slice(0, 200)}`);
  const p = e0.properties ?? {};
  console.log(`  obscurity_scale=${p.obscurity_scale} complexity_scale=${p.complexity_scale} primary_genres=${JSON.stringify(p.primary_genres)}`);
  console.log(`  short_descriptions=${JSON.stringify(p.short_descriptions)?.slice(0, 200)}`);

  // 3. brands: is there an affinity/score field for brands?
  const brandName = probeNames('brand', 'retail')[0];
  const bseed = await get('/search', { query: brandName, type: 'urn:entity:brand' }, `resolve ${brandName}`);
  const bid = bseed.entities[0]?.entity_id;
  const brands = await get('/v2/insights', { 'filter.type': 'urn:entity:brand', 'signal.interests.entities': bid, 'filter.location.query': 'Austin, TX', take: 15 }, 'brands for Austin');
  const be = brands.entities[0] ?? {};
  console.log(`  brand[0] keys=${JSON.stringify(Object.keys(be))}`);
  console.log(`  brand[0] affinity=${be.affinity} score=${be.score} popularity=${be.popularity} rank=${be.rank}`);
  console.log(`  brand popularity values: ${JSON.stringify(brands.entities.map((x: any) => x.popularity))}`);

  // 4. does location change the artist ranking? (local lift evidence)
  const noLoc = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, take: 20 }, 'artists WITHOUT location');
  const a = all.entities.map((e: any) => e.entity_id);
  const b = noLoc.entities.map((e: any) => e.entity_id);
  const overlap10 = a.slice(0, 10).filter((x: string) => b.slice(0, 10).includes(x)).length;
  const sameOrder = a.slice(0, 10).every((x: string, i: number) => x === b[i]);
  console.log(`  location effect: overlap@10=${overlap10}/10 identicalOrder=${sameOrder}`);
  const chicagon = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'signal.location.query': 'Nashville, TN', take: 20 }, 'artists for Nashville');
  const c = chicagon.entities.map((e: any) => e.entity_id);
  console.log(`  Chicago vs Nashville overlap@10=${a.slice(0, 10).filter((x: string) => c.slice(0, 10).includes(x)).length}/10`);

  // 5. trending with required dates + bias.trends enum
  const y = new Date().getUTCFullYear();
  await get('/v2/trending', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'filter.start_date': `${y - 1}-01-01`, 'filter.end_date': `${y}-10-01`, take: 10 }, 'Q8 trending with dates');
  await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': id, 'bias.trends': 'high', take: 10 }, 'Q8 bias.trends=high');

  // 6. demographics / heatmap / compare with corrected params
  await get('/v2/insights', { 'filter.type': 'urn:demographics', 'signal.interests.entities': `${id}`, take: 20 }, 'Q9 demographics (tags parsed)');
  await get('/v2/insights', { 'filter.type': 'urn:heatmap', 'signal.interests.entities': id, 'filter.location.query': 'Chicago, IL', take: 20 }, 'Q11 heatmap with filter.location');
  await get('/v2/analysis/compare', { 'filter.type': 'urn:entity:artist', 'a.signal.interests.entities': id, 'b.signal.interests.entities': seed.entities[1]?.entity_id ?? id, take: 10 }, 'Q10 compare a./b.');

  // 7. explainability flag on brands + place cross-domain for co-promotion
  await get('/v2/insights', { 'filter.type': 'urn:entity:place', 'signal.interests.entities': id, 'filter.location.query': 'Chicago, IL', take: 10 }, 'Q12 places near room');

  console.log('\n=== done ===');
}
main().catch((e) => { console.error('fatal', e.message); process.exit(1); });
