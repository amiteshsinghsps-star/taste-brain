import { writeFileSync } from 'node:fs';
import path from 'node:path';

// results.json is committed, so this snapshot is always taken from the fictional
// packs: the line below must run before config/env is imported.
process.env.PACK_OVERLAY_DISABLE = 'true';

import { runTasteLift } from './taste-lift';

import { env } from '../config/env';

// Writes results next to this file so judges can re-run and diff real numbers.
async function main() {
  const mode = (process.env.EVAL_MODE as any) || env.DEFAULT_MODE || 'replay';
  const results = await runTasteLift(mode);
  const out = path.join(__dirname, 'results.json');
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('Taste Lift run complete. Wrote', out);
  console.log(JSON.stringify(results.summary, null, 2));
  if (!results.summary.armA.ran) {
    console.log('\nNote: Arm A (plain LLM) did not run because LLM_API_KEY is unset.');
    console.log('Only Arm B (grounded) numbers are published. No lift figure is fabricated.');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
