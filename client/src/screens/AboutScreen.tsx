// About. What the system is, what each tab does, where the data comes from,
// and the claims it will not make.

import { Note, Panel } from '@/components/common';
import { useApp } from '@/lib/app-context';

const SCREEN_GUIDE: { group: string; items: [string, string, string][] }[] = [
  {
    group: 'Decide',
    items: [
      ['plan', 'Plan', 'Pick the pack, room and goal, then run the agent. Shows ranked items with fit, rule results and the approve / refuse actions.'],
      ['evidence', 'Evidence', 'The source card behind every shown item: the exact Qloo result and the rule that let it through.'],
      ['trace', 'Trace', 'Every pipeline step in order — seeds, audience, candidates, rule checks, auditor, final list — each stamped with where its data came from.'],
      ['brief', 'Brief', 'The one-page approval brief for the named human: what is being decided, why, and on whose evidence.'],
    ],
  },
  {
    group: 'Question',
    items: [
      ['whynot', 'Why not?', 'Ask about any rejected item and get the exact rule that blocked it and the threshold that would change the answer.'],
      ['whatif', 'What if?', 'Change a rule number (budget ceiling, minimum order…) and re-evaluate the stored run instantly — zero Qloo calls.'],
      ['partners', 'Partners', 'Brand and place partner candidates for the same audience, ranked by Qloo and checked against the rules.'],
    ],
  },
  {
    group: 'Prove it',
    items: [
      ['ablation', 'Ablation', 'Turn pipeline stages off on the stored run and watch what breaks — proof each stage earns its place.'],
      ['trust', 'Trust', 'Which claims the system will make, which it refuses, and the checks backing each row.'],
      ['verify', 'Verify', 'Recomputes the hashes over the stored run and says whether the evidence still matches what was served.'],
      ['breakit', 'Break it', 'Fires hostile inputs (oversized payloads, injection strings) at the API and shows how the engine refuses or survives.'],
      ['coverage', 'Coverage', 'Every feature, its status and the file that implements it — the map of what is real and where.'],
      ['ledger', 'Ledger', 'Every approve and refuse, by whom and when, recorded in a tamper-evident hash chain.'],
    ],
  },
  {
    group: 'Operate',
    items: [
      ['budget', 'Budget', 'Live-call usage: per-visitor hour and day, global day and the monthly floor, plus every outbound call log.'],
      ['finals', 'Finals', 'Re-serve stored runs on stage with zero Qloo calls, so a network problem cannot break the demo.'],
      ['lift', 'Taste Lift', 'Compares the grounded agent against a plain LLM answer and reports the result honestly, including when a side could not run.'],
      ['about', 'About', 'This screen: what the system is, what each tab does, where the data comes from, and the limits.'],
    ],
  },
];

export default function AboutScreen() {
  const { packs, modeInfo } = useApp();

  const jump = (id: string) => { window.location.hash = id; };

  return (
    <div className="space-y-5">
      <Panel
        title="What Taste Brain is"
        description="Decision governance for taste-driven venues and operators, built on Qloo. Rules from the business, taste from Qloo, a trace for every decision."
        mode={modeInfo?.default_mode}
      >
        <div className="space-y-3 text-sm leading-relaxed text-slate-700">
          <p>
            A venue booking a room and a retailer setting an assortment make the same kind of call: what fits this audience,
            this room and this budget, under rules a person wrote. This app runs a fixed pipeline that keeps the three sources
            of authority separate on screen — <strong>Qloo</strong> for taste, <strong>the pack</strong> for business rules,
            <strong> a named human</strong> for the decision.
          </p>
        </div>

        <Note tone="good" title="The rules the code enforces">
          <ul className="ml-4 list-disc space-y-0.5">
            <li>Every recommendation shown carries a stored Qloo result or a rule citation. One of the two, always.</li>
            <li>The AI writes explanations only. It never ranks, never filters, never approves.</li>
            <li>A human approves, by name, and the decision is written into a tamper-evident ledger.</li>
            <li>Every result is stamped with where its data came from: Live, Cached, or Sample (synthetic offline data — never a Qloo answer).</li>
            <li>Language is about audiences, never about an individual person.</li>
          </ul>
        </Note>

        <div className="text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-700">How a run works</p>
          <ol className="ml-4 mt-1 list-decimal space-y-0.5">
            <li>The taste seeds named in the pack are resolved to Qloo entities; anything ambiguous is shown as ambiguous.</li>
            <li>One insights call returns the taste list for the room, in Qloo’s own order.</li>
            <li>Variants (no location, trend, partners) are fetched within the per-run call budget and cached privately.</li>
            <li>Every item is checked against the pack’s rules: pass, fail, or needs_data — never assumed compliant.</li>
            <li>Flip points are computed: the exact threshold that would turn a refusal into a pass.</li>
            <li>An auditor vets the whole proposal before anything is served.</li>
            <li>The run is snapshotted server-side, so What-if, Ablation and Finals cost zero extra Qloo calls.</li>
          </ol>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">Packs loaded on this server</p>
          {packs.map((p) => (
            <div key={p.pack} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-sm font-semibold">{p.display_name} <span className="font-normal text-slate-500">· {p.unit}</span></div>
              <p className="text-[11px] leading-relaxed text-slate-600">{p.description}</p>
              <p className="mt-1 text-[11px] text-slate-500">{p.rules.length} rules · {p.data_provenance.length} rooms with stated sources</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Every tab, in one line each"
        description="Click any name to jump there — or press Ctrl+K."
      >
        <div className="space-y-4">
          {SCREEN_GUIDE.map((g) => (
            <div key={g.group}>
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-500">{g.group}</div>
              <dl className="space-y-1">
                {g.items.map(([id, name, what]) => (
                  <div key={id} className="flex gap-2 text-xs leading-relaxed">
                    <dt className="w-24 shrink-0">
                      <button onClick={() => jump(id)} className="tb-chip cursor-pointer px-2 py-0.5 font-semibold hover:opacity-80">{name}</button>
                    </dt>
                    <dd className="min-w-0 text-slate-600">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Where the data comes from on this host">
        <div className="space-y-2 text-sm text-slate-700">
          <div><strong>Live</strong> — real calls to Qloo (<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">hackathon.api.qloo.com</code>) made by the server. The API key lives only in the server environment — never in this browser, never in a response, never in a log. Calls are throttled, retried on failure, and cached.</div>
          <div><strong>Cached</strong> — answers already fetched on this server, kept in a private on-disk cache. Using them costs no Qloo call, and every step says it was served from storage.</div>
          <div><strong>Sample (Replay)</strong> — synthetic rows committed to the repository so the app works with no key and no network. A live run that could not reach Qloo falls back to these, and the stamp follows the data: such a row reads Sample, never Cached, because nothing here was ever a Qloo answer.</div>
        </div>
        <div className="mt-3 grid gap-1 text-[11px] text-slate-600 md:grid-cols-2">
          <div><code className="font-mono">/api/health</code> — mode, key status, budgets · polled by the header</div>
          <div><code className="font-mono">/api/packs</code> — pack identities, rooms, rules</div>
          <div><code className="font-mono">POST /api/proposals</code> — runs the pipeline (rate-limited)</div>
          <div><code className="font-mono">/api/proposals/:id/trace</code> — the decision trace</div>
          <div><code className="font-mono">/api/whynot · /whatif · /partners</code> — the Question group</div>
          <div><code className="font-mono">/api/ledger · /verify · /coverage · /trust</code> — the Prove-it group</div>
          <div><code className="font-mono">/api/qloo/rest-log</code> — every outbound call with status and timing</div>
          <div><code className="font-mono">/api/eval/run · /snapshots · /ablation</code> — Lift, Finals, Ablation</div>
        </div>
      </Panel>

      <Panel title="What this project does not claim">
        <ul className="ml-4 list-disc space-y-1 text-sm text-slate-700">
          <li>No predicted ticket sales, revenue, attendance or market size. Not modelled, so not shown.</li>
          <li>No made-up comparison numbers — when a side of the evaluation cannot run, the screen says so.</li>
          <li>No invented customers, pilots or traction. Nothing claims a venue is using it.</li>
          <li>No individual-level profiling: results describe audiences, not people.</li>
          <li>The Qloo API key never reaches client code, logs or responses.</li>
          <li>“Fit”, local lift and rising chips are calculated by Taste Brain from Qloo outputs — every one is labelled that way.</li>
        </ul>
        <div className="text-[11px] text-slate-500">
          Qloo key: <strong>{modeInfo?.qloo_key ?? 'unknown'}</strong> · Live mode: <strong>{modeInfo?.qloo_rest_active ? 'on' : 'off'}</strong> ·
          Finals Mode: <strong>{modeInfo?.finals_mode ? 'on' : 'off'}</strong> · explanation writer: <strong>{modeInfo?.llm_model ?? 'unknown'}</strong>
        </div>
      </Panel>
    </div>
  );
}
