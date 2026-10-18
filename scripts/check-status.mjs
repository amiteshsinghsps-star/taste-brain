#!/usr/bin/env node
// Reads GET /api/status and fails unless FalkorDB is really serving the app.
//   node scripts/check-status.mjs [--url http://localhost:5000] [--expect-graph]

const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const BASE = urlIdx >= 0 ? argv[urlIdx + 1] : process.env.STATUS_URL || 'http://localhost:5000';
const expectGraph = argv.includes('--expect-graph');

const res = await fetch(`${BASE}/api/status`);
const body = await res.json().catch(() => null);

if (!body) {
  console.error(`FAIL ${BASE}/api/status returned no JSON (HTTP ${res.status})`);
  process.exit(1);
}

const nodes = body.graph?.nodes ?? 0;
const edges = body.graph?.edges ?? 0;
console.log(`HTTP ${res.status}  backend=${body.backend}  falkordb=${body.stores?.falkordb?.reachable}  graphs=${body.stores?.falkordb?.graphs}  nodes=${nodes}  edges=${edges}  llm=${body.llm}  version=${body.version}`);

if (body.backend !== 'falkordb') {
  console.error('FAIL: /api/status does not report falkordb as the backend');
  process.exit(1);
}
if (expectGraph && (res.status !== 200 || nodes === 0 || edges === 0)) {
  console.error('FAIL: expected a reachable graph with non-zero node and edge counts');
  process.exit(1);
}
console.log(expectGraph ? 'Graph is live and serving counts.' : 'Status endpoint reachable.');
