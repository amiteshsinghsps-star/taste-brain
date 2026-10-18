/**
 * Removal test (E05): FalkorDB is load-bearing, not decorative.
 *
 *   npm run test:removal
 *
 * Boots the API twice on throwaway ports — once pointed at a dead graph port,
 * once at the live one — and asserts the graph-first endpoints fail loudly with
 * GRAPH_UNAVAILABLE rather than quietly falling back to keyword/SQL search.
 * Nothing here stops a real database, so it is safe in CI.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

// Compiled to dist/eval/removal-test.js, run from src/eval/removal-test.ts —
// in both cases the server package root is two levels up from this file.
const SERVER_DIR = path.resolve(__dirname, '..', '..');
const QUERY = 'Who owns the denied-party screening policy?';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

interface Child {
  base: string;
  stop: () => Promise<void>;
}

async function boot(label: string, port: number, falkordbPort: number): Promise<Child> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(port), FALKORDB_PORT: String(falkordbPort), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log: string[] = [];
  child.stdout?.on('data', (b) => log.push(String(b)));
  child.stderr?.on('data', (b) => log.push(String(b)));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.status === 200 || res.status === 503) {
        console.log(`\n=== ${label} up on ${base} (FALKORDB_PORT=${falkordbPort}) ===`);
        return {
          base,
          stop: async () => {
            child.kill('SIGKILL');
            await new Promise((r) => child.once('exit', r as any));
          },
        };
      }
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become ready:\n${log.join('')}`);
}

async function json(method: string, url: string, body?: unknown, token?: string) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json: parsed };
}

async function tokenFor(base: string): Promise<string> {
  const email = `removal-${Date.now()}-${Math.floor(Math.random() * 1e6)}@neutronz.dev`;
  const password = 'correct-horse-battery';
  await json('POST', `${base}/api/auth/register`, { email, password, name: 'Removal Tester' });
  const login = await json('POST', `${base}/api/auth/login`, { email, password });
  const token = login.json?.accessToken ?? login.json?.token;
  if (!token) throw new Error(`login failed against ${base}: ${JSON.stringify(login.json).slice(0, 200)}`);
  return token;
}

async function main() {
  const livePort = Number(process.env.FALKORDB_PORT || 6379);
  const deadPort = Number(process.env.FALKORDB_TEST_DEAD_PORT || 6399);
  if (deadPort === livePort) throw new Error('dead port equals live port');

  const down = await boot('graph-down', 5099, deadPort);
  try {
    const token = await tokenFor(down.base);

    const health = await json('GET', `${down.base}/health`);
    record('health reports graph down', health.json?.falkordb === false && health.status === 503, JSON.stringify(health.json).slice(0, 160));

    const q = await json('POST', `${down.base}/api/brain/query`, { query: QUERY }, token);
    record(
      'ask-the-brain fails with GRAPH_UNAVAILABLE',
      q.status === 503 && q.json?.code === 'GRAPH_UNAVAILABLE',
      `status ${q.status} code ${q.json?.code}`
    );
    record(
      'no silent fallback answer',
      !q.json?.answer && !q.json?.result?.answer && !(q.json?.citations?.length ?? q.json?.result?.citations?.length),
      JSON.stringify(q.json).slice(0, 200)
    );

    const g = await json('GET', `${down.base}/api/brain/graph`, undefined, token);
    record('graph explorer fails', g.status === 503 && g.json?.code === 'GRAPH_UNAVAILABLE', `status ${g.status} code ${g.json?.code}`);

    const st = await json('GET', `${down.base}/api/status`);
    record('status endpoint proves graph down', st.status === 503 && st.json?.ok === false && st.json?.graph?.nodes === 0, JSON.stringify(st.json?.stores ?? st.json).slice(0, 200));

    const seed = await json('POST', `${down.base}/api/brain/seed-demo`, {}, token);
    record('demo seed refuses to write anywhere else', seed.status === 503, `status ${seed.status}`);
  } finally {
    await down.stop();
  }

  const up = await boot('graph-up', 5098, livePort);
  try {
    const token = await tokenFor(up.base);
    const seed = await json('POST', `${up.base}/api/brain/seed-demo`, {}, token);
    record('same binary seeds the demo company once the graph is back', seed.status === 200, JSON.stringify(seed.json?.counts ?? seed.json).slice(0, 160));

    const q = await json('POST', `${up.base}/api/brain/query`, { query: QUERY }, token);
    const ans = q.json?.result ?? q.json;
    const citations = ans?.citations?.length ?? 0;
    const edges = ans?.trace?.edges?.length ?? 0;
    record('ask-the-brain answers with a trace once restored', q.status === 200 && citations > 0 && edges > 0, `${citations} citations, ${edges} hops`);

    const st = await json('GET', `${up.base}/api/status`);
    record(
      'status reports live graph counts',
      st.status === 200 && st.json?.backend === 'falkordb' && (st.json?.graph?.nodes ?? 0) > 0 && (st.json?.graph?.edges ?? 0) > 0,
      `backend=${st.json?.backend} nodes=${st.json?.graph?.nodes} edges=${st.json?.graph?.edges} graphs=${st.json?.stores?.falkordb?.graphs}`
    );
  } finally {
    await up.stop();
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} removal checks passed`);
  if (failed.length) {
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nRemoval test aborted:', err.message);
  process.exitCode = 1;
});

export {};
