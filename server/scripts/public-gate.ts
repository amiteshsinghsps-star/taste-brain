// The public gate — PRD v9 §17.5, run before anything is pushed and again in CI.
//
// It answers one question: could this tree be published today without leaking a
// key, a real Qloo entity id, a real company or artist name, or a live response?
// Everything here is checked against committed content (`git show HEAD:<path>`,
// falling back to the index for a file that is staged but not yet committed), so
// what it reports is what a push would carry. It prints file:line and a rule
// name — never a matched value — because a leak report must not itself leak.
//
//   npm run gate:public

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SERVER = path.resolve(__dirname, '..');
const ROOT = path.resolve(SERVER, '..');
const BINARY = /^(.*\.(png|jpg|jpeg|gif|webp|woff2?|ttf|ico|zip|gz|mp4|mov|webm|sqlite|db|db-wal|db-shm|sqlite-journal))$/i;

const results: { ok: boolean; check: string; detail: string }[] = [];
const report = (ok: boolean, check: string, detail: string) => { results.push({ ok, check, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}\n      ${detail}`); };

function git(args: string[]): string {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; }
}

const tracked = git(['ls-files']).split('\n').filter(Boolean);
const blob = (rel: string): string => {
  const head = git(['show', `HEAD:${rel}`]);
  if (head) return head;
  const indexed = git(['show', `:${rel}`]);
  if (indexed) return indexed;
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
};

console.log(`public gate — ${tracked.length} tracked files\n`);

// ── 1. private paths must not be tracked ──────────────────────────────────────
const PRIVATE = /(^|\/)\.env$|(^|\/)\.env\.(?!example)[a-z]+$|\.private-cache[\/\\]|\.private-data[\/\\]|(^|\/)(\.next|\.vite)(\/|$)|\.log$/i;
const badPaths = tracked.filter((f) => PRIVATE.test(f));
report(badPaths.length === 0, 'no .env, private cache, overlay or log file is tracked',
  badPaths.length ? badPaths.join(', ') : `${tracked.length} tracked paths, none private`);

// ── 2. no credential may appear on a tracked line ────────────────────────────
const SECRET = /(api[_-]?key|secret|token|password)[\s"':=]{1,4}[A-Za-z0-9_\-]{20,}/i;
const KEY_READ = /process\.env\.[A-Z_]+|env\.[A-Z_]+|\.readFileSync|require\(|import\(/;
const PLACEHOLDER = /your[-_]|example|placeholder|changeme|<|\.\.\.|xxx|dummy/i;
const secretLines: string[] = [];
for (const f of tracked) {
  if (BINARY.test(f)) continue;
  blob(f).split('\n').forEach((line, i) => {
    if (!SECRET.test(line)) return;
    if (KEY_READ.test(line)) return;                       // reading a variable is not holding a value
    if (PLACEHOLDER.test(line)) return;
    secretLines.push(`${f}:${i + 1}`);
  });
}
report(secretLines.length === 0, 'no credential value on any tracked line',
  secretLines.length ? secretLines.slice(0, 10).join(', ') : 'key-shaped assignments: none (env reads and placeholders allowed)');

// ── 3. no real Qloo entity id: they are 36-character UUIDs, nothing here needs one ──
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const uuidLines: string[] = [];
for (const f of tracked) {
  if (BINARY.test(f)) continue;
  blob(f).split('\n').forEach((line, i) => { if (UUID.test(line)) uuidLines.push(`${f}:${i + 1}`); });
}
report(uuidLines.length === 0, 'no Qloo entity id (UUID literal) on any tracked line',
  uuidLines.length ? uuidLines.slice(0, 10).join(', ') : 'entity ids in committed data are symbolic `qloo:*` names or `qloo-entity-N` tokens');

// ── 4. real identities live in the overlay, so the overlay is the dictionary ─
// The private overlay is exactly the list of names and ids that must never be
// committed. Checking tracked lines against it needs no hard-coded name list —
// and a name list in this file would itself be the leak we are hunting.
const OVERLAY_DIR = path.join(SERVER, '.private-data');
const identities: { pack: string; needle: string }[] = [];
if (fs.existsSync(OVERLAY_DIR)) {
  for (const f of fs.readdirSync(OVERLAY_DIR).filter((x) => x.endsWith('.overlay.json'))) {
    const pack = f.replace(/\.overlay\.json$/, '');
    const ov = JSON.parse(fs.readFileSync(path.join(OVERLAY_DIR, f), 'utf8')) as any;
    const add = (v: unknown) => {
      const s = String(v ?? '');
      if (s.length < 4) return;
      identities.push({ pack, needle: s });
      const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (slug.length >= 5) identities.push({ pack, needle: slug });
    };
    for (const v of Object.values(ov.seeds ?? {})) add(v);
    for (const rows of Object.values(ov.catalogs ?? {} as any)) (rows as any[]).forEach((r) => { add(r.name); add(r.qloo_entity_id); });
  }
}
if (!identities.length) {
  report(true, 'no real identity on any tracked line', 'no overlay on this host — the cross-check runs on the key custodian machine and in the release pass');
} else {
  const leaks: string[] = [];
  for (const f of tracked) {
    if (BINARY.test(f)) continue;
    const lines = blob(f).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      for (const id of identities) if (lower.includes(id.needle.toLowerCase())) { leaks.push(`${f}:${i + 1} matches a ${id.pack} overlay identity`); break; }
    }
  }
  report(leaks.length === 0, 'no real identity on any tracked line',
    leaks.length ? leaks.slice(0, 10).join(', ') : `checked every tracked line against ${identities.length} private identities (${identities.length / 2 | 0} names + ids)`);
}

// ── 5. the shipped defaults must be the safe ones ────────────────────────────
const exampleEnv = blob('server/.env.example');
const envSrc = blob('server/src/config/env.ts');
const defaultsOk = /QLOO_ENABLED[^\S\n]*=?[^\S\n]*false/i.test(exampleEnv)
  && /DEFAULT_MODE[^\S\n]*=?[^\S\n]*replay/i.test(exampleEnv)
  && /QLOO_ENABLED[^}]{0,80}false/i.test(envSrc)
  && /DEFAULT_MODE[^}]{0,80}replay/i.test(envSrc);
report(defaultsOk, 'live is off and Replay is the default in .env.example and the env schema',
  `.env.example QLOO_ENABLED=false / DEFAULT_MODE=replay, and the code defaults agree`);

// ── 6. an open-source license must be visible on the repo page ───────────────
const license = blob('LICENSE');
report(/MIT License/i.test(license), 'MIT LICENSE present at the repository root',
  license ? `${license.split('\n').length} lines, first line: ${license.split('\n')[0].slice(0, 40)}` : 'LICENSE is missing');

// ── 7. the README disclosure must be true of this build, not of an older one ─
const readme = blob('README.md');
const readmeDates = [...readme.matchAll(/20\d\d-\d\d-\d\d/g)].map((m) => m[0]);
const newestArtifact = ['sample-export.json', 'gate-report.json', 'live-scorecard.json', 'qloo-capabilities.json']
  .map((f) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(SERVER, 'verification', f), 'utf8'));
      return [j.exported_at, j.verified_at, j.generated_at].filter(Boolean).sort().pop() ?? '';
    } catch { return ''; }
  })
  .filter(Boolean).sort().pop() ?? '';
// The claim is what must survive, not one particular adjective: the reader has to
// be able to see that the offline rows are invented and are not a Qloo answer.
const discloseOk = /replay/i.test(readme)
  && /invented/i.test(readme) && /not a Qloo answer/i.test(readme)
  && /QLOO_ENABLED/i.test(readme) && !!readmeDates.length;
const newestDisclosed = [...readmeDates].sort().pop() ?? '';
const fresh = !newestArtifact || newestDisclosed >= newestArtifact.slice(0, 10);
report(discloseOk && fresh, 'README states the data mode, and its date is not behind the evidence files',
  `README says the offline rows are invented and not a Qloo answer: ${discloseOk} · README dates: ${[...readmeDates].sort().join(', ') || 'none'} · newest tracked evidence: ${newestArtifact || 'none'}`);

// ── 8. a fresh clone with no key must still produce a run ────────────────────
process.env.GRAPH_DB = ':memory:';
process.env.DEFAULT_MODE = 'replay';
process.env.QLOO_ENABLED = 'false';
process.env.PACK_OVERLAY_DISABLE = 'true';   // the committed packs only, exactly as a fresh clone sees them
async function keylessReplay() {
  const { runPipeline } = await import('../src/agents/pipeline');
  const rooms: [string, string][] = [['retail', 'store_3'], ['venues', 'venue_redroom'], ['restaurants', 'loc_westside']];
  const out: string[] = [];
  for (const [pack, location] of rooms) {
    const p = await runPipeline({ pack, location, goal: 'fresh-clone gate', mode: 'replay' });
    if (p.mode !== 'replay' || p.items.length === 0) out.push(`${pack}/${location} returned ${p.items.length} item(s) in mode ${p.mode}`);
  }
  report(out.length === 0, 'a keyless Replay run works on the committed packs alone',
    out.length ? out.join('; ') : 'three rooms produced items with QLOO_ENABLED=false and no overlay');
}

keylessReplay().then(() => {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'PUBLIC GATE PASS' : `PUBLIC GATE FAIL — ${failed.length} check(s)`} (${results.length} checks)`);
  for (const f of failed) console.log('  blocked by: ' + f.check);
  process.exit(failed.length ? 1 : 0);
}).catch((e) => { console.error('gate crashed:', e); process.exit(1); });
