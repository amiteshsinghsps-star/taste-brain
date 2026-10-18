import { describe, it, expect } from 'vitest';
import { isFalkorReachable, deleteTenantGraph, forTenant } from '../src/graph/graph.client';
import { runQuery } from '../src/graph/graph.queries';
import { NorthwindSeeder } from '../src/seed/northwind.seed';
import { SeedV3 } from '../src/seed/seed-v3';
import { LedgerService } from '../src/services/brain/ledger.service';
import { SimulationService } from '../src/services/brain/simulation.service';
import { WhyNotService } from '../src/services/brain/whynot.service';
import { HealthService } from '../src/services/brain/health.service';
import { RetrievalService } from '../src/services/brain/retrieval.service';
import { loadRulesFromGraph } from '../src/services/brain/rule-engine.service';
import { compareQuestion } from '../src/services/brain/eval.service';
import { PrecedentService } from '../src/services/brain/precedent.service';
import { GraphToolsService } from '../src/services/brain/tools.service';
import { env } from '../src/config/env';
import golden from '../src/eval/golden.json';

/**
 * PRD v3 test plan T16–T21. All of these read and write the live tenant graph,
 * so they are skipped (honestly marked, never faked) when FalkorDB is down.
 */

// Resolved before the describes below are collected: skipIf reads the flag at
// collection time, so an async beforeAll would skip graph tests even with a live DB.
const falkorUp = await isFalkorReachable();

const TENANT = 'test-tenant-v3';

async function seeded() {
  await deleteTenantGraph(TENANT);
  await NorthwindSeeder.seed(TENANT);
  // The v3 fixtures (bookings, ledger genesis, stale versions) are a second pass,
  // same as POST /brain/seed-demo does for the demo button.
  await SeedV3.seed(TENANT);
}

/** The credit rule's threshold key differs across seed versions; resolve it. */
function thresholdKey(params: Record<string, any> = {}) {
  return params.maxCreditLimit !== undefined ? 'maxCreditLimit' : 'threshold';
}

describe.skipIf(!falkorUp)('T16 — ledger is tamper-EVIDENT (needs FalkorDB)', () => {
  it('editing one entry hash breaks the chain at that exact seq', async () => {
    await seeded();
    await LedgerService.append({ tenantId: TENANT, actor: 'tester', kind: 'TEST_A', subjectId: '', payload: { note: 'first' } });
    await LedgerService.append({ tenantId: TENANT, actor: 'tester', kind: 'TEST_B', subjectId: '', payload: { note: 'second' } });

    const clean = await LedgerService.verify(TENANT);
    expect(clean.ok).toBe(true);
    expect(clean.entries).toBeGreaterThanOrEqual(2);

    const graph = await forTenant(TENANT);
    const rows = await runQuery(graph, `MATCH (e:LedgerEntry) RETURN e.seq AS seq ORDER BY toInteger(e.seq)`, {});
    const target = String(rows[0].seq);
    await runQuery(graph, `MATCH (e:LedgerEntry {seq: $seq}) SET e.kind = 'SILENTLY_REWRITTEN'`, { seq: target });

    const tampered = await LedgerService.verify(TENANT);
    expect(tampered.ok).toBe(false);
    expect(tampered.brokenAt).toBe(Number(target));

    await deleteTenantGraph(TENANT);
  }, 120000);

  it('concurrent appends still produce a gapless chain (T16b)', async () => {
    await seeded();
    const n = 10;
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        LedgerService.append({ tenantId: TENANT, actor: `worker-${i}`, kind: 'CONCURRENT', subjectId: '', payload: { i: String(i) } })
      )
    );
    const list = await LedgerService.list(TENANT, 200);
    const seqs = list.map((e) => e.seq).sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(seqs.length); // no duplicate sequence numbers
    expect(seqs[0]).toBe(1);
    expect(seqs[seqs.length - 1]).toBe(seqs.length); // no gaps
    const verify = await LedgerService.verify(TENANT);
    expect(verify.ok).toBe(true);
    expect(verify.entries).toBe(seqs.length);

    await deleteTenantGraph(TENANT);
  }, 120000);
});

describe.skipIf(!falkorUp)('T17/T18 — Policy Time Machine is read-only until Apply (needs FalkorDB)', () => {
  it('discard mutates nothing; apply versions the rule and writes a ledger entry', async () => {
    await seeded();
    const rules = await loadRulesFromGraph(TENANT);
    const credit = rules.find((r) => r.actionType === 'CREDIT_LIMIT_APPROVAL' && r.status === 'ACTIVE');
    expect(credit).toBeTruthy();
    const key = thresholdKey(credit!.params);
    const original = Number(credit!.params[key]);
    const candidate = original === 5000 ? 7500 : 5000;

    const sim = await SimulationService.simulate(TENANT, { ruleId: credit!.id, candidateParams: { [key]: candidate } });
    expect(sim.total).toBeGreaterThan(0);
    expect(sim.changed).toBeGreaterThan(0);

    // T18 — replaying the CURRENT rule over stored bookings must reproduce the
    // recorded verdicts exactly, otherwise counterfactual numbers are untrustworthy.
    expect(sim.replayFidelity).toBe(1);
    expect(sim.unreliable).toBe(false);
    expect(sim.replayMatches).toBe(sim.total);

    // Discard: graph must be byte-identical for the rule, and status flipped.
    await SimulationService.discard(TENANT, sim.simulationId);
    const afterDiscard = (await loadRulesFromGraph(TENANT)).find((r) => r.id === credit!.id);
    expect(Number(afterDiscard!.params[key])).toBe(original);
    expect(afterDiscard!.status).toBe('ACTIVE');

    // Apply: new ACTIVE version at the candidate value, old one superseded.
    const reSim = await SimulationService.simulate(TENANT, { ruleId: credit!.id, candidateParams: { [key]: candidate } });
    const ledgerBefore = await LedgerService.verify(TENANT);
    const applied = await SimulationService.apply(TENANT, reSim.simulationId, 'tester', 'vitest T17');
    expect(applied.newRuleId).toBeTruthy();

    const active = (await loadRulesFromGraph(TENANT)).filter((r) => r.status === 'ACTIVE' && r.actionType === 'CREDIT_LIMIT_APPROVAL');
    expect(active).toHaveLength(1);
    expect(Number(active[0].params[key])).toBe(candidate);
    expect(active[0].id).toBe(applied.newRuleId);

    // History is never deleted: the old version stays in the graph, marked
    // SUPERSEDED and linked from the new one.
    const graph = await forTenant(TENANT);
    const oldRows = await runQuery(graph, `MATCH (r:Rule {id: $id}) RETURN r.status AS status, r.validTo AS validTo`, { id: credit!.id });
    expect(oldRows.length).toBe(1);
    expect(oldRows[0].status).toBe('SUPERSEDED');
    expect(oldRows[0].validTo).toBeTruthy();
    const supersedeEdge = await runQuery(
      graph,
      `MATCH (n:Rule {id: $newId})-[:SUPERSEDES]->(o:Rule {id: $oldId}) RETURN n.id AS id`,
      { newId: applied.newRuleId, oldId: credit!.id }
    );
    expect(supersedeEdge).toHaveLength(1);

    const ledgerAfter = await LedgerService.verify(TENANT);
    expect(ledgerAfter.entries).toBe(ledgerBefore.entries + 1);
    expect(ledgerAfter.ok).toBe(true);

    await deleteTenantGraph(TENANT);
  }, 180000);
});

describe.skipIf(!falkorUp)('T19 — Why-Not reports margins, not vibes (needs FalkorDB)', () => {
  it('explains the closest rule with a numeric margin for a passed booking', async () => {
    await seeded();
    const graph = await forTenant(TENANT);
    const bookings = await runQuery(
      graph,
      `MATCH (b:Booking) WHERE b.recordedVerdict = 'PASSED' RETURN b.bookingNumber AS bookingNumber ORDER BY toInteger(b.atMs) DESC LIMIT 5`,
      {}
    );
    expect(bookings.length).toBeGreaterThan(0);

    const explained = await WhyNotService.whyNot(TENANT, String(bookings[0].bookingNumber));
    expect(explained).toBeTruthy();
    expect(explained!.currentVerdict).toBe('PASSED');
    expect(explained!.evaluations.length).toBeGreaterThan(0);
    expect(explained!.nearestRule).toBeTruthy();
    expect(typeof explained!.nearestRule!.margin).toBe('number');
    expect(explained!.summary.length).toBeGreaterThan(0);

    // Every evaluation that has a margin is also labelled for the UI.
    const withMargin = explained!.evaluations.filter((e) => typeof e.margin === 'number');
    withMargin.forEach((e) => expect(typeof e.marginLabel).toBe('string'));

    await deleteTenantGraph(TENANT);
  }, 120000);
});

describe.skipIf(!falkorUp)('T20 — eval scoring is deterministic (needs FalkorDB)', () => {
  it('same golden question scores identically across repeated runs', async () => {
    await seeded();
    const questions = (golden as any).questions ?? golden;
    const q = (Array.isArray(questions) ? questions : [questions]).find((x: any) => x.category === 'ownership');
    expect(q).toBeTruthy();

    const first = await compareQuestion(TENANT, q as any);
    const second = await compareQuestion(TENANT, q as any);
    const third = await compareQuestion(TENANT, q as any);

    for (const other of [second, third]) {
      expect(other.neutronz.score.entityRecall).toBe(first.neutronz.score.entityRecall);
      expect(other.neutronz.score.sourceRecall).toBe(first.neutronz.score.sourceRecall);
      expect(other.neutronz.score.citationValidity).toBe(first.neutronz.score.citationValidity);
      expect(other.neutronz.score.currency).toBe(first.neutronz.score.currency);
      expect(other.baseline.score.entityRecall).toBe(first.baseline.score.entityRecall);
      expect(other.neutronz.citations.map((c: any) => c.chunkId)).toEqual(first.neutronz.citations.map((c: any) => c.chunkId));
    }

    await deleteTenantGraph(TENANT);
  }, 180000);
});

describe.skipIf(!falkorUp)('T21 — Knowledge Health finds the planted issues (needs FalkorDB)', () => {
  it('surfaces orphan policies, stale rules and bus-factor-1 subjects', async () => {
    await seeded();
    const report = await HealthService.report(TENANT);

    const kinds = new Set(report.findings.map((f) => f.kind));
    ['ORPHAN_POLICY', 'STALE_RULE', 'BUS_FACTOR'].forEach((k) => expect(kinds.has(k)).toBe(true));
    // The demo company deliberately ships with more than one defect.
    expect(new Set(report.findings.map((f) => f.subjectId)).size).toBeGreaterThanOrEqual(3);
    expect(report.score).toBeLessThan(100);
    expect(report.counts.HIGH + report.counts.MEDIUM + report.counts.LOW).toBe(report.findings.length);
    report.findings.forEach((f) => expect(f.detail.length).toBeGreaterThan(0));

    await deleteTenantGraph(TENANT);
  }, 120000);

  it('graph-first answer to an ownership question surfaces the graph hops', async () => {
    await seeded();
    const res = await RetrievalService.query(TENANT, 'Which systems and agents does the credit approval policy govern?');
    // The verbatim hop list is the no-LLM fallback answer body; with a key the
    // model writes the prose instead, so only assert it where it is the code path.
    if (!env.OPENAI_API_KEY) expect(res.answer).toMatch(/Graph facts:/);
    expect(res.trace.edges.some((e) => e.type === 'GOVERNS')).toBe(true);
    await deleteTenantGraph(TENANT);
  }, 120000);
});

describe.skipIf(!falkorUp)('T22 — precedent recall from the graph (needs FalkorDB)', () => {
  it('ranks past decisions by shared terms and names the person who decided', async () => {
    await seeded();
    const precedents = await PrecedentService.similar(TENANT, ['BK-1042', 'denied', 'customs'], 3);

    expect(precedents.length).toBeGreaterThan(0);
    expect(precedents.length).toBeLessThanOrEqual(3);
    // Score-ordered: the booking-specific freeze must outrank generic chatter.
    expect(precedents[0].summary.toLowerCase()).toContain('bk-1042');
    expect(precedents[0].score).toBeGreaterThanOrEqual(precedents[1]?.score ?? 0);
    precedents.forEach((p) => {
      expect(p.id).toMatch(/^decision_/);
      expect(p.summary.length).toBeGreaterThan(0);
      expect(p.decidedBy).toBeTruthy();
    });

    // No terms to match on → no precedents, not a random one.
    expect(await PrecedentService.similar(TENANT, ['zzz-no-such-subject'], 3)).toEqual([]);

    await deleteTenantGraph(TENANT);
  }, 120000);
});

describe.skipIf(!falkorUp)('T23 — absence is a finding, not an empty list (needs FalkorDB)', () => {
  it('proves 0 OWNS edges for an entity the graph has never seen', async () => {
    await seeded();
    const missing = await PrecedentService.absence(TENANT, {
      relationship: 'OWNS',
      fromLabel: 'Person',
      term: 'Quantum Widget Policy',
    });
    expect(missing.edgesFound).toBe(0);
    expect(missing.candidateNodes).toBe(0);
    expect(missing.statement).toContain('0 OWNS edges');

    const present = await PrecedentService.absence(TENANT, {
      relationship: 'OWNS',
      fromLabel: 'Person',
      term: 'Denied-Party',
    });
    expect(present.edgesFound).toBeGreaterThan(0);

    // The tool surfaces the negative proof instead of returning an empty list.
    const owner = await GraphToolsService.findOwner(TENANT, 'Quantum Widget Policy');
    expect(owner.results).toHaveLength(0);
    expect(owner.absence?.edgesFound).toBe(0);
    expect(String(owner.answer)).toContain('does not record');

    await deleteTenantGraph(TENANT);
  }, 120000);

  it('refuses relationship types outside the schema allow-list', async () => {
    await seeded();
    await expect(
      PrecedentService.absence(TENANT, { relationship: 'OWNS; DROP', fromLabel: 'Person', term: 'x' })
    ).rejects.toThrow(/allow-list/);
    // Labels reach Cypher as identifiers too, so the same gate protects centrality.
    await expect(
      GraphToolsService.centralEntities(TENANT, ['Person) WHERE 1=1 RETURN n //'])
    ).rejects.toThrow(/allow-list/);
    await deleteTenantGraph(TENANT);
  }, 120000);
});
