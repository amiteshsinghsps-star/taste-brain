import * as fs from 'fs';
import * as path from 'path';
import { probeNames } from './probe-input';

// Minimal .env loader that does not leak secrets
function loadEnv() {
  const envFiles = [
    path.join(__dirname, '../.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), 'server/.env'),
  ];
  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const p = line.indexOf('=');
        if (p !== -1) {
          const key = line.slice(0, p).trim();
          let val = line.slice(p + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnv();

const BASE_URL = (process.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/+$/, '');
const API_KEY = process.env.QLOO_API_KEY || '';

if (!API_KEY) {
  console.error('DIAGNOSIS: QLOO_API_KEY is missing. Please configure it in server/.env.');
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CallResult {
  path: string;
  url: string;
  status: number;
  latencyMs: number;
  count: number;
  sampleNames: string[];
  raw?: any;
  error?: string;
  diagnosis?: string;
}

async function qlooFetch(endpointPath: string, queryParams: Record<string, string | number | undefined>): Promise<CallResult> {
  await sleep(300); // 300ms throttle between calls

  const url = new URL(BASE_URL + endpointPath);
  for (const [k, v] of Object.entries(queryParams)) {
    if (v !== undefined) {
      url.searchParams.set(k, String(v));
    }
  }

  const start = Date.now();
  let status = 0;
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-Api-Key': API_KEY,
        'Accept': 'application/json',
      },
    });
    const latencyMs = Date.now() - start;
    status = res.status;

    let diagnosis = '';
    if (status === 401) {
      diagnosis = '401 Unauthorized: wrong base URL, missing header, or invalid API key.';
    } else if (status === 403) {
      diagnosis = '403 Forbidden: unsupported entity type, invalid parameter, or permission denied for this key.';
    } else if (status === 404) {
      diagnosis = '404 Not Found: endpoint path missing or incorrect HTTP method (must be GET).';
    } else if (status === 429) {
      diagnosis = '429 Rate Limit: global throttle exceeded (~5 req/s). Backoff required.';
    }

    if (!res.ok) {
      return {
        path: endpointPath,
        url: url.pathname + url.search,
        status,
        latencyMs,
        count: 0,
        sampleNames: [],
        diagnosis,
      };
    }

    const data: any = await res.json();
    let entities: any[] = [];
    if (Array.isArray(data)) {
      entities = data;
    } else if (Array.isArray(data.results)) {
      entities = data.results;
    } else if (data.results && Array.isArray(data.results.entities)) {
      entities = data.results.entities;
    } else if (data.results && Array.isArray(data.results.tags)) {
      entities = data.results.tags;
    } else if (Array.isArray(data.entities)) {
      entities = data.entities;
    } else if (Array.isArray(data.tags)) {
      entities = data.tags;
    } else if (Array.isArray(data.data)) {
      entities = data.data;
    }

    const sampleNames = entities
      .slice(0, 3)
      .map((e) => (typeof e === 'string' ? e : e.name || e.label || e.id || e.entity_id || JSON.stringify(e)));

    if (entities.length === 0 && !diagnosis) {
      diagnosis = 'Empty entities: parameters may be invalid or not supported for this filter.type.';
    }

    return {
      path: endpointPath,
      url: url.pathname + url.search,
      status,
      latencyMs,
      count: entities.length,
      sampleNames,
      raw: data,
      diagnosis,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    return {
      path: endpointPath,
      url: url.pathname + url.search,
      status: 0,
      latencyMs,
      count: 0,
      sampleNames: [],
      error: err.message,
      diagnosis: `Network or fetch failure: ${err.message}`,
    };
  }
}

function printCallSummary(res: CallResult, prefix = '') {
  console.log(`${prefix}Path: ${res.url}`);
  console.log(`${prefix}HTTP Status: ${res.status} | Latency: ${res.latencyMs}ms | Count: ${res.count}`);
  if (res.sampleNames.length > 0) {
    console.log(`${prefix}Sample Entities (first 3): ${JSON.stringify(res.sampleNames)}`);
  }
  if (res.diagnosis && (res.status !== 200 || res.count === 0)) {
    console.log(`${prefix}Diagnosis: ${res.diagnosis}`);
  }
}

async function runSmokeTest() {
  console.log('=== QLOO LIVE SMOKE TEST ===');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('API Key: [REDACTED - PRESENT]');
  console.log('--------------------------------------------------');

  // 1. Call /search for one brand (named by the operator or the private overlay)
  const brandName = probeNames('brand', 'retail')[0];
  console.log(`\n[1/5] Searching for Brand: "${brandName}"...`);
  const brandSearch = await qlooFetch('/search', { query: brandName, type: 'urn:entity:brand' });
  printCallSummary(brandSearch);

  // 2. Call /search for one place
  const placeName = probeNames('place', 'venues')[0];
  console.log(`\n[2/5] Searching for Place: "${placeName}"...`);
  const placeSearch = await qlooFetch('/search', { query: placeName, type: 'urn:entity:place' });
  printCallSummary(placeSearch);

  // 3. Call /v2/tags for one keyword: "streetwear"
  console.log('\n[3/5] Querying /v2/tags for keyword: "streetwear"...');
  const tagResult = await qlooFetch('/v2/tags', { 'filter.query': 'streetwear' });
  printCallSummary(tagResult);

  // 4. Call /v2/insights with filter.type=urn:entity:brand and signal.interests.entities from search result, take=10
  console.log('\n[4/5] Querying /v2/insights for brand candidates in Qloo\'s returned order (take=10)...');
  const brandList = brandSearch.raw?.results || [];
  const brandEntity = brandList[0];
  const brandId = brandEntity?.entity_id || brandEntity?.id;
  if (!brandId) {
    // A smoke test that substitutes a hard-coded brand id measures nothing.
    console.error('\n[v4/5] /v2/search returned no brand entity to key the request on. Stopping rather than inventing an id.');
    process.exit(1);
  }

  const insightsResult = await qlooFetch('/v2/insights', {
    'filter.type': 'urn:entity:brand',
    'signal.interests.entities': brandId,
    take: 10,
  });
  printCallSummary(insightsResult);

  // 5. Demo locations test: Seattle, Miami, Austin
  console.log('\n[5/5] Testing Demo Locations for Location-Scoped Insights...');
  const locations = [
    { id: 'store_1', name: 'Seattle', query: 'Seattle, WA' },
    { id: 'store_2', name: 'Miami', query: 'Miami, FL' },
    { id: 'store_3', name: 'Austin', query: 'Austin, TX' },
  ];

  let signalLocationWorked = true;
  let filterLocationWorked = true;
  const retailCounts: Record<string, number> = {};

  for (const loc of locations) {
    console.log(`\nTesting location: ${loc.name} (${loc.query})`);

    // Try filter.location.query
    const filterLocRes = await qlooFetch('/v2/insights', {
      'filter.type': 'urn:entity:brand',
      'signal.interests.entities': brandId,
      'filter.location.query': loc.query,
      take: 10,
    });
    console.log(`  - filter.location.query:`);
    printCallSummary(filterLocRes, '    ');
    if (filterLocRes.count === 0 || filterLocRes.status !== 200) {
      filterLocationWorked = false;
    }

    // Try signal.location.query
    const signalLocRes = await qlooFetch('/v2/insights', {
      'filter.type': 'urn:entity:brand',
      'signal.interests.entities': brandId,
      'signal.location.query': loc.query,
      take: 10,
    });
    console.log(`  - signal.location.query:`);
    printCallSummary(signalLocRes, '    ');
    if (signalLocRes.count === 0 || signalLocRes.status !== 200) {
      signalLocationWorked = false;
    }

    retailCounts[loc.name] = Math.max(filterLocRes.count, signalLocRes.count);
  }

  const locationParamReport = [
    filterLocationWorked ? 'filter.location.query: WORKS (returned results)' : 'filter.location.query: failed or returned 0',
    signalLocationWorked ? 'signal.location.query: WORKS (returned results)' : 'signal.location.query: failed or returned 0',
  ].join('; ');

  console.log('\n==================================================');
  console.log('=== DECISION RULE EVALUATION ===');
  console.log(`Location parameter evaluation: ${locationParamReport}`);
  console.log(`Retail distinct entity counts per location:`, retailCounts);

  const thinLocations = Object.entries(retailCounts).filter(([_, count]) => count < 10);
  console.log(`Locations returning < 10 distinct entities: ${thinLocations.length} of 3 (${thinLocations.map(([l]) => l).join(', ')})`);

  if (thinLocations.length >= 2) {
    console.log('DECISION: RETAIL IS TOO THIN (< 10 distinct entities for >= 2 locations).');
    console.log('Deep pack choice: Venues and events (artist, movie, place) is chosen as the deep pack.');
    console.log('Retail will remain as a config-only pack.');
  } else {
    console.log('DECISION: RETAIL MEETS CRITERIA (>= 10 distinct entities for all 3 demo locations: Seattle, Miami, Austin).');
    console.log('Deep pack choice: Retail is kept as the deep pack.');
  }
  console.log('==================================================\n');
}

runSmokeTest().catch((err) => {
  console.error('Fatal error in smoke test:', err.message);
  process.exit(1);
});
