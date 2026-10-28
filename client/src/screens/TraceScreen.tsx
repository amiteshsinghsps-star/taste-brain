// Decision trace (F9). The pipeline's own steps, in order, exactly as the engine
// wrote them — the UI adds no interpretation to a step's wording.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CountUp, Empty, FilterPills, ModeBadge, ModeMixBar, ModeMixLine, Note, Panel, Skeleton, Stat, Time } from '@/components/common';
import { NEEDS_RUN, useApp } from '@/lib/app-context';

const DOT: Record<string, string> = {
  pass: 'bg-emerald-500', fail: 'bg-red-500', needs_data: 'bg-amber-500', info: 'bg-slate-400',
};

export default function TraceScreen() {
  const { proposal, busy } = useApp();
  const [only, setOnly] = useState<string>('all');
  // One step's raw JSON open at a time, keyed by its position in the engine's own
  // list so filtering never moves an open panel to another step.
  const [raw, setRaw] = useState<number | null>(null);
  const steps = proposal?.trace.steps ?? [];
  const types = [...new Set(steps.map((s) => s.type))];
  // The position in the engine's own step list, kept through the filter, is what
  // keys the list: an index over the filtered rows makes React reuse the wrong DOM
  // and an opened "raw" panel jumps to a different step.
  const shown = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => only === 'all' || s.type === only);

  const exportJson = () => {
    if (!proposal) return;
    const blob = new Blob([JSON.stringify(proposal.trace, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${proposal.proposal_id}.trace.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Decision trace"
        description="Every step the fixed pipeline took, with the mode it ran in and the source it used. The rerun hash covers the steps and the inputs, so the same run reproduces."
        mode={proposal?.mode}
        actions={proposal ? <Button size="sm" variant="outline" onClick={exportJson}>Export JSON</Button> : undefined}
      >
        {!proposal && busy ? <Skeleton lines={6} /> : !proposal ? <Empty>{NEEDS_RUN}</Empty> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={<CountUp value={steps.length} />} label="steps recorded" />
              <Stat value={<CountUp value={steps.filter((s) => s.mode === 'live').length} />} label="read from Qloo now" />
              <Stat value={<CountUp value={steps.filter((s) => s.mode === 'cached').length} />} label="from stored answers" />
              <Stat value={<CountUp value={new Set(steps.map((s) => s.type)).size} />} label="step kinds" />
            </div>

            {proposal.trace.mode_mix && (
              <div className="rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2.5">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Where every step’s data came from</div>
                <ModeMixBar mix={proposal.trace.mode_mix} />
              </div>
            )}

            <FilterPills
              value={only}
              onChange={setOnly}
              options={[
                { id: 'all', label: <>all · {steps.length}</> },
                ...types.map((t) => ({ id: t, label: <>{t} · {steps.filter((s) => s.type === t).length}</> })),
              ]}
            />
            <dl className="tb-arm grid gap-x-6 text-xs sm:grid-cols-2">
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-slate-500">proposal</dt><dd className="font-mono text-slate-800">{proposal.trace.proposal_id}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-slate-500">rerun hash</dt><dd className="font-mono text-slate-800" title={proposal.trace.rerun_hash}>{proposal.trace.rerun_hash.slice(0, 24)}…</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-1 sm:col-span-2">
                <dt className="text-slate-500">pack · room · goal</dt>
                <dd className="text-right text-slate-800">{proposal.trace.pack} · {proposal.trace.location} · “{proposal.trace.goal}”</dd>
              </div>
            </dl>
            <ModeMixLine mix={proposal.trace.mode_mix} />

            <ol className="relative ml-2 border-l border-slate-300">
              {shown.map(({ s, i }) => (
                <li key={i} className="group mb-2 ml-4">
                  <span className={`absolute -left-[7px] mt-2.5 h-3.5 w-3.5 rounded-full ring-2 ring-white transition-transform group-hover:scale-125 ${DOT[s.result ?? 'info'] ?? 'bg-slate-400'}`} aria-hidden />
                  <div className="tb-arm tb-lift px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">{s.type}</span>
                      <span className="font-medium text-slate-900">{s.label}</span>
                      {s.mode && <ModeBadge mode={s.mode} />}
                      {s.id && <span className="font-mono text-[11px] text-slate-400">{s.id}</span>}
                      <Time iso={s.at} />
                      <button
                        className="tb-pill ml-auto" data-on={raw === i} aria-expanded={raw === i}
                        onClick={() => setRaw(raw === i ? null : i)}
                      >{raw === i ? 'hide raw' : 'raw step'}</button>
                    </div>
                    {s.source && <div className="text-[11px] text-slate-500">source: {s.source}</div>}
                    {s.detail && <div className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-slate-600">{s.detail}</div>}
                    {raw === i && (
                      <pre className="tb-screen-enter mt-1.5 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[10px] leading-relaxed text-slate-700">{JSON.stringify(s, null, 2)}</pre>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <Note tone="info" title="What this trace does not prove">
              It shows the order the deterministic pipeline ran in and the inputs each step used. It does not show a model
              reasoning: the LLM, when configured, writes one explanation per item and never ranks, filters or approves —
              those steps are Rule, Filter and Decision entries made by code.
            </Note>
          </>
        )}
      </Panel>
    </div>
  );
}
