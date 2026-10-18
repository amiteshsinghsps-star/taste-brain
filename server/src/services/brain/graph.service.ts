import crypto from 'crypto';
import {
  forTenant,
  GraphUnavailableError,
  deleteTenantGraph,
  tenantGraphName,
} from '../../graph/graph.client';
import {
  runQuery,
  mergeNode,
  mergeRelation,
  setVectorProp,
  getGraphStats,
  findEntityNodesByName,
  nodeProps,
} from '../../graph/graph.queries';
import { isNodeLabel, isRelationshipType, normalizeName, NODE_LABELS } from '../../graph/graph.schema';
import { embedTexts } from './embeddings.service';
import { ChunkerService } from '../ingestion/chunker.service';

/**
 * TenantGraphService — FalkorDB, one isolated graph per tenant (PRD G3/G4 fix).
 *
 * This fully replaces the old Prisma Entity/EntityRelation "graph", which was
 * global and decorative. Postgres keeps only users/sources/audit; all company
 * knowledge (documents, chunks, people, policies, rules, decisions, memory)
 * lives in FalkorDB graphs named `tenant_<id>`.
 */

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export interface IngestedDocRecord {
  id: string;
  title: string;
  content: string;
  sourceUrl?: string | null;
  sourceType?: string;
  dataStructureLabel?: string;
}

export class TenantGraphService {
  /** Writes a Document node + Chunk nodes (+ embeddings) into the tenant graph. Idempotent by hash (FR-6). */
  static async ingestDocument(tenantId: string, doc: IngestedDocRecord): Promise<{ documentId: string; chunks: number; superseded: boolean; previousVersionId?: string }> {
    const graph = await forTenant(tenantId);
    const hash = sha256(doc.content);
    const label = doc.sourceType || 'Document';

    // Freshness: if an identical-hash version exists, skip (FR-6).
    const existing = await runQuery(graph, `MATCH (d:Document) WHERE d.hash = $hash RETURN d.id AS id`, { hash });
    if (existing.length > 0) {
      return { documentId: existing[0].id, chunks: -1, superseded: false };
    }

    // If a same-title version already exists, create a new version & supersede old.
    const prevRows = await runQuery(
      graph,
      `MATCH (d:Document {title: $title}) WHERE d.status = 'ACTIVE' OR NOT exists(d.status) RETURN d.id AS id ORDER BY d.createdAt DESC LIMIT 1`,
      { title: doc.title }
    );
    const previousVersionId = prevRows[0]?.id;

    const documentId = `doc_${crypto.randomUUID()}`;
    const chunks = ChunkerService.chunkText(doc.content);

    const { vectors, provider } = await embedTexts(chunks);

    await mergeNode(graph, 'Document', documentId, {
      title: doc.title,
      sourceType: (doc.sourceType || 'FOLDER').toLowerCase?.() || doc.sourceType,
      sourceUrl: doc.sourceUrl || '',
      version: (await this.maxDocumentVersion(graph, doc.title)) + 1,
      hash,
      status: 'ACTIVE',
      validFrom: Date.now().toString(),
      validTo: '',
      createdAt: new Date().toISOString(),
      demoSeed: doc.dataStructureLabel === 'demo-seed' ? 'true' : 'false',
    });

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `${documentId}_c${i}`;
      await mergeNode(graph, 'Chunk', chunkId, {
        text: chunks[i],
        idx: i,
        documentId,
      });
      await setVectorProp(graph, 'Chunk', chunkId, 'embedding', vectors[i]);
      await mergeRelation(graph, 'Chunk', chunkId, 'Document', documentId, 'PART_OF');
    }

    if (previousVersionId) {
      await mergeRelation(graph, 'Document', documentId, 'Document', previousVersionId, 'SUPERSEDES');
      await runQuery(
        graph,
        `MATCH (o:Document {id: $old}) SET o.validTo = $now, o.status = 'SUPERSEDED'`,
        { old: previousVersionId, now: new Date().toISOString() }
      );
      // FR-6: mark dependent rules STALE for review.
      await this.flagDependentsStale(graph, previousVersionId);
    }

    return { documentId, chunks: chunks.length, superseded: Boolean(previousVersionId), previousVersionId, provider } as any;
  }

  private static async maxDocumentVersion(graph: any, title: string): Promise<number> {
    const rows = await runQuery(graph, `MATCH (d:Document {title: $title}) RETURN max(d.version) AS v`, { title });
    return Number(rows[0]?.v || 0);
  }

  /** Rules derived (via chunks) from a superseded document are flagged STALE (FR-6). */
  static async flagDependentsStale(graph: any, oldDocumentId: string): Promise<void> {
    await runQuery(
      graph,
      `MATCH (c:Chunk {documentId: $oldDocumentId})<-[:DERIVED_FROM]-(r:Rule)
       SET r.status = 'STALE', r.staleReason = 'Source document changed'`,
      { oldDocumentId }
    );
    await runQuery(
      graph,
      `MATCH (c:Chunk {documentId: $oldDocumentId})<-[:DERIVED_FROM]-(r:Rule)-[:IMPLEMENTS]->(p:Policy)
       SET p.status = 'REVIEW_PENDING'`,
      { oldDocumentId }
    );
  }

  /** Deletes a document node + chunks + their derived relations (tenant graph). */
  static async removeDocument(tenantId: string, documentId: string): Promise<void> {
    const graph = await forTenant(tenantId);
    await runQuery(graph, `MATCH (c:Chunk {documentId: $documentId}) DETACH DELETE c`, { documentId });
    await runQuery(graph, `MATCH (d:Document {id: $documentId}) DETACH DELETE d`, { documentId });
  }

  /** Full tenant subgraph for the Knowledge Graph explorer (FR: real FalkorDB data). */
  static async getGraphData(tenantId: string, opts: { focus?: string; depth?: number; labels?: string[] } = {}): Promise<{ nodes: any[]; links: any[] }> {
    const graph = await forTenant(tenantId);

    let nodes: any[] = [];
    let links: any[] = [];

    if (opts.focus) {
      const depth = Math.min(Math.max(opts.depth || 2, 1), 4);
      const labelFilter = (opts.labels || []).filter(isNodeLabel);
      const nodeFilter = labelFilter.length ? `AND labels(n)[0] IN $keepLabels` : '';
      nodes = await runQuery(
        graph,
        `MATCH (f) WHERE f.id = $focus
         MATCH path = (f)-[*1..${depth}]-(n)
         WHERE 1 = 1 ${nodeFilter}
         RETURN DISTINCT n LIMIT 400`,
        { focus: opts.focus, keepLabels: labelFilter }
      );
      const nodeIds = nodes.map((r: any) => nodeProps(r.n).id).filter(Boolean).concat([opts.focus]);
      links = await runQuery(
        graph,
        `MATCH (a)-[r]->(b) WHERE a.id IN $nodeIds AND b.id IN $nodeIds
         RETURN a.id AS source, b.id AS target, type(r) AS relationType`,
        { nodeIds }
      );
      nodes = nodes.concat((await runQuery(graph, `MATCH (f) WHERE f.id = $focus RETURN f LIMIT 1`, { focus: opts.focus })).map((r: any) => ({ n: r.f })));
    } else {
      const labelFilter = (opts.labels || []).filter(isNodeLabel);
      const nodeFilter = labelFilter.length ? `AND labels(n)[0] IN $keepLabels` : '';
      nodes = await runQuery(
        graph,
        `MATCH (n) WHERE 1 = 1 ${nodeFilter} RETURN n LIMIT 500`,
        { keepLabels: labelFilter }
      );
      links = await runQuery(graph, `MATCH (a)-[r]->(b) RETURN a.id AS source, b.id AS target, type(r) AS relationType LIMIT 2000`);
    }

    const mappedNodes = nodes
      .map((r: any) => nodeProps(r.n))
      .filter((n: any) => n?.id)
      .map((n: any) => ({
        id: n.id,
        name: n.name || n.title || n.summary || n.statement || (n.text ? String(n.text).slice(0, 40) : n.id),
        label: inferLabel(n),
        type: inferLabel(n),
        properties: n,
      }));

    // de-dup
    const seen = new Set<string>();
    const uniqueNodes = mappedNodes.filter((n: any) => {
      if (seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });

    const mappedLinks = links.map((r: any) => ({
      source: r.source,
      target: r.target,
      relationType: r.relationType,
    }));

    return { nodes: uniqueNodes, links: mappedLinks };
  }

  /** Node detail + neighbors + provenance for the explorer (NEW endpoint FR). */
  static async getNodeDetail(tenantId: string, nodeId: string): Promise<any> {
    const graph = await forTenant(tenantId);
    const nodeRows = await runQuery(graph, `MATCH (n {id: $nodeId}) RETURN n LIMIT 1`, { nodeId });
    if (!nodeRows.length) return null;
    const neighbors = await runQuery(
      graph,
      `MATCH (n {id: $nodeId})-[r]-(m)
       RETURN m.id AS id, labels(m)[0] AS label,
              coalesce(m.name, m.title, m.summary, m.statement, m.ruleName, m.id) AS name,
              type(r) AS relationType, (startNode(r).id = n.id) AS outgoing
       LIMIT 50`,
      { nodeId }
    );
    // Provenance: DERIVED_FROM chains to chunks/documents
    const provenance = await runQuery(
      graph,
      `MATCH (n {id: $nodeId})-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(d:Document)
       RETURN c.id AS chunkId, c.text AS chunkText, d.id AS documentId, d.title AS documentTitle, d.sourceUrl AS sourceUrl LIMIT 10`,
      { nodeId }
    );
    const versions = await runQuery(
      graph,
      `MATCH (d:Document {id: $nodeId})-[:SUPERSEDES*0..1]->(old:Document)
       RETURN d.title, old.title AS supersededTitle LIMIT 5`,
      { nodeId }
    );
    return {
      node: nodeProps(nodeRows[0].n),
      neighbors: neighbors.map((r: any) => ({ id: r.id, label: r.label, name: r.name, relationType: r.relationType, outgoing: r.outgoing })),
      provenance,
      versions,
    };
  }

  static async getGraphStats(tenantId: string) {
    const graph = await forTenant(tenantId);
    return getGraphStats(graph);
  }

  static async clearTenantData(tenantId: string): Promise<boolean> {
    const ok = await this.isFalkorUp();
    if (!ok) throw new GraphUnavailableError();
    await deleteTenantGraph(tenantId);
    return true;
  }

  static async isFalkorUp(): Promise<boolean> {
    try {
      const { isFalkorReachable } = await import('../../graph/graph.client');
      return await isFalkorReachable();
    } catch {
      return false;
    }
  }

  static async graphNameFor(tenantId: string): Promise<string> {
    return tenantGraphName(tenantId);
  }

  /**
   * Legacy-compatible entrypoint used by ingestion flows: re-extracts entities
   * and relations from tenant documents already present in SQL. Delegates to
   * extraction for actual LLM/heuristic work.
   */
  static async extractGraphFromDocuments(tenantId: string): Promise<{ success: boolean; extractedRelationsCount: number }> {
    const { ExtractionService } = await import('./extraction.service');
    return ExtractionService.extractFromTenantDocuments(tenantId);
  }
}

function inferLabel(n: any): string {
  if (n.policyName) return 'Policy';
  // FalkorDB returns props only; look for distinguishing props.
  const known: Array<[string, string]> = [
    ['text', 'Chunk'],
    ['title', 'Document'],
    ['summary', 'Decision'],
    ['statement', 'Fact'],
    ['actionType', 'Rule'],
    ['channel', 'Message'],
    ['steps', 'Procedure'],
    ['ruleName', 'Rule'],
    ['policyName', 'Policy'],
    ['list', 'WatchlistEntry'],
    ['email', 'Person'],
    ['role', 'Person'],
    ['teamName', 'Team'],
  ];
  for (const [prop, label] of known) {
    if (prop in n && prop !== 'role') {
      return label;
    }
    if (prop === 'role' && prop in n) return 'Person';
  }
  if ('name' in n) return 'Person';
  return 'Entity';
}

export { findEntityNodesByName, isRelationshipType };
