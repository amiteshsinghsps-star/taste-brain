#!/usr/bin/env node
// Lockfile integrity guard: catches tampered or hand-edited integrity digests
// before an install fails with EINTEGRITY. See docs/ai-use.md for how this repo
// was built; run with `node scripts/check-lockfile.mjs` or `npm run check:lockfile`.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SRI_LEN = { sha1: 28, sha256: 44, sha384: 64, sha512: 88 };
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// A real SRI digest is opaque base64; a brand word inside one means a human
// edited it. Only words long enough to never occur by chance (>= 6 chars, so a
// false positive across thousands of digests stays vanishingly unlikely).
const FORBIDDEN = /ycombinator|ycdemo|yc_demo|neutronz|treasury|airbnb|stripe|renamed|placeholder/i;

const LOCKFILES = ['client', 'server']
  .map((pkg) => path.join(ROOT, pkg, 'package-lock.json'))
  .filter((p) => existsSync(p));

let failures = 0;

function check(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`FAIL ${rel}: not parseable JSON (${err.message})`);
    failures++;
    return;
  }

  const entries = [
    ...Object.values(json.packages ?? {}),
    ...Object.values(json.dependencies ?? {}),
  ];
  const problems = [];

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.integrity === 'string') problems.push(...inspect(node));
    for (const child of Object.values(node.dependencies ?? {})) walk(child);
  };

  for (const node of entries) walk(node);

  function inspect(node) {
    const out = [];
    const value = node.integrity;
    for (const digest of String(value).split(' ')) {
      const [algo, b64] = digest.split('-');
      if (!SRI_LEN[algo]) {
        out.push(`unknown algorithm in "${digest}"`);
        continue;
      }
      if (!BASE64.test(b64 ?? '')) out.push(`non-base64 digest "${digest}"`);
      else if ((b64 ?? '').length !== SRI_LEN[algo]) {
        out.push(`${algo} digest is ${(b64 ?? '').length} chars, expected ${SRI_LEN[algo]} ("${digest.slice(0, 24)}...")`);
      }
      if (FORBIDDEN.test(b64 ?? '')) out.push(`${algo} digest contains a human-edited word: "${digest}"`);
    }
    if (FORBIDDEN.test(node.resolved ?? '') && !/registry\.npmjs\.org/.test(node.resolved)) {
      out.push(`suspicious resolved URL "${node.resolved}"`);
    }
    return out;
  }

  if (problems.length) {
    console.error(`FAIL ${rel}: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
    if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`);
    failures++;
  } else {
    console.log(`ok   ${rel} (${entries.length} package entries checked)`);
  }
}

if (!LOCKFILES.length) {
  console.error('FAIL no package-lock.json found next to client/, server/ or home_page/');
  process.exit(1);
}
for (const file of LOCKFILES) check(file);

if (failures) {
  console.error(`\n${failures} lockfile(s) invalid. Regenerate with: rm -rf node_modules <pkg>/package-lock.json && npm install`);
  process.exit(1);
}
console.log(`\nAll ${LOCKFILES.length} lockfiles pass.`);
