// warm-cache.ts
// Pre-fetches one-click scenario results into the private gitignored cache so
// judges can click them without burning live quota.
//
// Run on the DEPLOYED HOST (not committed – cache data is gitignored):
//   npm run warm-cache
//
// This script makes real Qloo API calls. It requires:
//   - QLOO_API_KEY set in server/.env
//   - QLOO_ENABLED=true
//
// Security: API key is never printed, logged, or committed.

import * as path from 'path';
import * as fs from 'fs';

function loadEnv() {
  const envFile = path.join(__dirname, '../.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const p = line.indexOf('=');
      if (p !== -1) {
        const k = line.slice(0, p).trim();
        const v = line.slice(p + 1).trim().replace(/^['"]|['"]$/g, '');
        if (process.env[k] === undefined) process.env[k] = v;
      }
    }
  }
}
loadEnv();

import { qlooKeyStatus, qlooRestEnabled } from '../src/config/env';

async function main() {
  console.log('=== TASTE BRAIN CACHE WARMER ===');
  console.log(`QLOO_API_KEY: ${qlooKeyStatus()}`);
  if (!qlooRestEnabled()) {
    console.error('Error: QLOO_ENABLED must be true and QLOO_API_KEY must be set.');
    console.error('Run this script on the deployed host with the key configured.');
    process.exit(1);
  }

  // Import after env is loaded
  const { runPipeline } = await import('../src/agents/pipeline');

  const scenarios = [
    { pack: 'retail', location: 'store_1', goal: 'Add 4 brands to the spring assortment for this store' },
    { pack: 'retail', location: 'store_2', goal: 'Add 4 brands to the spring assortment for this store' },
    { pack: 'retail', location: 'store_3', goal: 'Add 4 brands to the spring assortment for this store' },
    { pack: 'venues', location: 'venue_redroom', goal: 'Book 3 acts for the summer series at this venue' },
    { pack: 'restaurants', location: 'loc_westside', goal: 'Add 3 dishes to the spring menu for this location' },
  ];

  let warmed = 0;
  for (const s of scenarios) {
    try {
      console.log(`Warming: ${s.pack}/${s.location}...`);
      const p = await runPipeline({ pack: s.pack, location: s.location, goal: s.goal, mode: 'live' });
      console.log(`  → mode: ${p.mode}, items: ${p.items.length}, unsupported: ${p.unsupported.length}`);
      warmed++;
    } catch (err: any) {
      console.error(`  ERROR: ${err?.message ?? err}`);
    }
  }

  console.log(`\nDone. Warmed ${warmed}/${scenarios.length} scenarios.`);
  console.log('Cache is gitignored and will NOT be committed. Re-run on each deployment.');
}

main().catch((err) => {
  console.error('Fatal:', err?.message ?? err);
  process.exit(1);
});
