import fs from 'fs';
import path from 'path';
import { deleteTenantGraph, isFalkorReachable } from '../graph/graph.client';
import { NorthwindSeeder } from '../seed/northwind.seed';
import { SeedV3 } from '../seed/seed-v3';
import { compareQuestion, aggregate, GoldenQuestion } from '../services/brain/eval.service';
import { loadRulesFromGraph } from '../services/brain/rule-engine.service';
import { SimulationService } from '../services/brain/simulation.service';

/**
 * Graph-vs-RAG evaluation runner — `npm run eval`.
 *
 * Seeds a dedicated eval tenant with the demo company, runs all 20 golden
 * questions through both systems (same chunks, same LLM config, temperature 0),
 * scores deterministically, and writes docs/EVAL.md + eval/results.json.
 * Also records the Time-Machine changed-count on the 10k→5k scenario so the
 * README number is measured, never hardcoded.
 */

const EVAL_TENANT = 'eval-tenant';
const RUNS = 3;

async function main() {
  if (!(await isFalkorReachable())) {
    console.error('FalkorDB is not reachable — start it with `docker compose up -d` at the repo root.');
    process.exit(1);
  }

  console.log(`Seeding eval tenant "${EVAL_TENANT}"...`);
  await deleteTenantGraph(EVAL_TENANT).catch(() => {});
  await NorthwindSeeder.seed(EVAL_TENANT);
  const v3 = await SeedV3.seed(EVAL_TENANT);
  console.log(`Seeded (bookings: ${v3.counts.bookings}, invoices: ${v3.counts.invoices}).`);

  const golden: GoldenQuestion[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden.json'), 'utf-8'));

  console.log(`Running ${golden.length} questions x ${RUNS} runs (median scores)...`);
  const medians = new Map<string, { baseline: any; neutronz: any }>();
  for (let run = 1; run <= RUNS; run++) {
    for (const q of golden) {
      const r = await compareQuestion(EVAL_TENANT, q);
      const prev = medians.get(q.id) ?? { baseline: [] as any[], neutronz: [] as any[] };
      prev.baseline.push(r.baseline.score);
      prev.neutronz.push(r.neutronz.score);
      medians.set(q.id, prev as any);
    }
    console.log(`  run ${run}/${RUNS} done`);
  }

  const rows = golden.map((q) => {
    const m: any = medians.get(q.id)!;
    const median = (arr: any[], key: string) =>
      Number((([...arr].map((s: any) => Number(s[key]))).sort((a: number, b: number) => a - b)[Math.floor(arr.length / 2)]).toFixed(2));
    const b = (arr: any[]) => ({
      entityRecall: median(arr, 'entityRecall'), sourceRecall: median(arr, 'sourceRecall'),
      citationValidity: median(arr, 'citationValidity'), currency: median(arr, 'currency'),
      hasTrace: false, latencyMs: 0,
    });
    return { id: q.id, category: q.category, question: q.text, baseline: b(m.baseline), neutronz: b(m.neutronz) };
  });

  const agg = aggregate(rows.map((r) => ({ baseline: r.baseline, neutronz: r.neutronz, category: r.category })));

  // Measured Time-Machine number for the README (never hardcoded).
  const creditRule = (await loadRulesFromGraph(EVAL_TENANT)).find((r) => r.actionType === 'CREDIT_LIMIT_APPROVAL');
  let timeMachine: any = null;
  if (creditRule) {
    const sim = await SimulationService.simulate(EVAL_TENANT, { ruleId: creditRule.id, candidateParams: { maxCreditLimit: 5000 } });
    timeMachine = { total: sim.total, changed: sim.changed, replayFidelity: sim.replayFidelity };
  }

  const commit = process.env.GIT_COMMIT || 'uncommitted';
  const model = process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL || 'configured' : 'none (cited-context fallback)';
  const at = new Date().toISOString();

  const results = { at, commit, model, runs: RUNS, tenant: EVAL_TENANT, overall: agg, perQuestion: rows, timeMachine };
  fs.mkdirSync(path.join(__dirname, '..', '..', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  let md = `# Graph-first vs plain RAG — measured on ${agg.n} golden questions\n\n`;
  md += `Date: ${at} · Runs per question: ${RUNS} (median) · LLM: ${model} · Commit: ${commit}\n\n`;
  md += `Same chunks, same model, same temperature (0). Baseline = top-5 similar chunks only. Neutronz = graph-first pipeline (entity linking → seeds → multi-hop expansion → currency filter).\n\n`;
  md += `| Metric | Plain RAG | Graph-first (Neutronz) |\n|---|---|---|\n`;
  md += `| Entity recall | ${pct(agg.baseline.entityRecall)} | **${pct(agg.neutronz.entityRecall)}** |\n`;
  md += `| Source recall | ${pct(agg.baseline.sourceRecall)} | **${pct(agg.neutronz.sourceRecall)}** |\n`;
  md += `| Citation validity | ${pct(agg.baseline.citationValidity)} | **${pct(agg.neutronz.citationValidity)}** |\n`;
  md += `| Currency (no superseded sources) | ${pct(agg.baseline.currency)} | **${pct(agg.neutronz.currency)}** |\n\n`;
  md += `## By category\n\n| Category | n | RAG entity | Graph entity | RAG source | Graph source | RAG currency | Graph currency |\n|---|---|---|---|---|---|---|---|\n`;
  for (const c of agg.categories) {
    md += `| ${c.category} | ${c.n} | ${pct(c.baseline.entityRecall)} | ${pct(c.neutronz.entityRecall)} | ${pct(c.baseline.sourceRecall)} | ${pct(c.neutronz.sourceRecall)} | ${pct(c.baseline.currency)} | ${pct(c.neutronz.currency)} |\n`;
  }
  if (timeMachine) {
    md += `\n## Policy Time Machine check\n\nCredit threshold 10,000 → 5,000 USD replayed over ${timeMachine.total} stored bookings: **${timeMachine.changed} verdicts change**, replay fidelity ${(timeMachine.replayFidelity * 100).toFixed(0)}%.\n`;
  }
  md += `\nReproduce: \`cd server && npm run eval\` (requires FalkorDB from \`docker compose up -d\`).\n`;
  fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'EVAL.md'), md);

  console.log('\n' + md);
  console.log('Wrote eval/results.json and docs/EVAL.md');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Eval failed:', err);
    process.exit(1);
  });
