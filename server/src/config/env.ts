// Runtime configuration for Taste Brain. No login, no external database.
// Qloo is reached through direct REST when QLOO_API_KEY is present; otherwise
// the server runs in Replay mode from committed synthetic fixtures.
// Real entity identities are never in the tracked packs — see packs/overlay.ts.

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// Minimal .env loader so a missing variable file cannot break the demo.
// Real environment variables always win over the file.
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const p = t.indexOf('=');
    if (p === -1) continue;
    const key = t.slice(0, p).trim();
    let val = t.slice(p + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = val;
  }
}
loadDotEnv(path.join(__dirname, '../../.env'));

const ModeSchema = z.enum(['live', 'cached', 'replay']);
export type TasteMode = z.infer<typeof ModeSchema>;

const boolish = z
  .preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (v === undefined) return undefined;
    const s = String(v).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(s)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(s)) return false;
    return v;
  }, z.boolean());

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),

  // Where results come from. Replay is the default so the demo runs with no credential.
  DEFAULT_MODE: ModeSchema.default('replay'),

  // The ledger, the snapshots and the quota counters all live here, and quota.ts
  // promises that a restart does not reset the budget — which is only true of a
  // file. ':memory:' stays available for tests and throwaway runs; it is not the
  // default, because a default deployment that forgot the variable would silently
  // lose its decision history on every restart.
  GRAPH_DB: z.string().default('.private-data/taste-brain.db'),

  // Qloo direct REST.
  QLOO_ENABLED: boolish.default(false),
  QLOO_API_KEY: z.string().optional(), // secret — never logged, never returned
  QLOO_BASE_URL: z.string().default('https://hackathon.api.qloo.com'),
  QLOO_THROTTLE_MS: z.coerce.number().default(250),
  QLOO_TIMEOUT_MS: z.coerce.number().default(15000),
  QLOO_MAX_CALLS_PER_RUN: z.coerce.number().default(12),
  QLOO_PRIVATE_CACHE_DIR: z.string().default('.private-cache'),
  QLOO_DAILY_SOFT_LIMIT: z.coerce.number().default(400),

  // Identity overlay for live mode. Committed packs name fictional companies and
  // rooms only; the real Qloo entity ids and query names live in one gitignored
  // file per pack, held by the key custodian and set on the host. Without it the
  // app still runs — live mode simply finds no offer on file and says so.
  PACK_OVERLAY_DIR: z.string().default('.private-data'),
  PACK_OVERLAY_B64: z.string().optional(), // host without file upload: base64 of the pack overlay JSON
  // Committed artifacts (the sample export, the Taste Lift snapshot) are generated
  // with this set, so a real identity cannot be written into the repo by a run on
  // the custodian's own machine.
  PACK_OVERLAY_DISABLE: boolish.default(false),

  // Optional LLM. Writes explanations only; never ranks, filters or approves.
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),

  // Public-demo safety.
  RATE_LIMIT_PER_MIN: z.coerce.number().default(30),
  // Behind a deploy proxy every visitor arrives on the proxy's socket address, so
  // the whole site would share one rate bucket and judges would throttle each
  // other. Set this to the number of proxies in front of the app (1 for most
  // hosts). At 0 X-Forwarded-For is ignored on purpose: a local run must not let a
  // client claim to be any address it likes.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  // The ledger hash is unkeyed sha256 unless this is set, which means anyone who
  // can rewrite a whole chain can produce a self-consistent one. With a key the
  // chain becomes HMAC-bound and only this server can extend it. New entries carry
  // their algorithm, so an existing keyless chain still verifies.
  LEDGER_HMAC_SECRET: z.string().min(16).optional(),

  // Quota Guardian (F41). Live traffic stops before the key is exhausted.
  QUOTA_VISITOR_HOUR: z.coerce.number().default(8),
  QUOTA_VISITOR_DAY: z.coerce.number().default(40),
  QUOTA_GLOBAL_DAY: z.coerce.number().default(400),
  QUOTA_MONTHLY_FLOOR: z.coerce.number().default(1500),

  // Finals Mode (F48): set in the host environment, never from the UI.
  FINALS_OVERRIDE: boolish.default(false),

  // Exports and receipts carry Qloo-returned names and tags, so they are refused
  // for live runs until Qloo confirms what may be shared. Set this only after
  // that answer arrives.
  EXPORT_ALLOW_LIVE: boolish.default(false),
});

export const env = schema.parse({
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN,
  DEFAULT_MODE: process.env.DEFAULT_MODE,
  GRAPH_DB: process.env.GRAPH_DB,
  QLOO_ENABLED: process.env.QLOO_ENABLED,
  QLOO_API_KEY: process.env.QLOO_API_KEY,
  QLOO_BASE_URL: process.env.QLOO_BASE_URL,
  QLOO_THROTTLE_MS: process.env.QLOO_THROTTLE_MS,
  QLOO_TIMEOUT_MS: process.env.QLOO_TIMEOUT_MS,
  QLOO_MAX_CALLS_PER_RUN: process.env.QLOO_MAX_CALLS_PER_RUN,
  QLOO_PRIVATE_CACHE_DIR: process.env.QLOO_PRIVATE_CACHE_DIR,
  QLOO_DAILY_SOFT_LIMIT: process.env.QLOO_DAILY_SOFT_LIMIT,
  PACK_OVERLAY_DIR: process.env.PACK_OVERLAY_DIR,
  PACK_OVERLAY_B64: process.env.PACK_OVERLAY_B64,
  PACK_OVERLAY_DISABLE: process.env.PACK_OVERLAY_DISABLE,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_MODEL: process.env.LLM_MODEL,
  RATE_LIMIT_PER_MIN: process.env.RATE_LIMIT_PER_MIN,
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS,
  LEDGER_HMAC_SECRET: process.env.LEDGER_HMAC_SECRET,
  QUOTA_VISITOR_HOUR: process.env.QUOTA_VISITOR_HOUR,
  QUOTA_VISITOR_DAY: process.env.QUOTA_VISITOR_DAY,
  QUOTA_GLOBAL_DAY: process.env.QUOTA_GLOBAL_DAY,
  QUOTA_MONTHLY_FLOOR: process.env.QUOTA_MONTHLY_FLOOR,
  FINALS_OVERRIDE: process.env.FINALS_OVERRIDE,
  EXPORT_ALLOW_LIVE: process.env.EXPORT_ALLOW_LIVE,
});

/** Redacted key status: "set" or "missing" only, never the value. */
export function qlooKeyStatus(): 'set' | 'missing' {
  return env.QLOO_API_KEY && env.QLOO_API_KEY.length > 0 ? 'set' : 'missing';
}

export function qlooRestEnabled(): boolean {
  return env.QLOO_ENABLED && qlooKeyStatus() === 'set';
}

export { ModeSchema };
