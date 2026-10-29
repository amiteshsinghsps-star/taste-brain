// A host that cannot take file uploads gets the identity overlay as ONE
// environment variable: PACK_OVERLAY_B64 = base64 of `{ packId: overlay }`.
// Assembling that by hand is how a deploy ends up with a mistyped pack id or a
// renamed offer_id and a demo that quietly runs on the committed fictional
// names — every badge still says LIVE, only the answers are wrong.
//
// So: bundle the per-pack files, then check every key against the committed
// packs before the value is pasted anywhere.
//
// It writes only into PACK_OVERLAY_DIR (gitignored) and prints counts, never a
// name or an entity id: an overlay is the same class of secret as the key that
// reads it.

import * as fs from 'fs';
import * as path from 'path';
import { env } from '../src/config/env';
import { listPackIds, loadCommittedPack } from '../src/packs/loader';
import type { PackOverlay } from '../src/packs/overlay';

const DIR = path.isAbsolute(env.PACK_OVERLAY_DIR)
  ? env.PACK_OVERLAY_DIR
  : path.resolve(__dirname, '..', env.PACK_OVERLAY_DIR);

const bundle: Record<string, PackOverlay> = {};
const problems: string[] = [];

for (const id of listPackIds()) {
  const file = path.join(DIR, `${id}.overlay.json`);
  if (!fs.existsSync(file)) {
    problems.push(`${id}: no overlay file — a live run on the host will resolve only fictional names`);
    continue;
  }
  let overlay: PackOverlay;
  try {
    overlay = JSON.parse(fs.readFileSync(file, 'utf8')) as PackOverlay;
  } catch {
    problems.push(`${id}: overlay file is not readable JSON`);
    continue;
  }

  // applyOverlay drops a patch that matches nothing, silently, forever.
  const pack = loadCommittedPack(id);
  const deadSeeds = Object.keys(overlay.seeds ?? {}).filter(
    (seed) => !pack.locations.some((loc) => loc.seeds.includes(seed)),
  );
  if (deadSeeds.length) problems.push(`${id}: ${deadSeeds.length} seed patch(es) match no committed seed (${deadSeeds.join(', ')})`);

  for (const [key, rows] of Object.entries(pack.catalogs)) {
    const patches = overlay.catalogs?.[key] ?? [];
    const committed = new Set(rows.map((row) => row.offer_id));
    const dead = patches.filter((p) => !committed.has(p.offer_id)).map((p) => p.offer_id);
    if (dead.length) problems.push(`${id} catalog "${key}": ${dead.length} patch(es) match no committed row (${dead.join(', ')})`);
    const named = patches.filter((p) => p.name && p.qloo_entity_id).length;
    console.log(`  ${id} / ${key}: ${rows.length} committed rows, ${named} with a real identity`);
  }
  for (const key of Object.keys(overlay.catalogs ?? {})) {
    if (!pack.catalogs[key]) problems.push(`${id}: overlay patches catalog "${key}", which the committed pack does not have`);
  }

  bundle[id] = overlay;
}

const ids = Object.keys(bundle);
if (!ids.length) {
  console.error('No pack overlay found in', DIR, '— nothing to bundle.');
  process.exit(1);
}

const b64 = Buffer.from(JSON.stringify(bundle), 'utf8').toString('base64');
const out = path.join(DIR, 'overlay-bundle.b64');
fs.writeFileSync(out, `${b64}\n`, 'utf8');

console.log('');
console.log(`bundled packs   ${ids.join(', ')}`);
console.log(`value length    ${b64.length} chars`);
console.log(`written         ${out}`);
console.log('');
if (problems.length) {
  console.log('CHECK BEFORE DEPLOYING — these would be dropped in silence:');
  for (const p of problems) console.log(`  ! ${p}`);
  console.log('');
} else {
  console.log('every overlay key matches a committed seed or row.');
  console.log('');
}
console.log('Set it on the host as the variable PACK_OVERLAY_B64, with the file contents on one line:');
console.log(`  tr -d '\\n' < ${out}`);
console.log('');
console.log('Never commit that file, and never print it in a shared terminal while the key is live.');
