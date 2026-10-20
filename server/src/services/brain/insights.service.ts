import { forTenant } from '../../graph/graph.client';
import { runQuery, nodeProps, findEntityNodesByName, rankLinkedNodes } from '../../graph/graph.queries';
import { NODE_LABELS } from '../../graph/graph.schema';

/**
 * InsightsService — six read-only views that answer questions the vector store
 * structurally cannot: how two things are connected, what a rule looked like
 * before, everything that happened to one subject over time, who handed work to
 * whom, what one node actually means, and what went stale recently.
 *
 * Every statement here is parameterised: user text reaches Cypher only through
 * `$params`, never as part of the query string. The one interpolated value is
 * the variable-length hop bound, which is clamped to an integer first (the same
 * pattern `graph.service.ts` uses for `focus`/`depth`).
 */

export interface EntityRef {
  id: string;
  label: string;
  name: string;
}

export interface ConnectionPathResult {
  from: EntityRef | null;
  to: EntityRef | null;
  fromCandidates: number;
  toCandidates: number;
  maxHops: number;
  connected: boolean;
  /** FalkorDB shortestPath is directed: which way the traversal actually worked. */
  direction: 'forward' | 'reverse' | null;
  hops: number;
  nodes: EntityRef[];
  edges: string[];
  /** Endpoint degrees — proves the nodes exist even when they are not connected. */
  degrees: { from: number; to: number };
  statement: string;
}

export interface RuleVersionDiffResult {
  ruleName: string;
  requestedId: string;
  versions: Array<{
    id: string;
    version: number;
    status: string;
    params: Record<string, any>;
    validTo: string | null;
    supersedes: string[];
    fromSimulation: { id: string; at: string | null; candidateParams: Record<string, any>; status: string } | null;
  }>;
  diffs: Array<{
    fromId: string;
    toId: string;
    fromVersion: number;
    toVersion: number;
    added: Array<{ key: string; value: unknown }>;
    removed: Array<{ key: string; value: unknown }>;
    changed: Array<{ key: string; before: unknown; after: unknown }>;
    unchanged: Array<{ key: string; value: unknown }>;
  }>;
  edges: Array<{ from: string; to: string }>;
  statement: string;
}

export interface TimelineEvent {
  at: string | null;
  kind: 'DECISION' | 'RULE_VERSION' | 'LEDGER';
  title: string;
  actor: string | null;
  outcome: string | null;
  subjectId: string | null;
  detail: string;
  demoSeed: string | null;
}

export interface HandoffBoardResult {
  agents: Array<{
    id: string;
    name: string;
    type: string | null;
    tasks: number;
    memories: number;
    handedIn: number;
    handedOut: number;
  }>;
  handoffs: Array<{
    taskId: string | null;
    title: string | null;
    status: string | null;
    at: string | null;
    demoSeed: string | null;
    fromId: string | null;
    fromName: string | null;
    toId: string;
    toName: string;
    toType: string | null;
    ruleName: string | null;
    ruleVersion: string | null;
    directAgentToAgent: boolean;
  }>;
  statement: string;
}

export interface NodeExplanation {
  node: { id: string; label: string; name: string; properties: Record<string, any> };
  neighbours: Array<{ relation: string; direction: 'out' | 'in'; node: EntityRef }>;
  owningSop: Array<{ policyId: string; policyName: string; status: string | null; rules: Array<{ id: string; ruleName: string; version: string | null; status: string | null }> }>;
  provenance: Array<{ chunkId: string; text: string; documentId: string; documentTitle: string }>;
  decisions: Array<{ id: string; summary: string; outcome: string | null; at: string | null; decidedBy: string | null }>;
  feedback: { up: number; down: number };
  statement: string;
}

export interface FreshnessDigestResult {
  generatedAt: string;
  windowDays: number;
  cutoff: string;
  events: Array<{ at: string | null; kind: string; title: string; detail: string; subjectId: string | null }>;
  counts: {
    supersededDocuments: number;
    supersededRules: number;
    staleRules: number;
    pendingReviewPolicies: number;
    decisionsInWindow: number;
    citedThumbsDown: number;
  };
  statement: string;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

/**
 * FalkorDB evaluates shortestPath only as a WITH/RETURN expression and only over
 * directed traversals, so the hop bound is interpolated (clamped int) and the
 * direction is chosen by the caller.
 */
async function directedShortest(graph: any, fromId: string, toId: string, depth: number): Promise<any[]> {
  return runQuery(
    graph,
    `MATCH (a {id: $fromId}), (b {id: $toId})
     WITH a, b, shortestPath((a)-[*..${depth}]->(b)) AS p
     WHERE p IS NOT NULL
     RETURN [x IN nodes(p) | coalesce(x.id, '')] AS ids,
            [x IN nodes(p) | labels(x)[0]] AS labels,
            [x IN nodes(p) | coalesce(x.name, x.title, x.ruleName, x.policyName, x.summary, x.statement, x.id, '')] AS names,
            [r IN relationships(p) | type(r)] AS rels
     LIMIT 1`,
    { fromId, toId }
  );
}

export class InsightsService {
  /**
   * "How are X and Y connected?" — entity linking then Cypher `shortestPath()`.
   * Endpoints are resolved to concrete node ids first, so the path query is
   * bound by id and cannot fan out over the whole graph.
   */
  static async connectionPath(tenantId: string, fromText: string, toText: string, maxHops = 5): Promise<ConnectionPathResult> {
    const graph = await forTenant(tenantId);
    const labels = [...NODE_LABELS];
    const depth = clampInt(maxHops, 1, 6, 5);

    const fromRows = rankLinkedNodes(await findEntityNodesByName(graph, labels, fromText), fromText);
    let toRows = rankLinkedNodes(await findEntityNodesByName(graph, labels, toText), toText);
    const a = fromRows[0] ?? null;
    if (a) toRows = toRows.filter((r: any) => r.id !== a.id);
    const b = toRows[0] ?? null;

    const base: ConnectionPathResult = {
      from: a ? { id: a.id, label: a.label, name: a.name } : null,
      to: b ? { id: b.id, label: b.label, name: b.name } : null,
      fromCandidates: fromRows.length,
      toCandidates: toRows.length + (a ? 1 : 0),
      maxHops: depth,
      connected: false,
      direction: null,
      hops: 0,
      nodes: [],
      edges: [],
      degrees: { from: 0, to: 0 },
      statement: '',
    };

    if (!a || !b) {
      const missing = !a && !b ? `"${fromText}" and "${toText}"` : !a ? `"${fromText}"` : `"${toText}"`;
      return { ...base, statement: `No node in this tenant graph matches ${missing}. The search flattens punctuation and ignores stopwords, so this is a real absence, not a formatting miss.` };
    }

    const forward = await directedShortest(graph, a.id, b.id, depth);
    const found = forward.length ? { rows: forward, direction: 'forward' as const } : { rows: await directedShortest(graph, b.id, a.id, depth), direction: 'reverse' as const };
    const degrees = await InsightsService.endpointDegrees(graph, a.id, b.id);
    const row = found.rows[0];

    if (!row) {
      return {
        ...base,
        degrees,
        statement: `No directed path of ≤ ${depth} hops connects "${a.name}" (${a.label}) and "${b.name}" (${b.label}) in either direction. Both nodes exist — ${degrees.from} and ${degrees.to} incident edge(s). FalkorDB only evaluates shortestPath over directed traversals, so an undirected "connected at any cost" answer is not available here; this is stated in docs/graph-data-model.md.`,
      };
    }

    // Always present the chain from → to, so a reverse traversal is flipped back.
    const ids: string[] = row.ids || [];
    const nodeLabels: string[] = row.labels || [];
    const names: string[] = row.names || [];
    const rels: string[] = (row.rels || []).map(String);
    const flip = found.direction === 'reverse';
    const nodes: EntityRef[] = (flip ? [...ids].reverse() : ids).map((id, i) => ({
      id,
      label: (flip ? [...nodeLabels].reverse() : nodeLabels)[i] || '',
      name: (flip ? [...names].reverse() : names)[i] || id,
    }));
    const edges: string[] = flip ? [...rels].reverse() : rels;

    return {
      ...base,
      degrees,
      connected: true,
      direction: found.direction,
      hops: edges.length,
      nodes,
      edges,
      statement: `${a.name} → ${b.name} in ${edges.length} hop(s): ${nodes.map((n) => n.name).join(' → ')}. ${
        found.direction === 'forward'
          ? `Directed path found from "${a.name}" toward "${b.name}" (≤ ${depth} hops).`
          : `Only reachable in the opposite direction: the graph links "${b.name}" → "${a.name}", shown here reversed. FalkorDB shortestPath is directed, so this is the honest shape of the data, not a symmetric lookup.`
      }`,
    };
  }

  private static async endpointDegrees(graph: any, fromId: string, toId: string): Promise<{ from: number; to: number }> {
    const rows = await runQuery(
      graph,
      `MATCH (a {id: $fromId}) OPTIONAL MATCH (a)-[r1]-()
       WITH count(r1) AS fromDeg
       MATCH (b {id: $toId}) OPTIONAL MATCH (b)-[r2]-()
       RETURN fromDeg, count(r2) AS toDeg`,
      { fromId, toId }
    );
    return { from: Number(rows[0]?.fromDeg ?? 0), to: Number(rows[0]?.toDeg ?? 0) };
  }

  /**
   * Rule version diff. The Time Machine already writes `<rule>_v2` plus a
   * `SUPERSEDES` edge and the originating Simulation — this renders the
   * parameter-level difference instead of asking the reader to diff JSON.
   */
  static async ruleVersionDiff(tenantId: string, ruleId: string): Promise<RuleVersionDiffResult | null> {
    const graph = await forTenant(tenantId);
    const head = await runQuery(graph, `MATCH (r:Rule {id: $ruleId}) RETURN r LIMIT 1`, { ruleId });
    if (!head.length) return null;
    const ruleName = String(nodeProps(head[0].r).ruleName || ruleId);

    const memberRows = await runQuery(
      graph,
      `MATCH (r:Rule) WHERE r.ruleName = $ruleName
       OPTIONAL MATCH (r)-[:SUPERSEDES]->(old:Rule)
       WITH r, collect(old.id) AS supersedes
       RETURN r.id AS id, r.version AS version, r.status AS status,
              r.parametersJSON AS params, r.validTo AS validTo, supersedes`,
      { ruleName }
    );

    const simRows = await runQuery(
      graph,
      `MATCH (s:Simulation)-[:ON]->(r:Rule) WHERE r.ruleName = $ruleName
       RETURN s.id AS id, r.id AS ruleId, s.at AS at, s.status AS status, s.candidateParams AS candidateParams`,
      { ruleName }
    );

    const edgeRows = await runQuery(
      graph,
      `MATCH (n:Rule)-[:SUPERSEDES]->(o:Rule) WHERE n.ruleName = $ruleName OR o.ruleName = $ruleName
       RETURN n.id AS fromId, o.id AS toId`,
      { ruleName }
    );

    const versions = memberRows
      .map((r: any) => {
        let params: Record<string, any> = {};
        try {
          params = r.params ? JSON.parse(r.params) : {};
        } catch {
          params = {};
        }
        const sim = simRows.find((s: any) => s.ruleId === r.id);
        return {
          id: String(r.id),
          version: Number(r.version ?? 1),
          status: String(r.status ?? 'ACTIVE'),
          params,
          validTo: r.validTo ?? null,
          supersedes: (r.supersedes || []).filter(Boolean),
          fromSimulation: sim
            ? {
                id: String(sim.id),
                at: sim.at ?? null,
                status: String(sim.status ?? ''),
                candidateParams: (() => {
                  try {
                    return JSON.parse(sim.candidateParams || '{}');
                  } catch {
                    return {};
                  }
                })(),
              }
            : null,
        };
      });

    const diffs: RuleVersionDiffResult['diffs'] = [];
    // Chronological order. `version` alone is not enough: the demo seed stores
    // the same number on both rule nodes, so a node that supersedes another is
    // treated as the newer one, and the id breaks any remaining tie deterministically.
    const newerBySupersession = new Set(edgeRows.map((r: any) => String(r.fromId)));
    const orderKey = (v: { version: number; id: string }) =>
      `${String(v.version).padStart(6, '0')}|${newerBySupersession.has(v.id) ? 1 : 0}|${v.id}`;
    versions.sort((x, y) => orderKey(x).localeCompare(orderKey(y)));
    versions.forEach((v, i) => {
      if (i === 0) return;
      const before = versions[i - 1];
      const keys = [...new Set([...Object.keys(before.params), ...Object.keys(v.params)])];
      diffs.push({
        fromId: before.id,
        toId: v.id,
        fromVersion: before.version,
        toVersion: v.version,
        added: keys.filter((k) => !(k in before.params) && k in v.params).map((k) => ({ key: k, value: v.params[k] })),
        removed: keys.filter((k) => k in before.params && !(k in v.params)).map((k) => ({ key: k, value: before.params[k] })),
        changed: keys
          .filter((k) => k in before.params && k in v.params && JSON.stringify(before.params[k]) !== JSON.stringify(v.params[k]))
          .map((k) => ({ key: k, before: before.params[k], after: v.params[k] })),
        unchanged: keys.filter((k) => k in before.params && k in v.params && JSON.stringify(before.params[k]) === JSON.stringify(v.params[k])).map((k) => ({ key: k, value: before.params[k] })),
      });
    });

    const applied = versions.filter((v) => v.fromSimulation?.status === 'APPLIED');
    // A Time Machine apply bumps `version`; the demo seed stored the same number
    // on both nodes and distinguished them by id, so fall back to the ids
    // instead of printing a misleading "v1→v1".
    const verLabel = (d: { fromVersion: number; toVersion: number; fromId: string; toId: string }) =>
      String(d.fromVersion) === String(d.toVersion) ? `${d.fromId} → ${d.toId}` : `v${d.fromVersion}→v${d.toVersion}`;
    return {
      ruleName,
      requestedId: ruleId,
      versions,
      diffs,
      edges: edgeRows.map((r: any) => ({ from: String(r.fromId), to: String(r.toId) })),
      statement: versions.length
        ? `${versions.length} version(s) of "${ruleName}" in the graph; ${applied.length} came from an applied Policy Time Machine simulation. ${
            diffs.length
              ? `Parameter changes: ${diffs
                  .map((d) => `${verLabel(d)} (${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed)`)
                  .join('; ')}.`
              : 'Parameters identical across versions.'
          }`
        : `No rule named "${ruleName}" found in the tenant graph.`,
    };
  }

  /**
   * Decision timeline for one subject: every Decision that names it or is ABOUT
   * it, every rule version that changed under it, every ledger entry that
   * recorded it. Chronological, straight from the graph — nothing synthesized.
   */
  static async decisionTimeline(tenantId: string, term: string, limit = 40): Promise<{ events: TimelineEvent[]; matched: Record<string, number>; statement: string }> {
    const graph = await forTenant(tenantId);
    const needle = String(term || '').trim().toLowerCase();
    const cap = clampInt(limit, 1, 200, 40);
    if (!needle) return { events: [], matched: {}, statement: 'No subject supplied.' };

    const decisionRows = await runQuery(
      graph,
      `MATCH (d:Decision)
       OPTIONAL MATCH (who:Person)-[:DECIDED]->(d)
       OPTIONAL MATCH (d)-[:ABOUT]->(subj)
       WITH d, who, [x IN collect(subj) | coalesce(x.name, x.summary, x.kind, x.id, '')] AS subjects
       WHERE toLower(coalesce(d.summary, '')) CONTAINS $needle OR any(s IN subjects WHERE toLower(s) CONTAINS $needle)
       RETURN d.id AS id, d.summary AS summary, d.outcome AS outcome, d.at AS at, d.demoSeed AS demoSeed,
              who.name AS actor, subjects AS subjects
       LIMIT $cap`,
      { needle, cap }
    );

    const ruleRows = await runQuery(
      graph,
      `MATCH (n:Rule)-[:SUPERSEDES]->(o:Rule)
       WHERE toLower(coalesce(n.ruleName, '')) CONTAINS $needle OR toLower(coalesce(o.ruleName, '')) CONTAINS $needle
       OPTIONAL MATCH (sim:Simulation)-[:ON]->(n)
       RETURN n.id AS newId, o.id AS oldId, n.ruleName AS ruleName, n.version AS version, o.version AS oldVersion,
              o.validTo AS validTo, sim.id AS simId, sim.at AS at, sim.status AS simStatus
       LIMIT $cap`,
      { needle, cap }
    );

    const ledgerRows = await runQuery(
      graph,
      `MATCH (l:LedgerEntry)
       WHERE toLower(coalesce(l.subjectId, '')) CONTAINS $needle OR toLower(coalesce(l.kind, '')) CONTAINS $needle
       RETURN l.seq AS seq, l.at AS at, l.actor AS actor, l.kind AS kind, l.subjectId AS subjectId
       ORDER BY toInteger(l.seq) DESC LIMIT $cap`,
      { needle, cap }
    );

    const events: TimelineEvent[] = [
      ...decisionRows.map((r: any) => ({
        at: r.at ?? null,
        kind: 'DECISION' as const,
        title: String(r.summary ?? ''),
        actor: r.actor ?? null,
        outcome: r.outcome ?? null,
        subjectId: r.id ?? null,
        detail: (r.subjects || []).filter(Boolean).slice(0, 3).join(', '),
        demoSeed: r.demoSeed ?? null,
      })),
      ...ruleRows.map((r: any) => ({
        at: r.at ?? r.validTo ?? null,
        kind: 'RULE_VERSION' as const,
        title: `${r.ruleName} moved from v${r.oldVersion ?? '?'} to v${r.version ?? '?'}`,
        actor: r.simStatus === 'APPLIED' ? 'applied from a simulation' : null,
        outcome: r.simStatus ?? null,
        subjectId: r.newId ?? null,
        detail: `supersedes ${r.oldId}${r.simId ? ` via ${r.simId}` : ''}`,
        demoSeed: null,
      })),
      ...ledgerRows.map((r: any) => ({
        at: r.at ?? null,
        kind: 'LEDGER' as const,
        title: String(r.kind ?? ''),
        actor: r.actor ?? null,
        outcome: null,
        subjectId: r.subjectId ?? null,
        detail: `ledger seq ${r.seq}`,
        demoSeed: null,
      })),
    ];

    events.sort((x, y) => String(y.at ?? '').localeCompare(String(x.at ?? '')));

    return {
      events,
      matched: {
        decisions: decisionRows.length,
        ruleVersions: ruleRows.length,
        ledgerEntries: ledgerRows.length,
      },
      statement: events.length
        ? `${events.length} event(s) in the graph for "${term}": ${decisionRows.length} decision(s), ${ruleRows.length} rule version change(s), ${ledgerRows.length} ledger entry(ies), newest first.`
        : `Nothing in the graph for "${term}" — 0 decisions, 0 rule versions and 0 ledger entries mention it. Absence reported rather than hidden.`,
    };
  }

  /**
   * Cross-agent handoff board. `HANDED_OFF_TO` already exists in the schema and
   * is written by agent-workflows (email triage → freight/finance) and by the
   * demo seed; this is the view over those edges, not a new data structure.
   */
  static async handoffBoard(tenantId: string): Promise<HandoffBoardResult> {
    const graph = await forTenant(tenantId);

    const agentRows = await runQuery(
      graph,
      `MATCH (a:Agent)
       OPTIONAL MATCH (a)-[:PERFORMED]->(t:Task)
       OPTIONAL MATCH (a)-[:REMEMBERS]->(m)
       RETURN a.id AS id, a.name AS name, a.type AS type,
              count(DISTINCT t) AS tasks, count(DISTINCT m) AS memories
       ORDER BY tasks DESC LIMIT 40`,
      {}
    );

    const taskHandoffs = await runQuery(
      graph,
      `MATCH (t:Task)-[:HANDED_OFF_TO]->(a:Agent)
       OPTIONAL MATCH (src:Agent)-[:PERFORMED]->(t)
       OPTIONAL MATCH (t)-[:TRIGGERED]->(r:Rule)
       RETURN t.id AS taskId, coalesce(t.summary, t.kind, t.id) AS title, t.status AS status,
              t.createdAt AS at, coalesce(t.demoSeed, 'false') AS demoSeed,
              src.id AS fromId, src.name AS fromName,
              a.id AS toId, a.name AS toName, a.type AS toType,
              r.ruleName AS ruleName, r.version AS ruleVersion
       LIMIT 100`,
      {}
    );

    const agentHandoffs = await runQuery(
      graph,
      `MATCH (x:Agent)-[:HANDED_OFF_TO]->(y:Agent)
       RETURN x.id AS fromId, x.name AS fromName, y.id AS toId, y.name AS toName, y.type AS toType
       LIMIT 100`,
      {}
    );

    const handoffs: HandoffBoardResult['handoffs'] = [
      ...taskHandoffs.map((r: any) => ({
        taskId: r.taskId ?? null,
        title: r.title ?? null,
        status: r.status ?? null,
        at: r.at ?? null,
        demoSeed: r.demoSeed ?? 'false',
        fromId: r.fromId ?? null,
        fromName: r.fromName ?? null,
        toId: String(r.toId),
        toName: String(r.toName ?? r.toId),
        toType: r.toType ?? null,
        ruleName: r.ruleName ?? null,
        ruleVersion: r.ruleVersion ?? null,
        directAgentToAgent: false,
      })),
      ...agentHandoffs.map((r: any) => ({
        taskId: null,
        title: 'direct agent-to-agent handoff',
        status: null,
        at: null,
        demoSeed: 'false',
        fromId: r.fromId ?? null,
        fromName: r.fromName ?? null,
        toId: String(r.toId),
        toName: String(r.toName ?? r.toId),
        toType: r.toType ?? null,
        ruleName: null,
        ruleVersion: null,
        directAgentToAgent: true,
      })),
    ];

    const agents = agentRows.map((r: any) => ({
      id: String(r.id),
      name: String(r.name ?? r.id),
      type: r.type ?? null,
      tasks: Number(r.tasks ?? 0),
      memories: Number(r.memories ?? 0),
      handedIn: handoffs.filter((h) => h.toId === String(r.id)).length,
      handedOut: handoffs.filter((h) => h.fromId === String(r.id)).length,
    }));

    return {
      agents,
      handoffs,
      statement: handoffs.length
        ? `${handoffs.length} HANDED_OFF_TO edge(s) across ${agents.length} agent(s). Each row is an edge in this tenant's graph, not a row in a queue table.`
        : `${agents.length} agent(s) exist in the graph but no HANDED_OFF_TO edge is recorded yet. Run an agent workflow (Freight Desk) to create one.`,
    };
  }

  /**
   * "Explain this node" — one drill-down assembled from the node, its typed
   * neighbourhood, the SOP that governs it, its document provenance, the
   * decisions that touched it and the feedback its citations earned.
   */
  static async explainNode(tenantId: string, nodeId: string): Promise<NodeExplanation | null> {
    const graph = await forTenant(tenantId);
    const head = await runQuery(graph, `MATCH (n {id: $nodeId}) RETURN n, labels(n)[0] AS label LIMIT 1`, { nodeId });
    if (!head.length) return null;
    const props = nodeProps(head[0].n);
    const label = String(head[0].label || inferLabelFromProps(props));
    const name = String(props.name || props.title || props.ruleName || props.policyName || props.summary || props.statement || props.id || nodeId);

    const neighbourRows = await runQuery(
      graph,
      `MATCH (n {id: $nodeId})-[r]-(m)
       RETURN type(r) AS relation, (startNode(r).id = n.id) AS outgoing, m.id AS id, labels(m)[0] AS label,
              coalesce(m.name, m.title, m.ruleName, m.policyName, m.summary, m.statement, m.id) AS name
       ORDER BY relation LIMIT 80`,
      { nodeId }
    );

    const sopRows = await runQuery(
      graph,
      `MATCH (p:Policy)-[:GOVERNS|VALIDATES|REQUIRES]->(n {id: $nodeId})
       RETURN DISTINCT p.id AS policyId, p.name AS policyName, p.status AS status
       LIMIT 15`,
      { nodeId }
    );
    const implementedRows = await runQuery(
      graph,
      `MATCH (r:Rule)-[:IMPLEMENTS]->(p:Policy {id: $nodeId})
       RETURN r.id AS id, r.ruleName AS ruleName, r.version AS version, r.status AS status LIMIT 25`,
      { nodeId }
    );
    const ownRules = await runQuery(
      graph,
      `MATCH (o:Person)-[:OWNS]->(n {id: $nodeId}) RETURN o.id AS id, o.name AS name LIMIT 10`,
      { nodeId }
    );

    const policyIds = sopRows.map((r: any) => String(r.policyId));
    const rulesByPolicy: Record<string, any[]> = {};
    for (const pid of policyIds) {
      const rows = await runQuery(
        graph,
        `MATCH (r:Rule)-[:IMPLEMENTS]->(p:Policy {id: $pid})
         RETURN r.id AS id, r.ruleName AS ruleName, r.version AS version, r.status AS status LIMIT 15`,
        { pid }
      );
      rulesByPolicy[pid] = rows;
    }

    const provRows = await runQuery(
      graph,
      `MATCH (n {id: $nodeId})-[:DERIVED_FROM]->(c:Chunk)-[:PART_OF]->(d:Document)
       RETURN c.id AS chunkId, c.text AS text, d.id AS documentId, d.title AS documentTitle LIMIT 10`,
      { nodeId }
    );

    const decisionRows = await runQuery(
      graph,
      `MATCH (d:Decision)
       OPTIONAL MATCH (d)-[:ABOUT]->(subj)
       WITH d, collect(subj) AS subjects
       WHERE toLower(coalesce(d.summary, '')) CONTAINS toLower($name) OR any(s IN subjects WHERE s IS NOT NULL AND s.id = $nodeId)
       OPTIONAL MATCH (who:Person)-[:DECIDED]->(d)
       RETURN d.id AS id, d.summary AS summary, d.outcome AS outcome, d.at AS at, who.name AS decidedBy
       ORDER BY d.at DESC LIMIT 15`,
      { nodeId, name }
    );

    const feedbackRows = await runQuery(
      graph,
      `MATCH (f:Feedback)-[:ABOUT]->(n {id: $nodeId})
       RETURN sum(CASE WHEN f.verdict = 'UP' THEN 1 ELSE 0 END) AS up,
              sum(CASE WHEN f.verdict = 'DOWN' THEN 1 ELSE 0 END) AS down`,
      { nodeId }
    );

    const up = Number(feedbackRows[0]?.up ?? 0);
    const down = Number(feedbackRows[0]?.down ?? 0);

    const owners = ownRules.map((r: any) => r.name).filter(Boolean);
    const statement = `${label} "${name}" has ${neighbourRows.length} neighbour(s) across ${
      new Set(neighbourRows.map((r: any) => String(r.relation))).size
    } relationship type(s); ${sopRows.length} governing policy(ies), ${implementedRows.length} rule(s) implementing it (as the node itself), ${provRows.length} source chunk(s), ${decisionRows.length} decision(s) mentioning it${owners.length ? `, owned by ${owners.join(', ')}` : ', no OWNS edge recorded'}${up || down ? `, answer feedback on this node: ${up} up / ${down} down` : ''}.`;

    return {
      node: { id: nodeId, label, name, properties: props },
      neighbours: neighbourRows.map((r: any) => ({
        relation: String(r.relation),
        direction: r.outgoing ? ('out' as const) : ('in' as const),
        node: { id: String(r.id), label: String(r.label || ''), name: String(r.name ?? r.id) },
      })),
      owningSop: [
        ...sopRows.map((r: any) => ({
          policyId: String(r.policyId),
          policyName: String(r.policyName ?? r.policyId),
          status: r.status ?? null,
          rules: (rulesByPolicy[String(r.policyId)] || []).map((x: any) => ({
            id: String(x.id),
            ruleName: String(x.ruleName ?? x.id),
            version: x.version ?? null,
            status: x.status ?? null,
          })),
        })),
        ...(implementedRows.length || ownRules.length
          ? [
              {
                policyId: nodeId,
                policyName: ownRules.length ? `Owner: ${ownRules.map((r: any) => r.name).join(', ')}` : 'Rules implementing this node',
                status: null,
                rules: implementedRows.map((r: any) => ({
                  id: String(r.id),
                  ruleName: String(r.ruleName ?? r.id),
                  version: r.version ?? null,
                  status: r.status ?? null,
                })),
              },
            ]
          : []),
      ],
      provenance: provRows.map((r: any) => ({ chunkId: String(r.chunkId), text: String(r.text ?? ''), documentId: String(r.documentId), documentTitle: String(r.documentTitle ?? '') })),
      decisions: decisionRows.map((r: any) => ({ id: String(r.id), summary: String(r.summary ?? ''), outcome: r.outcome ?? null, at: r.at ?? null, decidedBy: r.decidedBy ?? null })),
      feedback: { up, down },
      statement,
    };
  }

  /**
   * Freshness digest — "what changed recently", aggregated from the version and
   * staleness edges the ingestion and Time Machine paths already write, plus the
   * negative answer feedback new sources earn.
   */
  static async freshnessDigest(tenantId: string, windowDays = 30): Promise<FreshnessDigestResult> {
    const graph = await forTenant(tenantId);
    const days = clampInt(windowDays, 1, 365, 30);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const generatedAt = new Date().toISOString();

    const docRows = await runQuery(
      graph,
      `MATCH (n:Document)-[:SUPERSEDES]->(o:Document)
       RETURN n.id AS newId, n.title AS title, o.id AS oldId, o.validTo AS supersededAt
       ORDER BY supersededAt DESC LIMIT 50`,
      {}
    );
    const ruleRows = await runQuery(
      graph,
      `MATCH (n:Rule)-[:SUPERSEDES]->(o:Rule)
       OPTIONAL MATCH (sim:Simulation)-[:ON]->(n)
       RETURN n.id AS newId, n.ruleName AS title, n.version AS version, o.id AS oldId, o.version AS oldVersion,
              o.validTo AS supersededAt, sim.at AS at
       LIMIT 50`,
      {}
    );
    const staleRows = await runQuery(graph, `MATCH (r:Rule {status: 'STALE'}) RETURN r.id AS id, r.ruleName AS title, r.staleReason AS reason LIMIT 50`, {});
    const pendingRows = await runQuery(
      graph,
      `MATCH (p:Policy {status: 'REVIEW_PENDING'}) RETURN p.id AS id, p.name AS title, p.category AS category LIMIT 50`,
      {}
    );
    const decisionCount = await runQuery(graph, `MATCH (d:Decision) WHERE d.at >= $cutoff RETURN count(d) AS c`, { cutoff });
    const feedbackCount = await runQuery(graph, `MATCH (f:Feedback {verdict: 'DOWN'}) RETURN count(f) AS c`, {});

    const events: FreshnessDigestResult['events'] = [
      ...docRows.map((r: any) => ({
        at: r.supersededAt ?? null,
        kind: 'DOCUMENT_SUPERSEDED',
        title: String(r.title ?? r.newId),
        detail: `replaced an earlier version of itself (${r.oldId}); the old version keeps its SUPERSEDES edge instead of being deleted`,
        subjectId: String(r.newId),
      })),
      ...ruleRows.map((r: any) => {
        const sameVersion = String(r.version ?? '') === String(r.oldVersion ?? '');
        return {
          at: r.at ?? r.supersededAt ?? null,
          kind: 'RULE_SUPERSEDED',
          title: sameVersion
            ? String(r.title ?? r.newId)
            : `${r.title} v${r.oldVersion ?? '?'} → v${r.version ?? '?'}`,
          detail: sameVersion
            ? `previous version ${r.oldId} is SUPERSEDED, not deleted, so history still answers "what was the rule last month" (both nodes carry version ${r.version}; the demo seed distinguished them by node id, and Time Machine applies bump the version number)`
            : `previous version ${r.oldId} is SUPERSEDED, not deleted, so history still answers "what was the rule last month"`,
          subjectId: String(r.newId),
        };
      }),
      ...staleRows.map((r: any) => ({
        at: null,
        kind: 'RULE_STALE',
        title: String(r.title ?? r.id),
        detail: String(r.reason ?? 'flagged STALE because a source document changed'),
        subjectId: String(r.id),
      })),
      ...pendingRows.map((r: any) => ({
        at: null,
        kind: 'POLICY_REVIEW_PENDING',
        title: String(r.title ?? r.id),
        detail: `policy awaiting human review (${r.category ?? 'uncategorised'})`,
        subjectId: String(r.id),
      })),
    ];

    const counts = {
      supersededDocuments: docRows.length,
      supersededRules: ruleRows.length,
      staleRules: staleRows.length,
      pendingReviewPolicies: pendingRows.length,
      decisionsInWindow: Number(decisionCount[0]?.c ?? 0),
      citedThumbsDown: Number(feedbackCount[0]?.c ?? 0),
    };
    const total = docRows.length + ruleRows.length + staleRows.length + pendingRows.length;

    return {
      generatedAt,
      windowDays: days,
      cutoff,
      events,
      counts,
      statement: total
        ? `${total} freshness event(s): ${counts.supersededDocuments} superseded document version(s), ${counts.supersededRules} superseded rule version(s), ${counts.staleRules} STALE rule(s), ${counts.pendingReviewPolicies} policy awaiting review. ${counts.decisionsInWindow} decision(s) recorded in the last ${days} day(s).`
        : `Nothing superseded, stale or pending review in this graph right now — the freshness queue is genuinely empty, not unloaded.`,
    };
  }
}

function inferLabelFromProps(props: any): string {
  if (!props) return 'Node';
  if (props.text !== undefined) return 'Chunk';
  if (props.title !== undefined) return 'Document';
  if (props.ruleName !== undefined) return 'Rule';
  if (props.policyName !== undefined) return 'Policy';
  if (props.summary !== undefined && props.outcome !== undefined) return 'Decision';
  if (props.statement !== undefined) return 'Fact';
  if (props.list !== undefined) return 'WatchlistEntry';
  if (props.email !== undefined || props.role !== undefined) return 'Person';
  if (props.bookingNumber !== undefined) return 'Booking';
  return 'Node';
}
