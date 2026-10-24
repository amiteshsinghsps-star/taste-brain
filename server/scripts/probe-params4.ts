// probe-params4.ts — re-verify the three capabilities that came back empty or 400
// on the last sweep: Q4 shortlist ranking, Q8b /v2/trending, Q11 heatmap.
// Prints counts and parameter names only; the API key is never printed.

import * as fs from 'fs';
import * as path from 'path';

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

async function call(p: string, params: Record<string, string | number>) {
  const url = new URL(BASE + p);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  await sleep(350);
  const res = await fetch(url.toString(), { headers: { 'X-Api-Key': KEY, Accept: 'application/json' } });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, text };
}

function rows(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data.results)) return data.results;
  if (data.results && Array.isArray(data.results.entities)) return data.results.entities;
  if (data.results && Array.isArray(data.results.tags)) return data.results.tags;
  return [];
}

async function main() {
  if (!KEY) { console.error('no key'); process.exit(1); }

  const seedIds: string[] = [];
  for (const s of ['Vampire Weekend', 'Bon Iver', 'Phoebe Bridgers']) {
    const r = await call('/search', { query: s, type: 'urn:entity:artist' });
    const first = rows(r.data)[0];
    if (first) seedIds.push(String(first.entity_id ?? first.id));
  }
  console.log('seeds resolved:', seedIds.length);

  // Candidates are the artists Qloo actually returns for this audience.
  const rec = await call('/v2/insights', {
    'filter.type': 'urn:entity:artist',
    'signal.interests.entities': seedIds.join(','),
    'signal.location.query': 'Chicago, IL',
    take: 20,
  });
  const candidateIds = rows(rec.data).slice(0, 5).map((e: any) => String(e.entity_id ?? e.id));
  console.log('candidates:', candidateIds.length);

  const variants: [string, string, Record<string, string | number>][] = [
    ['Q4', 'shortlist = returned candidates', {
      'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds.join(','),
      'signal.location.query': 'Chicago, IL', 'filter.results.entities': candidateIds.join(','), take: 5,
    }],
    ['Q4b', 'shortlist with seeds as candidates', {
      'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds.slice(0, 2).join(','),
      'signal.location.query': 'Chicago, IL', 'filter.results.entities': candidateIds.join(','), take: 5,
    }],
    ['Q8b', 'trending filter.start_date/end_date', {
      'filter.type': 'urn:entity:artist', 'signal.interests.entities.ids': seedIds[0] ?? '',
      'filter.start_date': '2026-08-01', 'filter.end_date': '2026-10-01', take: 10,
    }],
    ['Q8c', 'trending one entity via entities', {
      'filter.type': 'urn:entity:artist', 'signal.interests.entities': seedIds[0] ?? '',
      'filter.start_date': '2026-08-01', 'filter.end_date': '2026-10-01', take: 10,
    }],
    ['Q11', 'heatmap with filter.location.query', {
      'filter.type': 'urn:heatmap', 'signal.interests.entities': seedIds.join(','),
      'filter.location.query': 'Chicago, IL', take: 10,
    }],
    ['Q11b', 'heatmap with filter.location', {
      'filter.type': 'urn:heatmap', 'signal.interests.entities': seedIds.join(','),
      'filter.location': 'Chicago, IL', take: 10,
    }],
  ];

  for (const [id, label, params] of variants) {
    const r = await call(id.startsWith('Q8') ? '/v2/trending' : '/v2/insights', params);
    const list = rows(r.data);
    console.log(`[${id}] ${label}: HTTP ${r.status} count=${list.length}${list.length ? ` first_params=${Object.keys(list[0]).slice(0, 8).join(',')}` : ''}`);
    if (r.status !== 200) console.log('      body:', r.text.slice(0, 220));
  }
}

main().catch((e) => { console.error('fatal:', e.message); process.exit(1); });
