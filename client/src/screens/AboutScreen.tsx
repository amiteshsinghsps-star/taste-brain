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
    body: 'Real calls to hackathon.api.qloo.com made by the server. The API key lives only in the server environment — never in this browser, never in a response, never in a log.',
  },
  {
    name: 'Cached', cost: 'no Qloo call', spine: 'empty',
    body: 'Answers already fetched on this server, kept in a private on-disk cache. A step that reads them is stamped as served from storage, never as if it had just been asked.',
  },
  {
    name: 'Sample (Replay)', cost: 'no Qloo call', spine: 'dead',
    body: 'Rows committed to this repository so the app works with no key and no network. A live run that cannot reach Qloo falls back to these — and such a row reads Sample, never Cached, because nothing here was ever a Qloo answer.',
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
  'The taste seeds named in the pack are resolved to Qloo entities; anything ambiguous stays ambiguous.',
  'One insights call returns the taste list for the room, in Qloo’s own order.',
  'Variants (no location, trend, partners) are fetched within the per-run call budget.',
  'Every item is checked against the pack’s rules: pass, fail, or needs_data — never assumed compliant.',
  'Flip points are computed: the threshold that would turn a refusal into a pass.',
  'An auditor vets the whole proposal before anything is served.',
  'The run is snapshotted server-side, so What-if, Ablation and Finals cost zero extra Qloo calls.',
];

const SCREEN_GUIDE: { group: string; items: [string, string, string][] }[] = [
  {
    group: 'Decide',
    items: [
      ['plan', 'Plan', 'Pack, room, goal — run the agent'],
      ['evidence', 'Evidence', 'The source card behind each item'],
      ['trace', 'Trace', 'Every pipeline step, stamped by source'],
      ['brief', 'Brief', 'The one-page approval brief'],
    ],
  },
  {
    group: 'Question',
    items: [
      ['whynot', 'Why not?', 'The rule that blocked a rejected item'],
      ['whatif', 'What if?', 'Change a rule number, re-evaluate'],
      ['partners', 'Partners', 'Partner candidates for the audience'],
    ],
  },
  {
    group: 'Prove it',
    items: [
      ['ablation', 'Ablation', 'Turn stages off, watch what breaks'],
      ['trust', 'Trust', 'Claims made, claims refused, checks'],
      ['verify', 'Verify', 'Recompute the hashes of the run'],
      ['breakit', 'Break it', 'Hostile inputs against the API'],
      ['coverage', 'Coverage', 'Every feature and where it lives'],
      ['ledger', 'Ledger', 'Approves and refuses, hash-chained'],
    ],
  },
  {
    group: 'Operate',
    items: [
      ['budget', 'Budget', 'Live-call usage and the call log'],
      ['finals', 'Finals', 'Re-serve stored runs, zero calls'],
      ['lift', 'Taste Lift', 'Grounded agent vs a plain LLM'],
      ['about', 'About', 'This screen'],
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
        description="Decision governance for taste-driven venues and operators, built on Qloo."
        mode={modeInfo?.default_mode}
      >
        <div className="space-y-3 text-sm leading-relaxed text-slate-700">
          <p>
            This app keeps three sources of authority separate on screen: <strong>Qloo</strong> for taste,
            <strong> the pack</strong> for business rules, <strong>a named human</strong> for the decision.
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
            <li>Every result is stamped with where its data came from: Live, Cached, or Sample (offline data committed to this repo — never a Qloo answer).</li>
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
        title="Every tab"
        description="Click any name to jump there — or press Ctrl+K."
      >
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {SCREEN_GUIDE.map((g) => (
            <div key={g.group} className="tb-arm min-w-0 flex-1 basis-40">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">{g.group}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map(([id, name, what]) => (
                  <button
                    key={id}
                    onClick={() => jump(id)}
                    title={what}
                    className="tb-chip cursor-pointer px-2 py-0.5 text-xs font-semibold hover:opacity-80"
                  >{name}</button>
                ))}
              </div>
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
          “Fit”, local lift and rising chips are calculated by Taste Brain from Qloo outputs, never supplied by Qloo, and are
          labelled as such wherever they appear. The raw field they came from sits beside them on the Evidence card.
        </Note>
        <div className="tb-arm mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <span>Qloo key: <strong>{modeInfo?.qloo_key ?? 'unknown'}</strong></span>
          <span>Live mode: <strong>{modeInfo?.qloo_rest_active ? 'on' : 'off'}</strong></span>
          <span>Finals Mode: <strong>{modeInfo?.finals_mode ? 'on' : 'off'}</strong></span>
          <span>explanation writer: <strong>{modeInfo?.llm_model ?? 'unknown'}</strong></span>
          <span>licence: <strong>MIT</strong> — see <code>LICENSE</code> in the repository</span>
        </div>
      </Panel>
    </div>
  );
}
