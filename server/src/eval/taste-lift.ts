// Taste Lift (PRD §12). Runs a fixed request set through the grounded agent
// (Arm B) and, when configured, a plain LLM (Arm A). Computes deterministic
// checks for both arms and publishes raw outputs + a run stamp. It never invents
// numbers: if Arm A cannot run (no LLM key), the result says so explicitly.

import { runPipeline } from '../agents/pipeline';
import { loadPack, getLocation, getCatalog } from '../packs/loader';
import { env } from '../config/env';
import type { Proposal, TasteMode } from '../types';

export interface EvalRequest { pack: string; location: string; goal: string; }

// Fixed set, written before testing (PRD §12.1). Not tuned afterward.
export const REQUEST_SET: EvalRequest[] = [
  { pack: 'retail', location: 'store_3', goal: 'Add 4 brands to the spring assortment for this store' },
  { pack: 'retail', location: 'store_1', goal: 'Add 3 brands to the fall assortment for this store' },
  { pack: 'retail', location: 'store_2', goal: 'Replace the lowest-fit 2 brands in this store' },
  { pack: 'restaurants', location: 'loc_westside', goal: 'Add 2 dishes to the summer menu for this location' },
  { pack: 'venues', location: 'venue_redroom', goal: 'Book 3 acts for the autumn series at this venue' },
];

export interface ArmMetrics {
  arm: 'A_plain_llm' | 'B_grounded';
  ran: boolean;
  note: string;
  grounding_rate: number;      // share of shown items traceable to a Qloo id in the run
  rule_compliance: number;     // share of shown items passing every applicable rule
  specificity: number;         // share of named items present in that location's Qloo results
  item_count: number;
  raw_items: string[];
}

// Arm B grounded metrics come straight from the real proposal (Qloo-ranked, audited).
export function groundedMetrics(p: Proposal, allQlooIds: Set<string>): ArmMetrics {
  const n = p.items.length;
  const grounded = p.items.filter((it) => it.entity_id && allQlooIds.has(it.entity_id)).length;
  // An item with no rule verdict has not PASSED the rules — it was never tested
  // by them. Counting `[].every(pass)` as compliance inflated the figure, so the
  // rate is taken over the items that carry a verdict and the rest is disclosed.
  const tested = p.items.filter((it) => it.rule_results.length > 0);
  const compliant = tested.filter((it) => it.rule_results.every((r) => r.pass)).length;
  const untested = n - tested.length;
  const specific = grounded;
  return {
    arm: 'B_grounded', ran: true,
    note: `grounded agent: ranking from Qloo, filtered by rules, vetoed by Auditor${untested > 0 ? `; ${untested} of ${n} item(s) carried no rule verdict, so the compliance figure is ${compliant}/${tested.length}, not ${compliant}/${n}` : ''}`,
    grounding_rate: n ? grounded / n : 0, rule_compliance: tested.length ? compliant / tested.length : 0, specificity: n ? specific / n : 0,
    item_count: n, raw_items: p.items.map((it) => it.name),
  };
}

// Arm A: a plain LLM given only the rules in the prompt (no Qloo). Returns names;
// we then check how many of its names appear in the location's Qloo results.
async function plainLlmItems(req: EvalRequest): Promise<string[] | null> {
  if (!env.LLM_API_KEY) return null;
  const pack = loadPack(req.pack);
  try {
    const res = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: env.LLM_MODEL, temperature: 0.4, max_tokens: 200,
        messages: [{ role: 'user', content: `You are a merchandising assistant with no audience data. Goal: ${req.goal}. Rules: ${pack.rules.map((r) => r.snippet).join('; ')}. List ${pack.copy.offer_label} names as a comma-separated list. Do not explain.` }],
      }),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? '';
    return text.split(',').map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function qlooIdsFor(req: EvalRequest): Set<string> {
  const loc = getLocation(req.pack, req.location);
  return new Set(getCatalog(req.pack, loc.catalog).map((c) => c.qloo_entity_id));
}

export async function runTasteLift(mode: TasteMode = 'replay') {
  const armA: ArmMetrics[] = [];
  const armB: ArmMetrics[] = [];
  for (const req of REQUEST_SET) {
    const proposal = await runPipeline({ ...req, mode });
    const ids = qlooIdsFor(req);
    armB.push(groundedMetrics(proposal, ids));
    const items = await plainLlmItems(req);
    if (items) {
      const names = new Set(ids); // we only have names<->ids via catalog; compare by name presence
      const cat = getCatalog(req.pack, getLocation(req.pack, req.location).catalog);
      const catNames = new Set(cat.map((c) => c.name.toLowerCase()));
      const grounded = items.filter((nm) => catNames.has(nm.toLowerCase())).length;
      armA.push({
        arm: 'A_plain_llm', ran: true, note: 'plain LLM from rules-only prompt, no Qloo',
        grounding_rate: items.length ? grounded / items.length : 0,
        rule_compliance: NaN, // cannot verify without running rules on unnamed items
        specificity: items.length ? grounded / items.length : 0,
        item_count: items.length, raw_items: items,
      });
      void names;
    } else {
      armA.push({ arm: 'A_plain_llm', ran: false, note: 'ARM A DID NOT RUN: no LLM_API_KEY. Publish Arm B only; do not fabricate a lift.', grounding_rate: NaN, rule_compliance: NaN, specificity: NaN, item_count: 0, raw_items: [] });
    }
  }
  const mean = (xs: number[]) => { const f = xs.filter((x) => Number.isFinite(x)); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : NaN; };
  return {
    run_date: new Date().toISOString(),
    sample_size: REQUEST_SET.length,
    model: env.LLM_API_KEY ? env.LLM_MODEL : 'none',
    mode,
    git_commit: process.env.GIT_COMMIT ?? 'dev',
    rubric: ['audience_fit', 'specificity', 'rule_compliance', 'verifiability', 'usefulness'],
    summary: {
      armB: { grounding_rate: mean(armB.map((a) => a.grounding_rate)), rule_compliance: mean(armB.map((a) => a.rule_compliance)), specificity: mean(armB.map((a) => a.specificity)) },
      armA: { ran: armA.every((a) => a.ran), grounding_rate: mean(armA.map((a) => a.grounding_rate)), specificity: mean(armA.map((a) => a.specificity)) },
    },
    per_request: REQUEST_SET.map((r, i) => ({ request: r, armA: armA[i], armB: armB[i] })),
  };
}
