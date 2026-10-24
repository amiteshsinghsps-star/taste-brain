import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test file gets its own in-memory SQLite graph, so no cross-file race.
    fileParallelism: false,
    testTimeout: 30_000,
    // The suite makes far more requests than a real visitor would, so the
    // per-IP bucket is widened here; the production default stays at 30/min.
    // QLOO_PRIVATE_CACHE_DIR is redirected to a scratch directory: a test run
    // must never read from, or write synthetic payloads into, the store that
    // holds the real Qloo responses the demo serves as "cached".
    env: { GRAPH_DB: ':memory:', DEFAULT_MODE: 'replay', QLOO_ENABLED: 'false', RATE_LIMIT_PER_MIN: '100000', QLOO_PRIVATE_CACHE_DIR: '.private-cache-test' },
  },
});
