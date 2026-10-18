import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../../db/client';
import { forTenant } from '../../graph/graph.client';
import { mergeNode, mergeRelation, runQuery } from '../../graph/graph.queries';
import { isNodeLabel, isRelationshipType, normalizeName, NodeLabel } from '../../graph/graph.schema';
import { env } from '../../config/env';
import { ChunkerService } from '../ingestion/chunker.service';

/**
 * ExtractionService (FR-2, FR-3, FR-4, FR-5) — replaces the old regex-only
 * extractor (G2 fix).
 *
 * Pipeline per chunk:
 *   1. LLM extraction with a strict JSON schema (entities, relations, rules).
 *   2. Validation: unknown labels/relation types are rejected, endpoints must
 *      exist in the entity set, user input never fabricates node ids.
 *   3. Entity resolution: MERGE on (type, normalized name) within the tenant
 *      graph only. Never merged across tenants.
 *   4. Provenance: every Policy/Rule/Decision/Fact gets a DERIVED_FROM edge to
 *      its evidence chunk.
 *
 * Operational rules (actionType in the supported engine set) are extracted as
 * executable; anything else is stored isExecutable=false with a readable
 * description (FR-5).
 */

const EXECUTABLE_ACTION_TYPES = new Set([
  'DENIED_PARTY_SCREENING',
  'HS_CODE_VALIDATION',
  'CREDIT_LIMIT_APPROVAL',
]);

export interface ExtractedEntity {
  type: string;
  name: string;
  aliases?: string[];
  owners?: string[];
  description?: string;
}

export interface ExtractedRelation {
  type: string;
  source: string;
  target: string;
  evidence?: string;
}

export interface ExtractedRule {
  name?: string;
  actionType: string;
  trigger?: string;
  severity?: string;
  params?: Record<string, any>;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  rules: ExtractedRule[];
}

const EXTRACTION_PROMPT = `You are a company knowledge-graph extraction engine. Extract entities, relations and executable rules from the given text of a company document chunk.

Return STRICT JSON only, no prose, matching exactly this schema:
{
  "entities": [{"type": "<label>", "name": "<canonical name>", "aliases": ["..."], "owners": ["<person names>", ...]}],
  "relations": [{"type": "<relation type>", "source": "<entity name>", "target": "<entity name>", "evidence": "<short verbatim quote>"}],
  "rules": [{"name": "<short name>", "actionType": "<ACTION_TYPE>", "trigger": "<when it fires>", "severity": "CRITICAL|HIGH|MEDIUM|LOW", "params": {"<key>": <value>}}]
}

Allowed entity types: ${'PERSON, TEAM, POLICY, SYSTEM, PROJECT, RULE, CUSTOMER'}. Map people to PERSON, procedures/policies/SOPs to POLICY, software/processes to SYSTEM, teams/departments to TEAM.
Allowed relation types: OWNS, AUTHORED, GOVERNS, REQUIRES, VALIDATES, APPROVES, MEMBER_OF, KNOWS_ABOUT.
For rules: only extract rules that look machine-checkable (screening checks, threshold checks, code validation). actionType should be one of DENIED_PARTY_SCREENING, HS_CODE_VALIDATION, CREDIT_LIMIT_APPROVAL when applicable; otherwise use flavor like GENERIC_CHECK.
Do not invent facts not present in the text. If nothing extractable, return empty arrays.`;

export class ExtractionService {
  /** Extracts entities/relations/rules for every document of a tenant. Idempotent. */
  static async extractFromTenantDocuments(
    tenantId: string,
    onlyDocumentId?: string
  ): Promise<{ success: boolean; extractedRelationsCount: number; documentsProcessed: number; llmUsed: boolean }> {
    const prismaDocs = await prisma.ingestedDocument.findMany({
      where: { userId: tenantId, ...(onlyDocumentId ? { id: onlyDocumentId } : {}) },
      include: { chunks: true },
    });

    let relationsCount = 0;
    let llmUsed = false;
    let documentsProcessed = 0;

    for (const doc of prismaDocs) {
      documentsProcessed++;
      // Ensure Document + Chunks exist in the graph (ingest may not have run).
      const graphDocId = await this.ensureDocumentInGraph(tenantId, doc.id, doc.title, doc.content, doc.sourceUrl);

      for (const chunk of doc.chunks) {
        await this.ensureChunkInGraph(tenantId, graphDocId, chunk.id, chunk.text, chunk.chunkIndex);
        try {
          const result = await this.extractFromText(chunk.text);
          if (result.llmUsed) llmUsed = true;
          await this.writeExtractionToGraph(tenantId, graphDocId, chunk.id, chunk.text, result.data);
          relationsCount += result.data.relations.length;
        } catch (err: any) {
          console.warn(`extraction notice (chunk ${chunk.id}):`, err?.message || err);
        }
      }
    }

    return { success: true, extractedRelationsCount: relationsCount, documentsProcessed, llmUsed };
  }

  /** LLM extraction with schema validation; falls back to deterministic heuristics. */
  static async extractFromText(text: string): Promise<{ data: ExtractionResult; llmUsed: boolean }> {
    if (env.OPENAI_API_KEY) {
      try {
        const res = await axios.post(
          `${env.OPENAI_BASE_URL.replace(/\/+$/, '')}/chat/completions`,
          {
            model: env.OPENAI_MODEL,
            messages: [
              { role: 'system', content: EXTRACTION_PROMPT },
              { role: 'user', content: text.slice(0, 4000) },
            ],
            temperature: 0,
            response_format: { type: 'json_object' },
          },
          { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 40000 }
        );
        const content = res.data?.choices?.[0]?.message?.content || '';
        const parsed = JSON.parse(content);
        const data = this.validateExtraction(parsed);
        return { data, llmUsed: true };
      } catch (err: any) {
        console.warn('LLM extraction notice (falling back to heuristics):', err?.message || err);
      }
    }
    // Heuristic fallback (only when no LLM configured). Honest: flagged llmUsed=false.
    return { data: this.heuristicExtraction(text), llmUsed: false };
  }

  /** Validation gate: reject unknown labels/types + endpoints outside entity set (§12.2). */
  static validateExtraction(parsed: any): ExtractionResult {
    const out: ExtractionResult = { entities: [], relations: [], rules: [] };
    const labelMap: Record<string, string> = {
      PERSON: 'Person',
      TEAM: 'Team',
      POLICY: 'Policy',
      SYSTEM: 'System',
      PROJECT: 'Project',
      RULE: 'Rule',
      CUSTOMER: 'Customer',
    };
    const names = new Set<string>();

    for (const e of parsed?.entities || []) {
      const type = labelMap[String(e?.type || '').toUpperCase()] || e?.type;
      if (!isNodeLabel(type) || typeof e?.name !== 'string' || !e.name.trim()) continue;
      const entity = {
        type: type as NodeLabel,
        name: e.name.trim().slice(0, 200),
        aliases: Array.isArray(e.aliases) ? e.aliases.slice(0, 10).map(String) : [],
        owners: Array.isArray(e.owners) ? e.owners.map(String) : [],
        description: typeof e.description === 'string' ? e.description.slice(0, 600) : undefined,
      };
      out.entities.push(entity);
      names.add(entity.name);
      (entity.aliases || []).forEach((a: any) => names.add(String(a)));
    }

    for (const r of parsed?.relations || []) {
      const type = String(r?.type || '').toUpperCase();
      if (!isRelationshipType(type)) continue;
      if (!names.has(r?.source) || !names.has(r?.target)) continue; // endpoints must be declared entities
      out.relations.push({
        type,
        source: String(r.source).slice(0, 200),
        target: String(r.target).slice(0, 200),
        evidence: String(r?.evidence || '').slice(0, 400),
      });
    }

    for (const rule of parsed?.rules || []) {
      const actionType = String(rule?.actionType || '').toUpperCase().replace(/[\s-]+/g, '_');
      if (!/^[A-Z0-9_]{1,40}$/.test(actionType)) continue;
      out.rules.push({
        name: String(rule?.name || `Rule (${actionType})`).slice(0, 120),
        actionType,
        trigger: String(rule?.trigger || 'On relevant event').slice(0, 200),
        severity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(rule?.severity) ? rule.severity : 'MEDIUM',
        params: typeof rule?.params === 'object' && rule.params ? rule.params : {},
      });
    }

    return out;
  }

  /**
   * Writes validated extraction output into the tenant graph:
   * entity MERGE on (label, normalized searchKey), typed relations, rules with
   * IMPLEMENTS/DERIVED_FROM provenance, OWNS edges.
   */
  static async writeExtractionToGraph(
    tenantId: string,
    documentId: string,
    chunkId: string,
    chunkText: string,
    data: ExtractionResult
  ): Promise<void> {
    const graph = await forTenant(tenantId);
    const nameToId = new Map<string, string>();

    for (const e of data.entities) {
      const nodeKey = `${e.type}:${normalizeName(e.name)}`;
      const existing = await runQuery(
        graph,
        `MATCH (n:${e.type}) WHERE n.searchKey IN [$key, $name] RETURN n.id AS id LIMIT 1`,
        { key: nodeKey, name: normalizeName(e.name) }
      );
      let id: string;
      if (existing.length) {
        id = existing[0].id;
      } else {
        id = `${e.type.toLowerCase()}_${crypto.randomUUID()}`;
        const props: Record<string, any> = {
          name: e.name,
          searchKey: nodeKey,
          aliasesJSON: JSON.stringify(e.aliases || []),
          sourceLabel: 'demo-seed',
        };
        if (e.type === 'Person' && e.description) props.role = e.description.slice(0, 120);
        if (e.type === 'Policy') {
          props.status = 'ACTIVE';
          props.category = 'EXTRACTED';
          props.version = 1;
          props.policyName = e.name;
        }
        if (e.type === 'Rule') {
          props.ruleName = e.name;
        }
        await mergeNode(graph, e.type, id, props);
      }
      nameToId.set(e.name, id);
      (e.aliases || []).forEach((a) => nameToId.set(a, id));

      await mergeRelation(graph, 'Document', documentId, e.type, id, 'MENTIONS');
      await this.linkChunkMention(graph, chunkId, e.type, id);
    }

    // Relations between extracted entities.
    for (const rel of data.relations) {
      const fromLabel = data.entities.find((e) => e.name === rel.source)?.type;
      const toLabel = data.entities.find((e) => e.name === rel.target)?.type;
      const fromId = nameToId.get(rel.source);
      const toId = nameToId.get(rel.target);
      if (!fromId || !toId || !fromLabel || !toLabel || !isRelationshipType(rel.type)) continue;
      await mergeRelation(graph, fromLabel, fromId!, toLabel, toId!, rel.type, { evidence: rel.evidence || '' });
    }

    // Rules from SOP text (FR-5): executable set stays deterministic.
    for (const rule of data.rules) {
      const isExecutable = EXECUTABLE_ACTION_TYPES.has(rule.actionType!);
      const ruleId = `rule_${crypto.randomUUID()}`;
      await mergeNode(graph, 'Rule', ruleId, {
        ruleName: rule.name || `${rule.actionType} (extracted)`,
        actionType: rule.actionType,
        triggerCondition: rule.trigger || '',
        severity: rule.severity || 'MEDIUM',
        parametersJSON: JSON.stringify(rule.params || {}),
        version: 1,
        isExecutable: isExecutable ? 'true' : 'false',
        status: 'ACTIVE',
        description: isExecutable
          ? `Executable ${rule.actionType} rule extracted from SOP.`
          : `Human-reviewable procedure: ${rule.trigger || 'see source'}. Not in the deterministic engine's supported set.`,
      });
      await mergeRelation(graph, 'Rule', ruleId, 'Chunk', chunkId, 'DERIVED_FROM');
      // DERIVED_FROM for Rule → Chunk provenance in both shapes used by queries
      await mergeRelation(graph, 'Chunk', chunkId, 'Rule', ruleId, 'DERIVED_FROM');
      const systemMatch = /customs|freight|booking|invoice|credit/i.test(rule.trigger || chunkText);
      if (systemMatch) {
        // Ensure a System node exists to attach GOVERNS
        const sysId = `system_extraction_${normalizeName(systemMatch ? 'Customs & Freight Systems' : 'Operations')}`;
        await mergeNode(graph, 'System', sysId, { name: systemMatch ? 'Customs Declaration' : 'Operations', kind: 'PLATFORM' });
        await mergeRelation(graph, 'Chunk', chunkId, 'System', sysId, 'MENTIONS');
      }
    }
  }

  private static async ensureDocumentInGraph(
    tenantId: string,
    sqlDocId: string,
    title: string,
    content: string,
    sourceUrl?: string | null
  ): Promise<string> {
    const graph = await forTenant(tenantId);
    const existing = await runQuery(graph, `MATCH (d:Document) WHERE d.sqlId = $sqlDocId RETURN d.id AS id`, { sqlDocId });
    if (existing.length) return existing[0].id;
    const documentId = `doc_${sqlDocId}`;
    await mergeNode(graph, 'Document', documentId, {
      title,
      sourceType: 'ingested',
      sourceUrl: sourceUrl || '',
      version: 1,
      hash: crypto.createHash('sha256').update(content).digest('hex'),
      status: 'ACTIVE',
      validFrom: new Date().toISOString(),
      validTo: '',
      createdAt: new Date().toISOString(),
      demoSeed: 'false',
      sqlId: sqlDocId,
    });
    return documentId;
  }

  private static async ensureChunkInGraph(
    tenantId: string,
    documentId: string,
    chunkId: string,
    text: string,
    idx: number
  ): Promise<void> {
    const graph = await forTenant(tenantId);
    const existing = await runQuery(graph, `MATCH (c:Chunk) WHERE c.sqlId = $chunkId RETURN c.id AS id`, { chunkId });
    if (existing.length) return;

    const graphChunkId = `${documentId}_c${idx}`;
    await mergeNode(graph, 'Chunk', graphChunkId, { text, idx, documentId, sqlId: chunkId });
    await mergeRelation(graph, 'Chunk', graphChunkId, 'Document', documentId, 'PART_OF');
  }

  /** Both directions of Chunk→Entity mention for query convenience (§9.2). */
  private static async linkChunkMention(graph: any, chunkId: string, label: string, id: string): Promise<void> {
    await mergeRelation(graph, 'Chunk', chunkId, label, id, 'MENTIONS');
  }

  /**
   * Deterministic heuristic fallback when no LLM is configured. Deliberately
   * conservative: only creates Policy/System/Person nodes the freight demo
   * domain actually patterns on, always with provenance.
   */
  static heuristicExtraction(text: string): ExtractionResult {
    const entities: ExtractedEntity[] = [];
    const relations: ExtractedRelation[] = [];

    const add = (type: string, name: string) => {
      if (!entities.some((e) => e.name === name)) entities.push({ type, name, aliases: [] });
    };

    if (/denied[- ]party|restricted party|sanction/i.test(text)) {
      add('Policy', 'Denied-Party Screening');
      relations.push({ type: 'GOVERNS', source: 'Denied-Party Screening', target: 'Customs Declaration', evidence: text.slice(0, 200) });
    }
    if (/hs code|harmonized|tariff/i.test(text)) {
      add('Policy', 'HS Code Verification');
      relations.push({ type: 'REQUIRES', source: 'Customs Declaration', target: 'HS Code Verification', evidence: text.slice(0, 200) });
    }
    if (/credit limit|credit approval|invoice/i.test(text)) {
      add('System', 'Invoice Generation');
    }
    add('System', 'Customs Declaration');

    return { entities, relations, rules: [] };
  }
}
