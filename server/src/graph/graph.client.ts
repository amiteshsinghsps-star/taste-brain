import { FalkorDB, Graph } from 'falkordb';
import { env } from '../config/env';
import { ensureGraphSchema } from './graph.schema';

/**
 * FalkorDB connection management.
 *
 * Everything in Neutronz goes through GraphService.forTenant(tenantId):
 * there is NO code path that runs Cypher without a tenant-bound graph handle
 * (PRD §8.3). Graph names are derived server-side only, never from client input.
 */

let client: FalkorDB | null = null;
let connectPromise: Promise<FalkorDB> | null = null;

export async function getFalkorClient(): Promise<FalkorDB> {
  if (client) return client;
  if (!connectPromise) {
    const opts: any = {
      socket: {
        host: env.FALKORDB_HOST,
        port: env.FALKORDB_PORT,
        connectTimeout: 5000,
        reconnectStrategy: (retries: number) => (retries > 3 ? false : Math.min(retries * 200, 1000)),
      },
    };
    if (env.FALKORDB_PASSWORD) {
      opts.password = env.FALKORDB_PASSWORD;
    }
    if (env.FALKORDB_USERNAME) {
      opts.username = env.FALKORDB_USERNAME;
    }
    const connecting: Promise<FalkorDB> = FalkorDB.connect(opts).then((c: FalkorDB) => {
      client = c;
      return c;
    });
    connectPromise = connecting;
    connecting.catch(() => {
      connectPromise = null;
    });
  }
  return connectPromise as Promise<FalkorDB>;
}

export async function isFalkorReachable(): Promise<boolean> {
  try {
    const c = await getFalkorClient();
    await c.list();
    return true;
  } catch {
    return false;
  }
}

export class GraphUnavailableError extends Error {
  code = 'GRAPH_UNAVAILABLE';
  constructor() {
    super('FalkorDB is not reachable. The Company Brain requires the graph store.');
  }
}

/**
 * Ensures FalkorDB is reachable; throws typed error otherwise (FR-10 — no silent fallback).
 *
 * The client object can be returned by `connect()` before the socket is proven
 * alive, so this pings at most once every PROBE_TTL_MS and converts any
 * connection-level failure into GRAPH_UNAVAILABLE. Without the ping a dead port
 * surfaces as a raw redis error (HTTP 500) instead of the documented 503.
 */
const PROBE_TTL_MS = 2000;
let lastGoodProbe = 0;

export async function requireFalkor(): Promise<FalkorDB> {
  let c: FalkorDB;
  try {
    c = await getFalkorClient();
  } catch {
    throw new GraphUnavailableError();
  }
  if (Date.now() - lastGoodProbe > PROBE_TTL_MS) {
    try {
      await c.list();
      lastGoodProbe = Date.now();
    } catch {
      lastGoodProbe = 0;
      await closeClient().catch(() => undefined);
      throw new GraphUnavailableError();
    }
  }
  return c;
}

type GraphHandle = Graph & { __tenantId?: string };

/**
 * Selects the tenant graph. Graph is created lazily on first write; indexes
 * are ensured on first use per process.
 */
export async function forTenant(tenantId: string): Promise<Graph> {
  const c = await requireFalkor();
  const graphName = tenantGraphName(tenantId);
  const graph = c.selectGraph(graphName) as GraphHandle;

  const schemaKey = `schema:${graphName}`;
  if (!(globalThis as any)[schemaKey]) {
    try {
      await ensureGraphSchema(c.selectGraph(graphName) as any, env.EMBEDDINGS_DIM);
      (globalThis as any)[schemaKey] = true;
    } catch (err: any) {
      // Schema errors on already-created objects are fine; surface the rest but
      // do not block tenant use.
      console.warn('Graph schema ensure notice:', err?.message || err);
      (globalThis as any)[schemaKey] = true;
    }
  }
  return graph;
}

export function tenantGraphName(tenantId: string): string {
  // Server-side derivation only; safe characters for Redis key names.
  const safe = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
  return `tenant_${safe}`;
}

export async function deleteTenantGraph(tenantId: string): Promise<void> {
  const c = await requireFalkor();
  const graphName = tenantGraphName(tenantId);
  // FalkorDB errors on deleting a graph that was never written — treat it as done.
  const existing = await c.list();
  const names = (existing as any)?.graphs ?? existing;
  if (Array.isArray(names) && !names.map(String).includes(graphName)) return;
  await c.selectGraph(graphName).delete();
}

export async function closeClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    connectPromise = null;
  }
}

/**
 * Idle demos get their socket dropped by Docker/host NAT, and the first click
 * afterwards fails. Ping on a timer and discard the handle when the ping fails
 * so the next request transparently reconnects.
 */
export function startKeepAlive(intervalMs = 30_000): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      if (!client) return;
      await client.list();
    } catch {
      const dead = client;
      client = null;
      connectPromise = null;
      await dead?.close().catch(() => undefined);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}
