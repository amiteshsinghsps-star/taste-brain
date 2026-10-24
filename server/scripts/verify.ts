// CLI face of the Verifier:  npm run verify -- <export.json>
// Deliberately free of the Qloo client, the API server and any network call, so
// the verdict a judge sees in the browser can be reproduced in a terminal.

import * as fs from 'fs';
import { formatReport, verifyExport } from '../src/verify/verifier';

const file = process.argv[2];

if (!file) {
  console.error('usage: npm run verify -- <export.json>');
  console.error('       produces an export with GET /api/proposals/<id>/export');
  process.exit(2);
}

let raw: unknown;
try {
  raw = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`cannot read ${file}: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}

const report = verifyExport(raw);
console.log(formatReport(report));
process.exit(report.ok ? 0 : 1);
