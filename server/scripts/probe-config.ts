// probe-config.ts — resolve the values the venue pack needs as configuration:
// taste-seed entity names that actually resolve, and real Qloo tag ids for the
// content-policy rules. Seed names come in from the operator or the private
// overlay; what this script prints belongs in server/.private-data/, never in a
// tracked pack file. The API key is never printed.

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(p: string, params: Record<string, string | number>) {
  const url = new URL(BASE + p);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  await sleep(320);
  const res = await fetch(url.toString(), { headers: { 'X-Api-Key': KEY, Accept: 'application/json' } });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: null }; }
}

function rows(d: any): any[] {
  if (!d) return [];
  if (Array.isArray(d.results)) return d.results;
  if (d.results && Array.isArray(d.results.tags)) return d.results.tags;
  if (d.results && Array.isArray(d.results.entities)) return d.results.entities;
  if (Array.isArray(d.tags)) return d.tags;
  return [];
}

async function main() {
  if (!KEY) { console.error('no key'); process.exit(1); }

  console.log('--- seed resolution (exact-name match only) ---');
  for (const name of [...probeNames('artist'), ...probeNames('place')]) {
    const r = await get('/search', { query: name, type: 'urn:entity:artist', take: 3 });
    const first = rows(r.data)[0];
    console.log(`artist "${name}": HTTP ${r.status} top="${first?.name ?? '-'}" exact=${first ? String(first.name).toLowerCase() === name.toLowerCase() : false}`);
  }
  for (const name of probeNames('place')) {
    const r = await get('/search', { query: name, type: 'urn:entity:place', take: 3 });
    const list = rows(r.data);
    console.log(`place "${name}": HTTP ${r.status} top="${list[0]?.name ?? '-'}" others=${list.slice(1, 3).map((x: any) => x.name).join(' | ')}`);
  }

  console.log('\n--- ablation arm shapes ---');
  const seeds: string[] = [];
  for (const name of probeNames('artist').slice(0, 2)) {
    const r = await get('/search', { query: name, type: 'urn:entity:artist', take: 3 });
    const first = rows(r.data).find((x: any) => String(x.name).toLowerCase() === name.toLowerCase()) ?? rows(r.data)[0];
    if (first) seeds.push(String(first.entity_id ?? first.id));
  }
  console.log(`resolved ${seeds.length} seeds for the ablation arms`);
  const noloc = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seeds.join(','), take: 15 });
  console.log(`arm C seeds-only (no location): HTTP ${noloc.status} count=${rows(noloc.data).length}`);
  const loconly = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.location.query': 'Chicago, IL', take: 15 });
  console.log(`arm B location only (no seeds): HTTP ${loconly.status} count=${rows(loconly.data).length}${loconly.status !== 200 ? ' body=' + JSON.stringify(loconly.data).slice(0, 200) : ''}`);
  const trend = await get('/v2/insights', { 'filter.type': 'urn:entity:artist', 'signal.interests.entities': seeds.join(','), 'signal.location.query': 'Chicago, IL', 'bias.trends': 'high', take: 15 });
  console.log(`rising comparison bias.trends=high: HTTP ${trend.status} count=${rows(trend.data).length}`);

  console.log('\n--- tag ids for the content policy ---');
  for (const q of ['explicit', 'indie', 'live music', 'nightlife', 'singer-songwriter', 'ambient']) {
    const r = await get('/v2/tags', { 'filter.query': q, take: 8 });
    const list = rows(r.data);
    console.log(`tag "${q}": HTTP ${r.status} ${list.slice(0, 6).map((t: any) => `${t.tag_id ?? t.id}="${t.name}"`).join(' , ')}`);
  }
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
