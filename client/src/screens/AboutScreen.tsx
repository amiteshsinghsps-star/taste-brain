// About & limits. What the system is, how it is built, and the claims it will
// not make. Read alongside /api/trust and /api/coverage, which are the evidence.

import { ModeBadge, Note, Panel } from '@/components/common';
import { useApp } from '@/lib/app-context';

export default function AboutScreen() {
  const { packs, modeInfo } = useApp();

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
            this room, this budget, under rules a person wrote. A model can produce a confident answer; it cannot produce the
            provenance. This app runs a fixed pipeline that separates the three sources of authority and keeps them separate
            on screen — <strong>Qloo</strong> for taste, <strong>the pack</strong> for business rules, <strong>a named human</strong> for the decision.
          </p>
          <p>
            The lead vertical is live-music programming (the venue pack), with a retail assortment pack and a restaurant-menu
            pack beside it to show that a vertical is configuration, not code: same engine, one JSON pack.
          </p>
        </div>

        <Note tone="good" title="The five principles the code enforces">
          <ul className="ml-4 list-disc space-y-0.5">
            <li>Every displayed recommendation carries a stored Qloo result or a rule citation. One of the two, always.</li>
            <li>The LLM writes explanations only. It never ranks, never filters, never approves — those are code paths.</li>
            <li>A human approves, by name, and the act is written into a hash-chained ledger.</li>
            <li>Every result is stamped with the mode the data arrived in: Live, Cached or Replay.</li>
            <li>Language is about audiences, never about a person.</li>
          </ul>
        </Note>

        <div className="text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-slate-700">How a run works</p>
          <ol className="ml-4 mt-1 list-decimal space-y-0.5">
            <li>Seeds named in the pack are resolved to Qloo entities through /search; anything ambiguous is shown as ambiguous.</li>
            <li>One /v2/insights call, with only allowlisted parameters, returns the taste list for the room — in Qloo’s own order.</li>
            <li>Variants (no location, trend, location-only, partners) are fetched within a per-run call budget of {modeInfo?.per_run_call_budget ?? 'the configured'} and cached privately.</li>
            <li>The rule engine evaluates every item against the pack’s SOP: pass, fail, or needs_data — never assumed compliant.</li>
            <li>Flip points are computed: the exact threshold that would change a refusal into a pass.</li>
            <li>The Auditor vets the whole proposal for grounding, audience-level language and mode stamps before anything is served.</li>
            <li>The run is snapshotted server-side, which is what makes ablation, replay and Finals Mode cost zero Qloo calls.</li>
          </ol>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-700">Packs loaded on this server</p>
          {packs.map((p) => (
            <div key={p.pack} className="rounded-lg border border-slate-200 px-3 py-2">
              <div className="text-sm font-semibold">{p.display_name} <span className="font-normal text-slate-500">· {p.unit}</span></div>
              <p className="text-[11px] leading-relaxed text-slate-600">{p.description}</p>
              <p className="mt-1 text-[11px] text-slate-500">{p.rules.length} rules · {p.data_provenance.length} rooms with stated provenance</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="The three modes, in the app’s own words">
        <div className="space-y-2 text-sm text-slate-700">
          <div className="flex flex-wrap items-center gap-2"><ModeBadge mode="live" /><span>Read from Qloo on this run, within the per-run call budget and the global quota.</span></div>
          <div className="flex flex-wrap items-center gap-2"><ModeBadge mode="cached" /><span>Served from the private on-disk cache: the same Qloo answer, the live call not repeated.</span></div>
          <div className="flex flex-wrap items-center gap-2"><ModeBadge mode="replay" /><span>Synthetic fixtures committed in the repository so the app runs with no key. Never presented as a real audience, a real act’s numbers or a live answer.</span></div>
        </div>
        <Note tone="warn" title="What Replay is for">
          The committed fixtures are invented. The artists, popularity figures and guarantees in them are not real, and the
          names are fictional so no real act’s finances or audience are represented. Replay exists so the pipeline, the rules,
          the trace and the governance can be tested and demonstrated offline — the live key does the real answering.
        </Note>
      </Panel>

      <Panel title="What this project does not claim">
        <ul className="ml-4 list-disc space-y-1 text-sm text-slate-700">
          <li>No predicted ticket sales, revenue, attendance or market size. Not modelled, so not shown.</li>
          <li>No fabricated lift figure. Taste Lift publishes Arm B whenever Arm A cannot run, and says so on the screen.</li>
          <li>No invented customers, pilots or traction. Nothing in this repo claims a venue is using it.</li>
          <li>No individual-level profiling: Qloo answers at audience level and the UI repeats only audience-level language.</li>
          <li>No Qloo response data is stored in the public repository, and the API key never reaches client code, logs or responses.</li>
          <li>“Fit”, local lift and rising chips are derived by Taste Brain from Qloo outputs — every one of them is labelled that way.</li>
        </ul>
        <div className="text-[11px] text-slate-500">
          Key status on this host: <strong>{modeInfo?.qloo_key ?? 'unknown'}</strong> · REST active: <strong>{String(modeInfo?.qloo_rest_active)}</strong> ·
          Finals Mode: <strong>{String(modeInfo?.finals_mode)}</strong> · explanation writer: <strong>{modeInfo?.llm_model ?? 'unknown'}</strong>
        </div>
      </Panel>
    </div>
  );
}
