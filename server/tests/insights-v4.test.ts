import { describe, it, expect } from 'vitest';
import { isFalkorReachable, deleteTenantGraph, forTenant } from '../src/graph/graph.client';
import { runQuery } from '../src/graph/graph.queries';
import { NorthwindSeeder } from '../src/seed/northwind.seed';
import { SeedV3 } from '../src/seed/seed-v3';
import { InsightsService } from '../src/services/brain/insights.service';
import { FeedbackService } from '../src/services/brain/feedback.service';
import { WatchlistService } from '../src/services/brain/watchlist.service';
import { SavedQueryService } from '../src/services/brain/saved-query.service';
import { ExportService } from '../src/services/brain/export.service';
import { HealthService } from '../src/services/brain/health.service';
import { evaluateBooking } from '../src/services/brain/rule-engine.service';

/**
 * Track 04 — the graph-insight and tenant-curation features. Every assertion
 * reads or writes the live FalkorDB graph, so the suite is honestly skipped
 * when the graph is down rather than passing on a stub.
 */

const falkorUp = await isFalkorReachable();

const TENANT = 'test-tenant-v4';
const OTHER = 'test-tenant-v4-other';

async function seeded() {
  await deleteTenantGraph(TENANT);
  await NorthwindSeeder.seed(TENANT);
  await SeedV3.seed(TENANT);
}

async function firstId(label: string): Promise<string> {
  const graph = await forTenant(TENANT);
  const rows = await runQuery(graph, `MATCH (n:${label}) RETURN n.id AS id LIMIT 1`, {});
  return String(rows[0]?.id ?? '');
}

describe.skipIf(!falkorUp)('V4 — connection path (needs FalkorDB)', () => {
  it('returns a hop chain where node count = edge count + 1', async () => {
    await seeded();
    const path = await InsightsService.connectionPath(TENANT, 'Maya Rao', 'Operations', 5);
    expect(path.connected).toBe(true);
    expect(path.nodes.length).toBe(path.edges.length + 1);
    expect(path.nodes[0].name).toBe('Maya Rao');
    expect(path.hops).toBe(path.nodes.length - 1);
    expect(['forward', 'reverse']).toContain(path.direction);
    expect(path.statement).toContain(`${path.hops} hop`);
  });

  it('reports an unconnected pair as an absence with both degrees, not an empty list', async () => {
    await seeded();
    const path = await InsightsService.connectionPath(TENANT, 'Maya Rao', 'No Such Entity QQ', 4);
    expect(path.connected).toBe(false);
    expect(path.nodes).toEqual([]);
    expect(path.statement.toLowerCase()).toContain('no node');
  });

  it('shortest_path tool answers instead of erroring', async () => {
    await seeded();
    const { GraphToolsService } = await import('../src/services/brain/tools.service');
    const res = await GraphToolsService.shortestPath(TENANT, 'Maya Rao', 'Operations');
    expect(res.path.connected).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.trace).toBeTruthy();
  });
});

describe.skipIf(!falkorUp)('V4 — rule version diff, timeline, handoffs, explain, digest', () => {
  it('diffs a rule against the version it superseded', async () => {
    await seeded();
    const g = await forTenant(TENANT);
    const withHistory = await runQuery(g, `MATCH (n:Rule)-[:SUPERSEDES]->(o:Rule) RETURN n.id AS id LIMIT 1`, {});
    const ruleId = String(withHistory[0]?.id ?? (await firstId('Rule')));
    const diff = await InsightsService.ruleVersionDiff(TENANT, ruleId);
    expect(diff).not.toBeNull();
    expect(diff!.versions.length).toBeGreaterThanOrEqual(1);
    if (diff!.diffs.length) {
      const d = diff!.diffs[0];
      expect(d.toId).toBeTruthy();
      expect(d.changed.length + d.added.length + d.removed.length + d.unchanged.length).toBeGreaterThan(0);
      // Never print a misleading "v1→v1": equal version numbers fall back to ids.
      const label = String(d.fromVersion) === String(d.toVersion) ? `${d.fromId} → ${d.toId}` : `v${d.fromVersion}`;
      expect(diff!.statement).toContain(label.split(' ')[0]);
      // Chronology comes from the SUPERSEDES edges, not from the version string:
      // the demo seed stores the same version number on both rule nodes, so the
      // edge is the only trustworthy ordering. Every `new SUPERSEDES old` pair must
      // be ordered old-before-new in `versions`, and therefore appear as the
      // (fromId=old → toId=new) side of a diff.
      const order = new Map(diff!.versions.map((v, i) => [v.id, i]));
      diff!.edges.forEach((e) => {
        expect(order.get(e.from)!).toBeGreaterThan(order.get(e.to)!);
      });
      if (diff!.diffs.length && diff!.edges.length) {
        const newest = diff!.edges.map((e) => e.from).sort((a, b) => (order.get(b)! ?? 0) - (order.get(a)! ?? 0))[0];
        const last = diff!.diffs[diff!.diffs.length - 1];
        expect(last.toId).toBe(newest);
      }
    }
  });

  it('replays decisions for one subject, newest first', async () => {
    await seeded();
    const tl = await InsightsService.decisionTimeline(TENANT, 'BK-1042');
    expect(tl.events.length).toBeGreaterThan(0);
    expect(tl.matched.decisions).toBe(tl.events.filter((e) => e.kind === 'DECISION').length);
    const dates = tl.events.map((e) => (e.at ? Date.parse(e.at) : 0));
    expect(dates.every((d, i) => i === 0 || dates[i - 1] >= d)).toBe(true);
  });

  it('empty timeline is an explicit absence, not a silent zero', async () => {
    await seeded();
    const tl = await InsightsService.decisionTimeline(TENANT, 'nothing-matches-this-qq');
    expect(tl.events).toEqual([]);
    expect(tl.statement).toContain('Nothing in the graph');
  });

  it('handoff board reads HANDED_OFF_TO edges', async () => {
    await seeded();
    const board = await InsightsService.handoffBoard(TENANT);
    expect(board.agents.length).toBeGreaterThan(0);
    expect(board.handoffs.length).toBeGreaterThan(0);
    const h = board.handoffs[0];
    expect(h.toName).toBeTruthy();
    expect(h.fromName ?? h.directAgentToAgent).toBeTruthy();
    expect(board.statement).toContain('HANDED_OFF_TO');
  });

  it('explains a node with neighbours, provenance and feedback counters', async () => {
    await seeded();
    const policyId = await firstId('Policy');
    const ex = await InsightsService.explainNode(TENANT, policyId);
    expect(ex).not.toBeNull();
    expect(ex!.node.id).toBe(policyId);
    expect(ex!.neighbours.length).toBeGreaterThan(0);
    expect(typeof ex!.feedback.up).toBe('number');
    expect(typeof ex!.feedback.down).toBe('number');
  });

  it('explains an unknown id as null so the caller can 404', async () => {
    await seeded();
    await expect(InsightsService.explainNode(TENANT, 'node_that_does_not_exist')).resolves.toBeNull();
  });

  it('freshness digest counts superseded versions and stale rules', async () => {
    await seeded();
    const digest = await InsightsService.freshnessDigest(TENANT, 60);
    expect(digest.counts.supersededRules).toBeGreaterThanOrEqual(1);
    expect(digest.counts.staleRules).toBeGreaterThanOrEqual(1);
    expect(digest.events.length).toBeGreaterThan(0);
    expect(digest.cutoff).toBeTruthy();
  });
});

describe.skipIf(!falkorUp)('V4 — export is the graph, not a summary', () => {
  it('JSON, GraphML and CSV all carry the same node/edge counts', async () => {
    await seeded();
    const graph = await forTenant(TENANT);
    const n = await runQuery(graph, `MATCH (n) RETURN count(n) AS c`, {});
    const e = await runQuery(graph, `MATCH ()-[r]->() RETURN count(r) AS c`, {});
    const nodes = Number(n[0].c);
    const edges = Number(e[0].c);

    const json = await ExportService.export(TENANT, 'json');
    expect(json.counts.nodes).toBe(nodes);
    expect(json.counts.edges).toBe(edges);

    const graphml = await ExportService.export(TENANT, 'graphml');
    expect((graphml.body.match(/<node /g) || []).length).toBe(nodes);
    expect((graphml.body.match(/<edge /g) || []).length).toBe(edges);
    expect(graphml.body.startsWith('<?xml')).toBe(true);

    const csv = await ExportService.export(TENANT, 'csv');
    expect(csv.body.split('\n').filter(Boolean).length).toBe(edges + 1); // header + one row per edge
  });

  it('escapes markup in node names instead of breaking the document', async () => {
    await seeded();
    const g = await forTenant(TENANT);
    await runQuery(
      g,
      `CREATE (x:WatchlistEntry {id: 'watch_xml_test', name: 'A <b> & "c"', demoSeed: 'false', list: 'test'})`,
      {}
    );
    const graphml = await ExportService.export(TENANT, 'graphml');
    expect(graphml.body).toContain('&lt;b&gt;');
    expect(graphml.body).toContain('&amp;');
    expect(graphml.body).not.toContain('name">A <b>');
  });
});

describe.skipIf(!falkorUp)('V4 — feedback changes Knowledge Health for real', () => {
  it('a thumbs-down on a cited chunk becomes a finding on that exact chunk', async () => {
    await seeded();
    const graph = await forTenant(TENANT);
    const chunks = await runQuery(graph, `MATCH (c:Chunk) RETURN c.id AS id LIMIT 1`, {});
    const chunkId = String(chunks[0].id);

    const recorded = await FeedbackService.record(TENANT, {
      question: 'Which parties must be screened?',
      verdict: 'DOWN',
      chunkIds: [chunkId, 'chunk_not_real'],
      givenBy: 'tester@neutronz.dev',
    });
    expect(recorded.linkedChunks).toEqual([chunkId]);

    const counts = await FeedbackService.counts(TENANT);
    expect(counts.down).toBe(1);
    expect(counts.linked).toBe(1);

    const disliked = await FeedbackService.dislikedSources(TENANT);
    expect(disliked.map((d) => d.chunkId)).toContain(chunkId);

    const report = await HealthService.report(TENANT);
    const finding = report.findings.find((f) => f.kind === 'SOURCE_THUMBS_DOWN');
    expect(finding?.subjectId).toBe(chunkId);

    // An upvote on the same chunk cancels the finding: it is evidence, not a tally.
    await FeedbackService.record(TENANT, { question: 'Which parties must be screened?', verdict: 'UP', chunkIds: [chunkId] });
    const afterUp = await FeedbackService.dislikedSources(TENANT);
    expect(afterUp.map((d) => d.chunkId)).not.toContain(chunkId);
  });
});

describe.skipIf(!falkorUp)('V4 — your own screening entry changes the next verdict', () => {
  const party = 'Globex Restricted Test Ltd';
  const booking = {
    bookingNumber: 'BK-V4-TEST',
    shipper: party,
    consignee: 'Northwind Traders',
    origin: 'Shenzhen, CN',
    destination: 'Hamburg, DE',
    hsCode: '847130',
    invoiceAmount: 100,
    currency: 'USD',
  };

  it('add → engine FLAGGED → remove → engine PASSED', async () => {
    await seeded();

    const before = await evaluateBooking(TENANT, booking as any);
    expect(before.verdict).toBe('PASSED');

    const added = await WatchlistService.add(TENANT, { name: party, note: 'from the vitest suite' }, 'tester@neutronz.dev');
    expect(added.entry.demoSeed).toBe('false');
    expect(added.alreadyPresent).toBe(false);
    expect(added.preview.screenedBookings).toBeGreaterThan(0);

    const during = await evaluateBooking(TENANT, booking as any);
    expect(during.verdict).toBe('FLAGGED');
    expect(during.reasons.join(' ')).toContain(party);

    // Same name again is recognised, not duplicated.
    const again = await WatchlistService.add(TENANT, { name: party }, 'tester@neutronz.dev');
    expect(again.alreadyPresent).toBe(true);

    const removed = await WatchlistService.remove(TENANT, added.entry.id);
    expect(removed.removed).toBe(true);

    const after = await evaluateBooking(TENANT, booking as any);
    expect(after.verdict).toBe('PASSED');
  });

  it('seeded demo entries are refused, never deleted', async () => {
    await seeded();
    const seeded0 = (await WatchlistService.list(TENANT)).find((w) => w.demoSeed === 'true');
    expect(seeded0).toBeTruthy();
    const refused = await WatchlistService.remove(TENANT, seeded0!.id);
    expect(refused.removed).toBe(false);
    expect(refused.reason).toContain('Seeded demo entry');
    const still = await WatchlistService.list(TENANT);
    expect(still.map((w) => w.id)).toContain(seeded0!.id);
  });

  it('rejects junk names instead of writing noise into the graph', async () => {
    await seeded();
    await expect(WatchlistService.add(TENANT, { name: 'x' }, 'tester')).rejects.toThrow(/at least 2/);
    await expect(WatchlistService.add(TENANT, { name: 'a'.repeat(200) }, 'tester')).rejects.toThrow(/characters/);
  });
});

describe.skipIf(!falkorUp)('V4 — pinned queries stay inside their tenant', () => {
  it('saves, isolates and deletes', async () => {
    await seeded();
    await deleteTenantGraph(OTHER);
    await NorthwindSeeder.seed(OTHER);

    const row = await SavedQueryService.save(TENANT, { question: 'Which containers are demurrage exposed?', snippet: 'x' }, 'tester@neutronz.dev');
    expect(row.id).toBeTruthy();

    // Idempotent on the exact question.
    const dup = await SavedQueryService.save(TENANT, { question: 'Which containers are demurrage exposed?' }, 'tester@neutronz.dev');
    expect(dup.id).toBe(row.id);

    expect((await SavedQueryService.list(TENANT)).length).toBe(1);
    expect((await SavedQueryService.list(OTHER)).length).toBe(0);

    expect(await SavedQueryService.remove(TENANT, row.id)).toBe(true);
    expect((await SavedQueryService.list(TENANT)).length).toBe(0);
    await deleteTenantGraph(OTHER);
  });

  it('refuses an empty question', async () => {
    await seeded();
    await expect(SavedQueryService.save(TENANT, { question: '   ' }, 'tester')).rejects.toThrow(/required/);
  });
});
