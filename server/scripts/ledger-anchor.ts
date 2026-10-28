// Prints the current ledger head so the operator can record it somewhere this
// server does not control — a commit message, a gist, a chat post. An anchored
// head is what closes the hole a hash chain leaves open: whoever holds the
// database file can rewrite the whole chain consistently, but they cannot make the
// rewritten head match a hash that was published earlier elsewhere.
//
// Read-only. It writes nothing and sends nothing anywhere.

import { graph, verifyLedger } from '../src/graph/store';

const entries = graph.readLedger(Number.MAX_SAFE_INTEGER);
const v = verifyLedger(entries);

if (!entries.length) {
  console.log('The ledger is empty: there is nothing to anchor yet.');
  process.exit(0);
}

console.log(`entries        ${v.length} (first seq ${entries[0].seq}, last seq ${entries[entries.length - 1].seq})`);
console.log(`chain          ${v.ok ? 'verifies' : `BROKEN at entry ${v.first_broken_seq}: ${v.reason}`}`);
console.log(`unkeyed entries ${v.keyless_entries}`);
console.log(`head hash      ${v.head_hash}`);
console.log('');
console.log('Record this line somewhere the server cannot rewrite:');
console.log(`  taste-brain ledger anchor ${new Date().toISOString()} seq=${entries[entries.length - 1].seq} head=${v.head_hash}`);
