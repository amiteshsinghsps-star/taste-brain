// About. What the system is, what each tab does, where the data comes from,
// and the claims it will not make.

import { Note, Panel } from '@/components/common';
import { useApp } from '@/lib/app-context';
const AUTHORITY: { who: string; role: string; limit: string; spine: 'ok' | 'empty' | 'dead' }[] = [
  { who: 'Qloo', role: 'taste', limit: 'Ranks what an audience likes and explains the entity. It is never asked whether the deal is allowed.', spine: 'ok' },
  { who: 'The pack', role: 'business rules', limit: 'The thresholds a business wrote: budget ceiling, minimum order, guarantee cap. The app never edits one silently.', spine: 'empty' },
  { who: 'A named human', role: 'the decision', limit: 'Approves or refuses, by name, and the act is written to the ledger. No model approves on anyone’s behalf.', spine: 'ok' },
];

const PROVENANCE: { name: string; cost: string; spine: 'ok' | 'empty' | 'dead'; body: string }[] = [
  {
    name: 'Live', cost: 'one Qloo call', spine: 'ok',
    body: 'Real calls to hackathon.api.qloo.com made by the server. The API key lives only in the server environment — never in this browser, never in a response, never in a log. Calls are throttled, retried on failure, and cached.',
  },
  {
    name: 'Cached', cost: 'no Qloo call', spine: 'empty',
    body: 'Answers already fetched on this server, kept in a private on-disk cache. The step that reads them is stamped as served from storage, so a cached answer is never shown as if it had just been asked.',
  },
  {
    name: 'Sample (Replay)', cost: 'no Qloo call', spine: 'dead',
    body: 'Rows committed to the repository so the app works with no key and no network. A live run that could not reach Qloo falls back to these, and the stamp follows the data: such a row reads Sample, never Cached, because nothing here was ever a Qloo answer.',
  },
];

const ENDPOINTS: { route: string; what: string }[] = [
  { route: '/api/health', what: 'mode, key status, budgets · polled by the header' },
  { route: '/api/packs', what: 'pack identities, rooms, rules' },
  { route: 'POST /api/proposals', what: 'runs the pipeline (rate-limited)' },
  { route: '/api/proposals/:id/trace', what: 'the decision trace' },
  { route: '/api/whynot · /whatif · /partners', what: 'the Question group' },
  { route: '/api/ledger · /verify · /coverage · /trust', what: 'the Prove-it group' },
  { route: '/api/qloo/rest-log', what: 'every outbound call with status and timing' },
  { route: '/api/eval/run · /snapshots · /ablation', what: 'Lift, Finals, Ablation' },
];

const NOT_CLAIMED: string[] = [
  'No predicted ticket sales, revenue, attendance or market size. Not modelled, so not shown.',
  'No made-up comparison numbers — when a side of the evaluation cannot run, the screen says so.',
  'No invented customers, pilots or traction. Nothing claims a venue is using it.',
  'No individual-level profiling: results describe audiences, not people.',
  'The Qloo API key never reaches client code, logs or responses.',
];

const RUN_STEPS: string[] = [
  'The taste seeds named in the pack are resolved to Qloo entities; anything ambiguous is shown as ambiguous.',
  'One insights call returns the taste list for the room, in Qloo’s own order.',
  'Variants (no location, trend, partners) are fetched within the per-run call budget and cached privately.',
  'Every item is checked against the pack’s rules: pass, fail, or needs_data — never assumed compliant.',
  'Flip points are computed: the exact threshold that would turn a refusal into a pass.',
  'An auditor vets the whole proposal before anything is served.',
  'The run is snapshotted server-side, so What-if, Ablation and Finals cost zero extra Qloo calls.',
];

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

  const jump = (id: string) => { window.location.assign(`#${id}`); };

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

          <div className="grid gap-2.5 sm:grid-cols-3">
            {AUTHORITY.map((a) => (
              <div key={a.who} className="tb-arm tb-status" data-st={a.spine}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{a.who}</div>
                <div className="mt-0.5 text-sm font-semibold text-slate-800">{a.role}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{a.limit}</p>
              </div>
            ))}
          </div>
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
          <ol className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {RUN_STEPS.map((s, i) => (
              <li key={i} className="tb-arm tb-lift flex gap-2">
                <span className="tb-medal flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]">{i + 1}</span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">Packs loaded on this server</p>
          {packs.length === 0 ? (
            <p className="tb-arm text-[11px] text-slate-500">No pack came back from the server, so there is nothing to describe.</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {packs.map((p) => (
                <div key={p.pack} className="tb-arm tb-lift tb-status" data-st="ok">
                  <div className="text-sm font-semibold">{p.display_name} <span className="font-normal text-slate-500">· {p.unit}</span></div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{p.description}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="tb-pill">{p.rules.length} rules</span>
                    <span className="tb-pill">{p.data_provenance.length} rooms with stated sources</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title="Every tab, in one line each"
        description="Click any name to jump there — or press Ctrl+K."
      >
        <div className="space-y-4">
          {SCREEN_GUIDE.map((g) => (
            <div key={g.group} className="tb-arm">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">{g.group}</span>
                <span className="tb-pill">{g.items.length} tabs</span>
              </div>
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
        <div className="grid gap-2.5 lg:grid-cols-3">
          {PROVENANCE.map((p) => (
            <div key={p.name} className="tb-arm tb-lift tb-status" data-st={p.spine}>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-slate-800">{p.name}</span>
                <span className="tb-pill">{p.cost}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{p.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-1.5 text-[11px] text-slate-600 md:grid-cols-2">
          {ENDPOINTS.map((e) => (
            <div key={e.route} className="tb-arm flex flex-wrap items-baseline gap-x-2">
              <code className="font-mono text-indigo-700">{e.route}</code>
              <span className="min-w-0">{e.what}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="What this project does not claim">
        <ul className="grid gap-2 sm:grid-cols-2">
          {NOT_CLAIMED.map((c) => (
            <li key={c} className="tb-arm tb-status flex gap-2" data-st="dead">
              <span className="mt-px text-[11px] font-bold text-rose-600" aria-hidden>✕</span>
              <span className="min-w-0 text-[12px] leading-relaxed text-slate-700">{c}</span>
            </li>
          ))}
        </ul>
        <Note tone="info" title="What the app does compute">
          “Fit”, local lift and rising chips are calculated by Taste Brain from Qloo outputs — every one is labelled that way,
          and the raw field it was computed from sits beside it on the Evidence card.
        </Note>
        <div className="tb-arm mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <span>Qloo key: <strong>{modeInfo?.qloo_key ?? 'unknown'}</strong></span>
          <span>Live mode: <strong>{modeInfo?.qloo_rest_active ? 'on' : 'off'}</strong></span>
          <span>Finals Mode: <strong>{modeInfo?.finals_mode ? 'on' : 'off'}</strong></span>
          <span>explanation writer: <strong>{modeInfo?.llm_model ?? 'unknown'}</strong></span>
        </div>
      </Panel>
    </div>
  );
}
