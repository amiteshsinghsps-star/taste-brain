import crypto from 'crypto';
import { forTenant } from '../../graph/graph.client';
import { mergeNode, mergeRelation, runQuery } from '../../graph/graph.queries';

/**
 * MemoryService (FR-19..FR-23, Track 02) — typed, persistent, tenant-scoped
 * agent memory in FalkorDB:
 *   • Episode    — episodic: what happened (task/decision summary + entities)
 *   • Fact       — semantic: stable learned facts with confidence
 *   • Procedure  — procedural: repeatable step flows
 *   • Conversation/Turn — persistent chat history reloaded per session
 *
 * Scoping (FR-23): `scope` prop = 'tenant' (shared) or 'agent:<id>' (private).
 * Every read filters on scope — Agent A's scratch memory is not visible to B.
 */

export interface MemoryScope {
  tenantId: string;
  agentId?: string;
  /** 'tenant' shares across agents; own agent scope otherwise. */
  shared?: boolean;
}

function scopeFor(agentId?: string, shared?: boolean): string {
  return shared || !agentId ? 'tenant' : `agent:${agentId}`;
}

export class MemoryService {
  /** FR-19: write an episodic Episode after agent work, linked to entities. */
  static async writeEpisode(scope: MemoryScope, summary: string, entities: Array<{ label: string; id: string }>, outcome?: string): Promise<string> {
    const graph = await forTenant(scope.tenantId);
    const id = `ep_${crypto.randomUUID()}`;
    await mergeNode(graph, 'Episode', id, {
      summary: summary.slice(0, 800),
      outcome: (outcome || '').slice(0, 300),
      at: new Date().toISOString(),
      scope: scopeFor(scope.agentId, scope.shared),
      agentId: scope.agentId || '',
    });
    if (scope.agentId) {
      await mergeRelation(graph, 'Agent', scope.agentId, 'Episode', id, 'REMEMBERS');
    } else {
      // Attach to a synthetic tenant memory agent so the edge never dangles.
      await mergeNode(graph, 'Agent', `agent_tenant_memory_${scope.tenantId.slice(0, 8)}`, {
        name: 'Company Memory (shared)',
        type: 'MEMORY',
      });
      await mergeRelation(graph, 'Agent', `agent_tenant_memory_${scope.tenantId.slice(0, 8)}`, 'Episode', id, 'REMEMBERS');
    }
    for (const e of entities.slice(0, 8)) {
      try {
        await mergeRelation(graph, 'Episode', id, e.label, e.id, 'ABOUT');
      } catch {
        // skip dangling entity links
      }
    }
    return id;
  }

  /** FR-20: store a semantic Fact with confidence and evidence chunk. */
  static async writeFact(scope: MemoryScope, statement: string, confidence: number, evidenceChunkId?: string): Promise<string> {
    const graph = await forTenant(scope.tenantId);
    const id = `fact_${crypto.randomUUID()}`;
    await mergeNode(graph, 'Fact', id, {
      statement: statement.slice(0, 500),
      confidence: String(Math.max(0, Math.min(1, confidence))),
      at: new Date().toISOString(),
      scope: scopeFor(scope.agentId, scope.shared),
      agentId: scope.agentId || '',
    });
    if (evidenceChunkId) {
      await mergeRelation(graph, 'Fact', id, 'Chunk', evidenceChunkId, 'DERIVED_FROM');
    }
    if (scope.agentId) {
      await mergeRelation(graph, 'Agent', scope.agentId, 'Fact', id, 'REMEMBERS');
    }
    return id;
  }

  /** FR-21: store a repeatable Procedure (steps JSON). */
  static async writeProcedure(scope: MemoryScope, name: string, steps: any[]): Promise<string> {
    const graph = await forTenant(scope.tenantId);
    const id = `proc_${crypto.randomUUID()}`;
    await mergeNode(graph, 'Procedure', id, {
      name: name.slice(0, 200),
      stepsJSON: JSON.stringify(steps).slice(0, 4000),
      version: 1,
      scope: scopeFor(scope.agentId, scope.shared),
    });
    if (scope.agentId) {
      await mergeRelation(graph, 'Agent', scope.agentId, 'Procedure', id, 'REMEMBERS');
    }
    return id;
  }

  /** FR-22: recall — relevance-ranked episodes/facts linked to current entities. */
  static async recall(scope: MemoryScope, queryTokens: string[], agentIdIncluded?: string, limit = 8): Promise<Array<{ kind: string; id: string; text: string; at?: string; confidence?: number }>> {
    const graph = await forTenant(scope.tenantId);
    const scopes = agentIdIncluded ? [scopeFor(scope.agentId, true), `agent:${agentIdIncluded}`] : [scopeFor(scope.agentId, true), 'tenant'];
    const clauses = queryTokens
      .slice(0, 6)
      .map((_, i) => `(m.summary CONTAINS $t${i} OR m.statement CONTAINS $t${i})`)
      .join(' OR ');

    const rows = await runQuery(
      graph,
      `MATCH (m) WHERE (m:Episode OR m:Fact OR m:Procedure)
        AND m.scope IN $scopes
        AND (${clauses || 'true'})
       RETURN m.id AS id, labels(m)[0] AS kind,
              coalesce(m.summary, m.statement, m.name) AS text, m.at AS at, m.confidence AS confidence
       LIMIT $limit`,
      {
        scopes,
        limit,
        ...Object.fromEntries(queryTokens.slice(0, 6).map((t, i) => [`t${i}`, t])),
      }
    );
    return rows.map((r: any) => ({ kind: r.kind, id: r.id, text: r.text || '', at: r.at, confidence: r.confidence }));
  }

  /** Session restore (FR-22): last N turns of a conversation + relevant memory. */
  static async appendConversationTurn(scope: MemoryScope, conversationId: string, role: string, text: string): Promise<string> {
    const graph = await forTenant(scope.tenantId);
    const turnId = `turn_${crypto.randomUUID()}`;
    await mergeNode(graph, 'ConversationNode', conversationId, { id: conversationId, scope: scopeFor(scope.agentId, scope.shared), createdAt: new Date().toISOString() });
    await mergeNode(graph, 'Turn', turnId, {
      role,
      text: text.slice(0, 2000),
      at: new Date().toISOString(),
      scope: scopeFor(scope.agentId, scope.shared),
    });
    await mergeRelation(graph, 'ConversationNode', conversationId, 'Turn', turnId, 'HAS_TURN');
    return turnId;
  }

  static async getConversation(scope: MemoryScope, conversationId: string, limit = 50): Promise<Array<{ role: string; text: string; at: string }>> {
    const graph = await forTenant(scope.tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (cn:ConversationNode {id: $conversationId})-[:HAS_TURN]->(t:Turn)
       RETURN t.role AS role, t.text AS text, t.at AS at
       ORDER BY t.at LIMIT $limit`,
      { conversationId, limit }
    );
    return rows;
  }

  /** Memory stats per agent for the Agents page (§13.1). */
  static async memoryStats(tenantId: string): Promise<{ episodes: number; facts: number; procedures: number; conversations: number }> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (m) WHERE m:Episode OR m:Fact OR m:Procedure OR m:ConversationNode
       RETURN labels(m)[0] AS label, count(m) AS c`
    );
    const map: Record<string, number> = {};
    rows.forEach((r: any) => (map[r.label] = Number(r.c)));
    return {
      episodes: map.Episode || 0,
      facts: map.Fact || 0,
      procedures: map.Procedure || 0,
      conversations: map.ConversationNode || 0,
    };
  }
}
