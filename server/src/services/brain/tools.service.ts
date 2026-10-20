import crypto from 'crypto';
import { forTenant } from '../../graph/graph.client';
import { runQuery } from '../../graph/graph.queries';
import { normalizeName, isNodeLabel } from '../../graph/graph.schema';
import { FreshnessService } from './freshness.service';
import { PrecedentService } from './precedent.service';
import { InsightsService } from './insights.service';
import { assembleTrace } from './trace.service';

/**
 * GraphTools registry (FR-24) — graph queries/algorithms as agent tools.
 *
 * Algorithms note (FR-26): FalkorDB images vary in bundled algorithm libs, so
 * shortest path is implemented via Cypher shortestPath() and centrality via
 * degree-weighted counting in Cypher. This is stated honestly in tool
 * descriptions and the README.
 */
export class GraphToolsService {
  static async findOwner(tenantId: string, entity: string) {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (o:Person)-[:OWNS]->(p) WHERE p.name CONTAINS $entity OR p.policyName CONTAINS $entity
       OPTIONAL MATCH (p)-[:GOVERNS]->(s)
       OPTIONAL MATCH (p)-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(d:Document)
       RETURN o, p, collect(DISTINCT s) AS governed, collect(DISTINCT c.id) AS chunks, collect(DISTINCT d.title) AS documents LIMIT 10`,
      { entity }
    );
    const nodes: any[] = [];
    const edges: any[] = [];
    rows.forEach((r: any) => {
      if (r.o?.id && r.p?.id) {
        nodes.push({ id: r.o.id, label: 'Person', name: r.o.name }, { id: r.p.id, label: 'Policy', name: r.p.name ?? r.p.policyName });
        edges.push({ from: r.o.id, to: r.p.id, type: 'OWNS' });
      }
    });
    const trace = assembleTrace(nodes, edges, `MATCH (o:Person)-[:OWNS]->(p...) WHERE p.name CONTAINS $entity`);
    // An empty list is indistinguishable from "the tool broke" unless we say what
    // the graph searched and did not find, so the negative result is a first-class output.
    const absence = rows.length ? null : await PrecedentService.absence(tenantId, { relationship: 'OWNS', fromLabel: 'Person', term: entity });
    return { tool: 'find_owner', entity, results: rows, trace, absence, answer: absence?.statement };
  }

  /** Policies/rules governing a system or booking context (FR-14 step 2). */
  static async getPolicyFor(tenantId: string, context: string) {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (p:Policy)-[:GOVERNS|VALIDATES|REQUIRES]->(s) WHERE s.name CONTAINS $context OR p.category = $cat
       OPTIONAL MATCH (r:Rule)-[:IMPLEMENTS]->(p)
       WHERE p.status = 'ACTIVE'
       RETURN p.id AS policyId, p.name AS policyName, r.id AS ruleId, r.ruleName AS ruleName, s.name AS system
       LIMIT 15`,
      { context, cat: normalizeName(context).toUpperCase() }
    ).catch(async () => {
      // smaller engines: no OR in WHERE after RETURN path with UNION-less OPTIONAL
      return runQuery(
        graph,
        `MATCH (p:Policy)-[:GOVERNS]->(s) WHERE s.name CONTAINS $context
         OPTIONAL MATCH (r:Rule)-[:IMPLEMENTS]->(p)
         WHERE p.status = 'ACTIVE'
         RETURN p.id AS policyId, p.name AS policyName, r.id AS ruleId, r.ruleName AS ruleName, s.name AS system
         LIMIT 15`,
        { context }
      );
    });
    const nodes: any[] = [];
    const edges: any[] = [];
    rows.forEach((r: any) => {
      if (r.policyId) {
        nodes.push({ id: r.policyId, label: 'Policy', name: r.policyName });
        if (r.system) nodes.push({ id: `sys:${r.system}`, label: 'System', name: r.system });
      }
      if (r.ruleId) {
        nodes.push({ id: r.ruleId, label: 'Rule', name: r.ruleName });
        edges.push({ from: r.ruleId, to: r.policyId, type: 'IMPLEMENTS' });
      }
    });
    const trace = assembleTrace(nodes, edges, `MATCH (p:Policy)-[:GOVERNS]->(s) WHERE s.name CONTAINS $context / rules IMPLEMENTS`);
    const absence = rows.length ? null : await PrecedentService.absence(tenantId, { relationship: 'GOVERNS', fromLabel: 'Policy', term: context });
    return { tool: 'get_policy_for', context, results: rows, trace, absence, answer: absence?.statement };
  }

  /** Impact analysis of changing a policy (multi-hop). A Rule id also resolves. */
  static async impactOfChange(tenantId: string, policyId: string) {
    const graph = await forTenant(tenantId);
    const asRule = await runQuery(graph, `MATCH (r:Rule {id: $id})-[:IMPLEMENTS]->(p:Policy) RETURN p.id AS id LIMIT 1`, { id: policyId });
    const resolvedId = asRule[0]?.id || policyId;
    const impact = await FreshnessService.impactOfChange(tenantId, resolvedId);
    if (!impact) return null;
    const nodes = impact.rules.map((r: any) => ({ id: r.id, label: 'Rule', name: r.name }));
    const agents = impact.agents.map((a: any) => ({ id: a.id, label: 'Agent', name: a.name }));
    const trace = assembleTrace(
      [...nodes, ...agents, { id: resolvedId, label: 'Policy', name: impact.policy.name || impact.policy.policyName }],
      agents.map((a: any) => ({ from: a.id, to: resolvedId, type: 'IMPACTED_BY' })),
      `impact_of_change: rules IMPLEMENTS policy + agents PERFORMED tasks TRIGGERED rules`
    );
    return { tool: 'impact_of_change', policyId, ...impact, trace };
  }

  /** Expertise ranking ("who knows most about X") with evidence counts. */
  static async whoKnowsMost(tenantId: string, topic: string) {
    const graph = await forTenant(tenantId);
    // Weighted: explicit KNOWS_ABOUT edges + authored docs mentioning topic + decisions about policies
    const rows = await runQuery(
      graph,
      `MATCH (p:Person)-[k:KNOWS_ABOUT]->(x)
       WHERE toLower(x.name) CONTAINS $topic
       RETURN p.name AS person, p.id AS personId, count(x) AS evidence, sum(coalesce(k.weight, 1)) AS weight
       UNION
       MATCH (p2:Person)-[:AUTHORED|DECIDED]->(d)
       WHERE toLower(d.title) CONTAINS $topic
       RETURN p2.name AS person, p2.id AS personId, count(d) AS evidence, count(d) AS weight
       LIMIT 25`,
      { topic: topic.toLowerCase() }
    );
    const byPerson = new Map<string, { person: string; personId: string; evidence: number; weight: number }>();
    rows.forEach((r: any) => {
      const prev = byPerson.get(r.person)
      if (prev) {
        prev.evidence += Number(r.evidence || 0);
        prev.weight += Number(r.weight || 0);
      } else {
        byPerson.set(r.person, { person: r.person, personId: r.personId ?? '', evidence: Number(r.evidence || 0), weight: Number(r.weight || 0) });
      }
    });
    const ranked = [...byPerson.values()].sort((a, b) => b.weight - a.weight).slice(0, 5);
    const nodes: any[] = [];
    const edges: any[] = [];
    ranked.forEach((r) => {
      if (r.personId) {
        nodes.push({ id: r.personId, label: 'Person', name: r.person });
        edges.push({ from: r.personId, to: `topic:${topic}`, type: 'KNOWS_ABOUT' });
      }
    });
    const trace = assembleTrace(nodes, edges, `people KNOWS_ABOUT / AUTHORED / DECIDED matching $topic, weighted score`);
    return { tool: 'who_knows_most', topic, ranking: ranked, trace };
  }

  /**
   * Shortest relationship path between two entities. Delegates to the same
   * directed `shortestPath()` helper the /brain/path endpoint uses: FalkorDB
   * only accepts shortestPath inside WITH/RETURN and only for directed
   * traversals, so the old `MATCH path = shortestPath((a)-[*..5]-(b))` form
   * errored on every call.
   */
  static async shortestPath(tenantId: string, fromName: string, toName: string) {
    const path = await InsightsService.connectionPath(tenantId, fromName, toName, 5);
    const nodes = path.nodes.map((n) => ({ id: n.id, label: n.label, name: n.name }));
    const edges = path.edges.map((type, i) => ({ from: path.nodes[i].id, to: path.nodes[i + 1].id, type }));
    return {
      tool: 'shortest_path',
      from: fromName,
      to: toName,
      path,
      results: path.connected ? path.nodes : [],
      statement: path.statement,
      trace: assembleTrace(
        nodes,
        edges,
        'MATCH (a),(b) WITH a, b, shortestPath((a)-[*..5]->(b)) AS p — directed only, both orientations tried'
      ),
    };
  }

  /** Degree-based centrality over a set of labels (honest degree centrality). */
  static async centralEntities(tenantId: string, labels: string[] = ['System', 'Policy', 'Person']) {
    const graph = await forTenant(tenantId);
    // Labels reach Cypher as identifiers (not parameters), so they are allow-list
    // validated — request bodies and MCP arguments must never shape the query text.
    const allowed = labels.filter(isNodeLabel);
    if (allowed.length !== labels.length) {
      throw new Error(`label(s) ${labels.filter((l) => !isNodeLabel(l)).join(', ')} are not in the schema allow-list`);
    }
    const labelList = allowed.map((l) => `n:${l}`).join(' OR ');
    try {
      const rows = await runQuery(
        graph,
        `MATCH (n) WHERE (${labelList})
         OPTIONAL MATCH (n)-[r]-()
         RETURN n.id AS id, n.name AS name, labels(n)[0] AS label, count(r) AS degree
         ORDER BY degree DESC LIMIT 10`,
        {}
      );
      return { tool: 'central_entities', labels, results: rows, note: 'Degree centrality (Cypher); FalkorDB algo library not assumed.', trace: assembleTrace([], [], 'MATCH (n)-[r]-() count by degree') };
    } catch {
      return { tool: 'central_entities', labels, results: [], note: 'No data for centrality yet', trace: assembleTrace([], [], 'centrality') };
    }
  }

  /** Recent decisions about an entity with provenance. */
  static async recentDecisions(tenantId: string, entity: string) {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (d:Decision) WHERE toLower(d.summary) CONTAINS $entity
       OPTIONAL MATCH (who:Person)-[:DECIDED]->(d)
       OPTIONAL MATCH (d)-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(doc:Document)
       RETURN d.id AS decisionId, d.summary AS summary, d.at AS at,
              who.name AS person, collect(DISTINCT doc.title) AS sourceDocuments
       ORDER BY d.at DESC LIMIT 10`,
      { entity: entity.toLowerCase() }
    );
    const nodes: any[] = [];
    const edges: any[] = [];
    rows.forEach((r: any) => {
      if (r.decisionId) {
        nodes.push({ id: r.decisionId, label: 'Decision', name: r.summary });
        if (r.person) nodes.push({ id: `person:${r.person}`, label: 'Person', name: r.person });
        if (r.person) edges.push({ from: `person:${r.person}`, to: r.decisionId, type: 'DECIDED' });
      }
    });
    return { tool: 'recent_decisions', entity, results: rows, trace: assembleTrace(nodes, edges, 'Person DECIDED Decision') };
  }
}
