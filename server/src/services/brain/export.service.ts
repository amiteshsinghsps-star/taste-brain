import { forTenant, tenantGraphName } from '../../graph/graph.client';
import { runQuery } from '../../graph/graph.queries';

/**
 * Graph export — serialize the tenant's own subgraph out of FalkorDB in the
 * three formats a reviewer can actually open: JSON (round-trips into the
 * explorer), GraphML (yEd/Gephi/networkX) and CSV (Excel).
 *
 * Exported node ids are sanitized to XML-safe tokens for GraphML and the
 * original id is kept as a `graphhack:originalId` data key, so nothing about the
 * graph's real identifiers is silently changed.
 */

export type ExportFormat = 'json' | 'graphml' | 'csv' | 'nodes';

export interface ExportedNode {
  id: string;
  label: string;
  name: string;
  status: string | null;
  demoSeed: string;
}

export interface ExportedEdge {
  source: string;
  target: string;
  relationType: string;
}

export interface ExportResult {
  contentType: string;
  filename: string;
  body: string;
  counts: { nodes: number; edges: number };
}

const NODE_SELECT = `MATCH (n)
  RETURN n.id AS id, labels(n)[0] AS label,
         coalesce(n.name, n.title, n.ruleName, n.policyName, n.summary, n.statement, n.bookingNumber, n.id, '') AS name,
         n.status AS status, coalesce(n.demoSeed, 'false') AS demoSeed
  LIMIT 5000`;

const EDGE_SELECT = `MATCH (a)-[r]->(b)
  RETURN a.id AS source, b.id AS target, type(r) AS relationType
  LIMIT 20000`;

/** Escape text content: nothing in the graph may close a tag or invent one. */
function xmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ');
}

/** GraphML ids must be single XML tokens, so anything else is folded to "_". */
function xmlId(value: unknown): string {
  return String(value ?? '').replace(/[^A-Za-z0-9_\-.]/g, '_');
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return `"${raw.replace(/"/g, '""')}"`;
}

async function readGraph(tenantId: string): Promise<{ nodes: ExportedNode[]; edges: ExportedEdge[] }> {
  const graph = await forTenant(tenantId);
  const nodeRows = await runQuery(graph, NODE_SELECT, {});
  const edgeRows = await runQuery(graph, EDGE_SELECT, {});
  const nodes = nodeRows
    .filter((r: any) => r.id)
    .map((r: any) => ({
      id: String(r.id),
      label: String(r.label ?? 'Node'),
      name: String(r.name ?? r.id),
      status: r.status ?? null,
      demoSeed: String(r.demoSeed ?? 'false'),
    }));
  const known = new Set(nodes.map((n) => n.id));
  const edges = edgeRows
    .filter((r: any) => r.source && r.target && known.has(String(r.source)) && known.has(String(r.target)))
    .map((r: any) => ({ source: String(r.source), target: String(r.target), relationType: String(r.relationType ?? '') }));
  return { nodes, edges };
}

export class ExportService {
  static async export(tenantId: string, format: string): Promise<ExportResult> {
    const fmt: ExportFormat = (['json', 'graphml', 'csv', 'nodes'] as string[]).includes(format) ? (format as ExportFormat) : 'json';
    const { nodes, edges } = await readGraph(tenantId);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `neutronz-brain-${stamp}`;
    const counts = { nodes: nodes.length, edges: edges.length };

    if (fmt === 'json') {
      const body = JSON.stringify(
        {
          meta: {
            graph: tenantGraphName(tenantId),
            exportedAt: new Date().toISOString(),
            counts,
            note: 'Every node and edge here was read from this tenant\'s FalkorDB graph. demoSeed="true" marks synthetic demo data.',
          },
          nodes,
          edges,
        },
        null,
        2
      );
      return { contentType: 'application/json; charset=utf-8', filename: `${base}.json`, body, counts };
    }

    if (fmt === 'graphml') {
      const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<graphml xmlns="http://graphml.graphdrawing.org/xmlns">',
        '  <key id="v0" for="node" attr.name="label" attr.type="string"/>',
        '  <key id="v1" for="node" attr.name="name" attr.type="string"/>',
        '  <key id="v2" for="node" attr.name="status" attr.type="string"/>',
        '  <key id="v3" for="node" attr.name="demoSeed" attr.type="string"/>',
        '  <key id="v4" for="node" attr.name="originalId" attr.type="string"/>',
        '  <key id="e0" for="edge" attr.name="relationType" attr.type="string"/>',
        `  <graph id="${xmlId(base)}" edgedefault="directed">`,
      ];
      for (const n of nodes) {
        const gid = `n_${xmlId(n.id)}`;
        lines.push(`    <node id="${gid}">`);
        lines.push(`      <data key="v4">${xmlText(n.id)}</data>`);
        lines.push(`      <data key="v0">${xmlText(n.label)}</data>`);
        lines.push(`      <data key="v1">${xmlText(n.name)}</data>`);
        lines.push(`      <data key="v2">${xmlText(n.status ?? '')}</data>`);
        lines.push(`      <data key="v3">${xmlText(n.demoSeed)}</data>`);
        lines.push('    </node>');
      }
      edges.forEach((e, i) => {
        lines.push(`    <edge id="e${i}" source="n_${xmlId(e.source)}" target="n_${xmlId(e.target)}">`);
        lines.push(`      <data key="e0">${xmlText(e.relationType)}</data>`);
        lines.push('    </edge>');
      });
      lines.push('  </graph>', '</graphml>');
      return { contentType: 'application/graphml+xml; charset=utf-8', filename: `${base}.graphml`, body: lines.join('\n'), counts };
    }

    if (fmt === 'nodes') {
      const header = 'id,label,name,status,demoSeed';
      const body = [header, ...nodes.map((n) => [n.id, n.label, n.name, n.status ?? '', n.demoSeed].map(csvCell).join(','))].join('\r\n');
      return { contentType: 'text/csv; charset=utf-8', filename: `${base}-nodes.csv`, body, counts };
    }

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const header = 'source_id,source_label,source_name,relation_type,target_id,target_label,target_name';
    const body = [
      header,
      ...edges.map((e) =>
        [e.source, byId.get(e.source)?.label ?? '', byId.get(e.source)?.name ?? '', e.relationType, e.target, byId.get(e.target)?.label ?? '', byId.get(e.target)?.name ?? '']
          .map(csvCell)
          .join(',')
      ),
    ].join('\r\n');
    return { contentType: 'text/csv; charset=utf-8', filename: `${base}-edges.csv`, body, counts };
  }
}
