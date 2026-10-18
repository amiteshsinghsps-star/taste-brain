/**
 * Prints the Decision Trace for the graph-shaped questions a judge would ask.
 * Usage: npm run dev (in another shell), then: npx tsx src/eval/trace-check.ts
 */
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5000';

const QUESTIONS = [
  'Who owns the denied-party screening policy?',
  'Which systems and agents does the credit approval policy govern?',
  'Who knows most about customs declarations?',
  'Why would a booking for Denied Trading LLC be blocked?',
];

async function main() {
  const email = `trace-${Date.now()}@neutronz.dev`;
  const password = 'trace-check-password';
  const H = { 'Content-Type': 'application/json' };
  await fetch(`${BASE}/api/auth/register`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, name: 'Trace Checker' }) });
  const login: any = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password }) })).json();
  const auth = { ...H, Authorization: `Bearer ${login.accessToken}` };

  const seeded: any = await (await fetch(`${BASE}/api/brain/seed-demo`, { method: 'POST', headers: auth, body: '{}' })).json();
  console.log('seeded:', JSON.stringify(seeded.counts ?? seeded.stats ?? seeded).slice(0, 160));

  for (const question of QUESTIONS) {
    const res: any = await (await fetch(`${BASE}/api/brain/query`, { method: 'POST', headers: auth, body: JSON.stringify({ query: question }) })).json();
    const r = res.result ?? res;
    const entities = (r.trace?.nodes ?? []).filter((n: any) => n.label !== 'Chunk' && n.label !== 'Document');
    console.log(`\n=== ${question}`);
    console.log(`citations: ${(r.citations ?? []).length}  trace nodes: ${(r.trace?.nodes ?? []).length}  edges: ${(r.trace?.edges ?? []).length}`);
    console.log(`entities: ${entities.map((n: any) => `${n.label}:${n.name}`).slice(0, 8).join(' | ') || '(none)'}`);
    console.log(`edge types: ${[...new Set((r.trace?.edges ?? []).map((e: any) => e.type))].join(', ')}`);
    console.log('hops:');
    for (const s of (r.traceSentences ?? []).slice(0, 8)) console.log(`  - ${s}`);
  }
}

main().catch((e) => {
  console.error('trace check failed:', e.message);
  process.exitCode = 1;
});

export {};
