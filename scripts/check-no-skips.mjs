#!/usr/bin/env node
// Fails when a vitest JSON report contains skipped/pending tests. Used in CI so
// "graph tests were skipped because the DB was down" can never read as a pass.
//
//   vitest run --reporter=json --outputFile=tests/vitest.json
//   node scripts/check-no-skips.mjs server/tests/vitest.json

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['server/tests/vitest.json'];

let bad = 0;

for (const rel of targets) {
  // Paths are read from the caller's working directory, which is how both the
  // CI step (repo root) and `cd server && node ../scripts/...` address the report.
  const file = path.resolve(rel);
  if (!existsSync(file)) {
    console.error(`FAIL ${rel}: report missing — the test step did not run or did not write JSON (looked in ${file})`);
    bad++;
    continue;
  }
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`FAIL ${rel}: unparseable JSON (${err.message})`);
    bad++;
    continue;
  }

  const assertions = (report.testResults ?? []).flatMap((r) => r.assertionResults ?? []);
  const passed = assertions.filter((a) => a.status === 'passed').length;
  const failed = assertions.filter((a) => a.status === 'failed').length;
  const skipped = assertions.filter((a) => ['skipped', 'pending', 'todo'].includes(a.status));

  console.log(`${rel}: ${passed} passed, ${failed} failed, ${skipped.length} skipped (of ${assertions.length})`);
  if (skipped.length) {
    console.error(`FAIL ${rel}: ${skipped.length} test(s) skipped — refusing to treat that as a pass`);
    for (const s of skipped.slice(0, 25)) console.error(`  - ${s.fullName ?? s.title}`);
    bad++;
  } else if (failed) {
    console.error(`FAIL ${rel}: ${failed} failing test(s)`);
    bad++;
  } else if (!passed) {
    console.error(`FAIL ${rel}: zero tests executed`);
    bad++;
  }
}

process.exit(bad ? 1 : 0);
