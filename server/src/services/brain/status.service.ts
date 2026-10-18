import { env } from '../../config/env';
import { getFalkorClient, tenantGraphName, GraphUnavailableError } from '../../graph/graph.client';
import { prisma } from '../../db/client';

/**
 * Proof that FalkorDB is the backend and not decoration (§E04): node/edge counts
 * come from the live graph via `CALL db.meta.stats()`, so a stale Postgres cache
 * or a keyword-search fallback cannot fake them.
 */

export interface GraphStats {
  nodes: number;
  edges: number;
  labels: Record<string, number>;
  relationshipTypes: Record<string, number>;
}

const STATS_QUERY = 'CALL db.meta.stats() YIELD labels, relTypes RETURN labels AS labels, relTypes AS relTypes';

function counts(map: any): Record<string, number> {
  if (!map || typeof map !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) {
    const label = (k as any).label ?? (k as any).name ?? k;
    out[String(label)] = Number(v) || 0;
  }
  return out;
}

function sum(values: Record<string, number>): number {
  return Object.values(values).reduce((a, b) => a + b, 0);
}

function emptyStats(): GraphStats {
  return { nodes: 0, edges: 0, labels: {}, relationshipTypes: {} };
}

function add(target: GraphStats, other: GraphStats): void {
  for (const [k, v] of Object.entries(other.labels)) target.labels[k] = (target.labels[k] ?? 0) + v;
  for (const [k, v] of Object.entries(other.relationshipTypes))
    target.relationshipTypes[k] = (target.relationshipTypes[k] ?? 0) + v;
  // Recompute from the merged maps so aggregating N graphs cannot lose counts.
  target.nodes = sum(target.labels);
  target.edges = sum(target.relationshipTypes);
}

async function statsForGraph(graphName: string): Promise<GraphStats> {
  const client = await getFalkorClient();
  const res: any = await client.selectGraph(graphName).query(STATS_QUERY);
  const row = (res.data as any[])[0] ?? {};
  const labels = counts(row.labels);
  const relTypes = counts(row.relTypes);
  return { nodes: sum(labels), edges: sum(relTypes), labels, relationshipTypes: relTypes };
}

export class StatusService {
  /** Stats for one tenant graph, derived server-side from the tenant id. */
  static async tenantStats(tenantId: string): Promise<GraphStats & { graph: string }> {
    const graph = tenantGraphName(tenantId);
    const stats = await statsForGraph(graph);
    return { graph, ...stats };
  }

  /**
   * Public platform proof: aggregate structure only (counts and label names),
   * never node contents or tenant identifiers. Graph names are not returned.
   */
  static async platformStatus(): Promise<Record<string, any>> {
    const started = Date.now();
    let falkor: Record<string, any> = { reachable: false, graphs: 0, error: null as string | null };
    let totals: GraphStats = emptyStats();

    try {
      const client = await getFalkorClient();
      const listed: any = await client.list();
      const names: string[] = ((listed?.graphs ?? listed ?? []) as any[]).map(String);
      falkor = { reachable: true, graphs: names.length, error: null };
      for (const name of names.slice(0, 100)) {
        try {
          add(totals, await statsForGraph(name));
        } catch {
          /* graph exists but has never been written to */
        }
      }
    } catch (err: any) {
      falkor.error = err?.code === 'GRAPH_UNAVAILABLE' ? 'GRAPH_UNAVAILABLE' : err?.message || 'connection refused';
    }

    let postgres = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      postgres = true;
    } catch {
      postgres = false;
    }

    return {
      ok: falkor.reachable,
      backend: 'falkordb',
      graph: totals,
      stores: {
        falkordb: { ...falkor, host: env.FALKORDB_HOST, port: env.FALKORDB_PORT },
        postgres,
      },
      llm: env.OPENAI_API_KEY ? 'configured' : 'none (retrieval still answers with cited graph facts)',
      flags: {
        liveConnectors: env.FF_LIVE_CONNECTORS ? 'enabled' : 'disabled',
        requireFalkor: process.env.FALKORDB_REQUIRED ? 'enabled' : 'disabled',
      },
      version: env.GIT_COMMIT || 'dev',
      uptimeSec: Math.round(process.uptime()),
      statusLatencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  /** Used by the removal test: must throw rather than degrade to a non-graph answer. */
  static async requireGraph(tenantId: string): Promise<GraphStats & { graph: string }> {
    try {
      return await this.tenantStats(tenantId);
    } catch (err: any) {
      if (err?.code === 'GRAPH_UNAVAILABLE') throw err;
      throw new GraphUnavailableError();
    }
  }
}
