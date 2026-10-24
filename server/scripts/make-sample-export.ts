// Generates the committed sample export the Verifier is demonstrated and tested
// against. It runs the engine in Replay with the Qloo client switched off, so it
// makes no network call and needs no key — the file it writes is synthetic.
//
//   npm run verify:sample
//
// A sample that does not pass would be a broken build, not a demo, so this exits
// non-zero if the Verifier reports any failure.

process.env.QLOO_ENABLED = 'false';
process.env.DEFAULT_MODE = 'replay';
process.env.GRAPH_DB = ':memory:';
// This file is committed. On the custodian's machine the private identity overlay
// is present, and a run that resolves seeds would then write real names into the
// repo — so the overlay is switched off for anything that ships.
process.env.PACK_OVERLAY_DISABLE = 'true';

import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join(__dirname, '..', 'verification', 'sample-export.json');

async function main() {
  const { env } = await import('../src/config/env');
  if (env.QLOO_ENABLED || env.DEFAULT_MODE !== 'replay') {
    throw new Error(`refusing to generate: this process is not replay-only (enabled=${env.QLOO_ENABLED}, default=${env.DEFAULT_MODE})`);
  }

  const { runPipeline, decide } = await import('../src/agents/pipeline');
  const { exportFromStore } = await import('../src/verify/buildFromStore');
  const { verifyExport, formatReport } = await import('../src/verify/verifier');
  const { graph } = await import('../src/graph/store');

  const proposal = await runPipeline({
    pack: 'retail',
    location: 'store_3',
    goal: 'Add 4 brands for spring',
    mode: 'replay',
  });
  console.log(`ran ${proposal.proposal_id} in mode ${proposal.mode}: ${proposal.items.length} item(s), ${proposal.rejections.length} rejection(s), ${proposal.trace.steps.length} trace step(s)`);

  const decided = decide(proposal, 'approved', 'Sample Data (synthetic operator)', {});
  if (decided.error) throw new Error(`the sample decision was refused: ${decided.error}`);
  console.log(`approved, ledger entries now ${graph.readLedger(500).length}`);

  const exp = exportFromStore(proposal.proposal_id);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(exp, null, 2) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${fs.statSync(OUT).size} bytes)`);

  const report = verifyExport(JSON.parse(fs.readFileSync(OUT, 'utf8')));
  console.log('');
  console.log(formatReport(report));
  if (!report.ok) throw new Error('the sample export does not verify — fix the generator before shipping it');
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
