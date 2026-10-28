// Unit tests for the Qloo REST client and the mode/quota ladder (PRD §6.2, §7.7, F41).
//
// No real API key is used and no request reaches Qloo. Two things guarantee that:
// every test replaces global.fetch with a local mock, and this file points the
// base URL at a port nothing listens on with a key that is not a secret. Live is
// switched on *here only* because the transport itself is under test — with the
// host-level gate closed, cachedFetch throws before fetch and these assertions
// would pass vacuously on an empty call list. vitest.config.ts also redirects the
// private cache to a scratch directory, so mock payloads can never be written into
// the store that holds real Qloo responses.
//
// MOCK_* payloads below are locally defined synthetic data, not real Qloo responses.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

process.env.QLOO_ENABLED = 'true';
process.env.QLOO_API_KEY = 'synthetic-test-key-not-a-secret';
process.env.QLOO_BASE_URL = 'http://127.0.0.1:1';

/** The scratch cache this file is allowed to touch; cleared before every test. */
const scratchCache = path.resolve(process.cwd(), process.env.QLOO_PRIVATE_CACHE_DIR ?? '.private-cache-test');

// ── Shared synthetic mock payloads (NOT real Qloo data) ──────────────────

const MOCK_SINGLE_ENTITY = {
  success: true,
  results: {
    entities: [
      { entity_id: 'AAA-111', name: 'Test Brand A', subtype: 'urn:entity:brand', popularity: 0.4, properties: { primary_genres: ['test'] } },
    ],
  },
};

const MOCK_MULTI_ENTITY = {
  success: true,
  results: {
    entities: [
      { entity_id: 'BBB-222', name: 'Test Brand B', subtype: 'urn:entity:brand', popularity: 0.35 },
      { entity_id: 'CCC-333', name: 'Test Brand C', subtype: 'urn:entity:brand', popularity: 0.2 },
    ],
  },
};

const MOCK_EMPTY = { success: true, results: { entities: [] } };
const MOCK_ERROR_OBJECT = { error: { reason: 'some_reason', message: 'Something went wrong', code: 500 } };
const MOCK_ERROR_ARRAY = { errors: [{ message: 'filter.type is required' }] };

const captureFetch = (body: unknown, status = 200) => {
  const calls: { url: string; opts: RequestInit }[] = [];
  global.fetch = vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
    calls.push({ url, opts });
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  }) as any;
  return calls;
};

beforeEach(() => {
  vi.restoreAllMocks();
  // Refuse to run at all if the isolation is not in place: a test suite that can
  // write into the live cache, or reach the real host, is not a test suite.
  if (/(^|[\\/])\.private-cache$/.test(scratchCache)) throw new Error(`test cache points at the live private cache: ${scratchCache}`);
  if (process.env.QLOO_BASE_URL !== 'http://127.0.0.1:1') throw new Error(`test base URL is not the dead local port: ${process.env.QLOO_BASE_URL}`);
  if (fs.existsSync(scratchCache)) for (const f of fs.readdirSync(scratchCache)) fs.rmSync(path.join(scratchCache, f), { force: true });
});

// ── URL, header and method correctness ───────────────────────────────────

describe('REST client: URL and header correctness', () => {
  it('uses X-Api-Key, never Authorization, and never the key in the URL', async () => {
    const calls = captureFetch(MOCK_SINGLE_ENTITY);
    const { search } = await import('../src/qloo/rest-client');
    await search('Test Brand A', 'urn:entity:brand').catch(() => {});
    expect(calls.length).toBeGreaterThan(0); // a mocked-transport test that called nothing proves nothing
    for (const c of calls) {
      const headers = (c.opts.headers ?? {}) as Record<string, string>;
      const keys = Object.keys(headers).map((h) => h.toLowerCase());
      expect(keys).toContain('x-api-key');
      expect(keys).not.toContain('authorization');
      expect(c.url).not.toContain(process.env.QLOO_API_KEY!);
    }
  });

  it('always uses GET and never a /recommendations path', async () => {
    const calls = captureFetch(MOCK_SINGLE_ENTITY);
    const { search } = await import('../src/qloo/rest-client');
    await search('Test').catch(() => {});
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect((c.opts.method ?? 'GET').toUpperCase()).toBe('GET');
      expect(c.url).not.toMatch(/recommendations|\/recs/);
    }
  });
});

// ── Parameter allowlist (guardrail: unknown params are refused, not dropped) ─

describe('Parameter allowlist', () => {
  it('refuses an unknown parameter before anything leaves the box', async () => {
    const calls = captureFetch(MOCK_SINGLE_ENTITY);
    const { assertAllowed, AllowlistViolation } = await import('../src/qloo/allowlist');
    expect(() => assertAllowed('/v2/insights', { 'filter.typo': 1 })).toThrow(AllowlistViolation);
    expect(calls.length).toBe(0);
  });

  it('accepts only parameters that were verified live', async () => {
    const { assertAllowed, ALLOWED_PARAMS } = await import('../src/qloo/allowlist');
    assertAllowed('/v2/insights', { 'filter.type': 'urn:entity:artist', 'filter.popularity.min': 0.05, 'bias.trends': 'high' });
    expect(ALLOWED_PARAMS['/v2/insights']).toContain('signal.location.query');
  });

  it('compare requires the a./b. prefixes that the API actually accepts', async () => {
    const { assertAllowed, AllowlistViolation } = await import('../src/qloo/allowlist');
    expect(() => assertAllowed('/v2/analysis/compare', { 'signal.interests.entities': 'x' })).toThrow(AllowlistViolation);
    assertAllowed('/v2/analysis/compare', { 'a.signal.interests.entities': 'x', 'b.signal.location.query': 'Chicago, IL' });
  });

  it('refuses a value that would collapse in the URL instead of being joined on purpose', async () => {
    const { assertAllowed, AllowlistViolation } = await import('../src/qloo/allowlist');
    // String(['a','b']) is "a,b" — the shape a comma list takes — so an accidental
    // array would reach Qloo looking deliberate. Callers that mean a list join it.
    expect(() => assertAllowed('/v2/insights', { 'signal.interests.entities': ['a', 'b'] as never })).toThrow(AllowlistViolation);
    expect(() => assertAllowed('/v2/insights', { 'filter.type': { urn: 'entity' } as never })).toThrow(AllowlistViolation);
    assertAllowed('/v2/insights', { 'signal.interests.entities': ['a', 'b'].join(',') });
  });
});

// ── Error shapes ──────────────────────────────────────────────────────────

describe('REST client: error shape handling', () => {
  it('surfaces the {"error": {...}} shape without crashing', async () => {
    const calls = captureFetch(MOCK_ERROR_OBJECT, 500);
    const { search } = await import('../src/qloo/rest-client');
    const result = await search('Brand X').catch(() => []);
    expect(Array.isArray(result)).toBe(true);
    expect(calls.length).toBeGreaterThan(1); // 500 is transient, so it is retried
  }, 30_000);

  it('does not retry a 400 — a wrong contract is reported, not hidden', async () => {
    const calls = captureFetch(MOCK_ERROR_ARRAY, 400);
    const { search, QlooApiError } = await import('../src/qloo/rest-client');
    const err: any = await search('Brand Y').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(QlooApiError);
    expect(err.status).toBe(400);
    expect(calls.length).toBe(1);
  }, 30_000);
});

// ── Entity resolution never guesses ───────────────────────────────────────

describe('REST client: entity resolution', () => {
  it('resolves a single exact match', async () => {
    captureFetch(MOCK_SINGLE_ENTITY);
    const { resolveEntity } = await import('../src/qloo/rest-client');
    const res = await resolveEntity('Test Brand A', 'urn:entity:brand');
    expect(res.status).toBe('resolved');
    expect(res.entity_id).toBe('AAA-111');
  });

  it('asks for input when several entities match', async () => {
    captureFetch(MOCK_MULTI_ENTITY);
    const { resolveEntity } = await import('../src/qloo/rest-client');
    const res = await resolveEntity('Test Brand', 'urn:entity:brand');
    expect(res.status).toBe('needs_input');
    expect((res.candidates?.length ?? 0) > 0).toBe(true);
  });

  it('reports unresolved for zero results', async () => {
    captureFetch(MOCK_EMPTY);
    const { resolveEntity } = await import('../src/qloo/rest-client');
    const res = await resolveEntity('NonexistentBrandXYZ');
    expect(res.status).toBe('unresolved');
  });
});

// ── Honest score model: rank is Qloo's, fit is derived ────────────────────

describe('parseEntities: no invented affinity', () => {
  it('derives fit from Qloo result order and keeps popularity from the response', async () => {
    const { parseEntities } = await import('../src/qloo/rest-client');
    const rows = parseEntities(MOCK_MULTI_ENTITY, 'recommend', '/v2/insights', 'cached', '2026-01-01T00:00:00.000Z');
    expect(rows.map((r: any) => r.qloo_rank)).toEqual([1, 2]);
    expect(rows[0].fit).toBeGreaterThan(rows[1].fit);
    expect(rows[0].popularity).toBe(0.35);
    // Nothing named "score" is invented anywhere in the parsed row.
    expect('score' in rows[0]).toBe(false);
  });

  it('reads tags as objects so rules can match tag ids', async () => {
    const { parseEntities } = await import('../src/qloo/rest-client');
    const rows = parseEntities(
      { results: [{ entity_id: 'Z1', name: 'Z', subtype: 'urn:entity:artist', tags: [{ id: 'urn:tag:music:qloo:explicit', name: 'Explicit', type: 'urn:tag:music:qloo' }] }] },
      'recommend', '/v2/insights', 'cached', '2026-01-01T00:00:00.000Z',
    );
    expect(rows[0].qloo_tags[0].id).toBe('urn:tag:music:qloo:explicit');
    expect(rows[0].tag_names).toContain('explicit');
  });
});

// ── Mode ladder and the log's honesty ─────────────────────────────────────

describe('effective mode ladder (F41)', () => {
  it('replay passes through unchanged', async () => {
    const { effectiveMode } = await import('../src/agents/quota');
    expect(effectiveMode('replay', '10.0.0.1').mode).toBe('replay');
  });

  it('cached passes through unchanged', async () => {
    const { effectiveMode } = await import('../src/agents/quota');
    expect(effectiveMode('cached', '10.0.0.1').mode).toBe('cached');
  });

  // Live is on for this file (the transport is under test), so degradation is
  // exercised with a re-import with the host switch off. The API key is never
  // unset: that would let .env's real key back in through the dotenv loader.
  it('requested live on a host with live switched off degrades to cached and says why', async () => {
    vi.resetModules();
    process.env.QLOO_ENABLED = 'false';
    try {
      const { effectiveMode } = await import('../src/agents/quota');
      const r = effectiveMode('live', '10.0.0.1');
      expect(r.mode).toBe('cached');
      expect(r.degraded_from).toBe('live');
      expect(r.reason.length).toBeGreaterThan(0);
    } finally {
      process.env.QLOO_ENABLED = 'true';
      vi.resetModules();
    }
  });

  it('the call log never carries an API key or a payload', async () => {
    captureFetch(MOCK_SINGLE_ENTITY);
    const { search, getRestLog } = await import('../src/qloo/rest-client');
    await search('Test').catch(() => {});
    const dump = JSON.stringify(getRestLog());
    const key = process.env.QLOO_API_KEY ?? '';
    if (key) expect(dump).not.toContain(key);
    expect(dump).not.toMatch(/x-api-key/i);
    expect(dump).not.toContain('Test Brand A');
  });
});

// ── The host-level gate: QLOO_ENABLED=false means nothing leaves ────────────
//
// This is the guardrail that keeps a cache miss from spending real quota on a
// machine where live Qloo is switched off. It re-imports the client with the flag
// flipped, then restores the module so later tests see the same instance again.

describe('host gate: live Qloo off', () => {
  it('refuses the network on a cache miss and leaves the day counter alone', async () => {
    vi.resetModules();
    process.env.QLOO_ENABLED = 'false';
    try {
      const calls = captureFetch(MOCK_SINGLE_ENTITY);
      const { search, quotaStatus, networkCallCount } = await import('../src/qloo/rest-client');
      const before = quotaStatus().used;
      const netBefore = networkCallCount();
      const err: any = await search('Gated Brand').then(() => null, (e) => e);
      expect(err).toBeTruthy();
      expect(err?.name).toBe('QlooApiError');
      expect(calls.length).toBe(0);
      expect(quotaStatus().used).toBe(before);
      expect(networkCallCount()).toBe(netBefore);
    } finally {
      process.env.QLOO_ENABLED = 'true';
      vi.resetModules();
      await import('../src/qloo/rest-client');
    }
  }, 30_000);
});

// ── Per-run live gate (the Quota Guardian's "Cached" must mean no network) ──

describe('per-run live gate', () => {
  it('refuses the network for a run that was not granted live, cache miss included', async () => {
    const calls = captureFetch(MOCK_SINGLE_ENTITY);
    const { search, withLiveAllowed, networkCallCount } = await import('../src/qloo/rest-client');
    const netBefore = networkCallCount();
    const err: any = await withLiveAllowed(false, () => search('Denied Brand')).then(() => null, (e) => e);
    expect(err?.name).toBe('QlooApiError');
    expect(calls.length).toBe(0);
    expect(networkCallCount()).toBe(netBefore);
    // The gate is a scope, not a switch: outside it the same call still goes out.
    await withLiveAllowed(true, () => search('Granted Brand')).catch(() => {});
    expect(calls.length).toBeGreaterThan(0);
  }, 30_000);

  it('still reads a stored answer inside the gate and fetches nothing', async () => {
    captureFetch(MOCK_SINGLE_ENTITY);
    const { search, withLiveAllowed, networkCallCount } = await import('../src/qloo/rest-client');
    await search('Already Stored Brand');                       // this answer lands in the scratch cache
    const second = captureFetch(MOCK_MULTI_ENTITY);             // must never be reached
    const netBefore = networkCallCount();
    const rows = await withLiveAllowed(false, () => search('Already Stored Brand'));
    expect(rows.length).toBe(1);
    expect(second.length).toBe(0);
    expect(networkCallCount()).toBe(netBefore);
  }, 30_000);
});
