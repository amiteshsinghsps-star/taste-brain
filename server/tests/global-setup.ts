/**
 * Vitest global setup (E10: no silent skips).
 *
 * Graph tests used to `describe.skipIf(!falkorUp)` themselves, which meant a CI
 * run with a dead FalkorDB reported "all green" while executing none of them.
 * With FALKORDB_REQUIRED=1 an unreachable graph now fails the whole run here.
 */
import { isFalkorReachable, closeClient } from '../src/graph/graph.client';

export default async function setup() {
  const up = await isFalkorReachable();
  const required = process.env.FALKORDB_REQUIRED === '1' || process.env.FALKORDB_REQUIRED === 'true';

  if (!up) {
    if (required) {
      throw new Error(
        'FALKORDB_REQUIRED=1 but FalkorDB is unreachable. Start it with `docker compose up -d falkordb` (or fix FALKORDB_HOST/FALKORDB_PORT). Refusing to run graph tests silently skipped.'
      );
    }
    console.warn('\n[graph tests] FalkorDB unreachable — graph-dependent suites will SKIP. Set FALKORDB_REQUIRED=1 to make this a hard failure.\n');
  } else {
    console.log('[graph tests] FalkorDB reachable.');
  }

  return async () => {
    // The cached Redis socket and Prisma pool keep the event loop alive and make
    // the run hang for 10s after the last assertion.
    await closeClient().catch(() => undefined);
    const { prisma } = await import('../src/db/client');
    await prisma.$disconnect().catch(() => undefined);
  };
}
