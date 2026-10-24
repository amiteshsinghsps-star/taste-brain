// Decision trace (F9). The pipeline's own steps, in order, exactly as the engine
// wrote them — the UI adds no interpretation to a step's wording.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, ModeBadge, ModeMixLine, Note, Panel, Time } from '@/components/common';
import { NEEDS_RUN, useApp } from '@/lib/state';
import type { TraceStep } from '@/lib/types';

const DOT: Record<string, string> = {
  pass: 'bg-emerald-500', fail: 'bg-red-500', needs_data: 'bg-amber-500', info: 'bg-slate-400',
};

export default function TraceScreen() {
  const { proposal } = useApp();
  const [only, setOnly] = useState<string>('all');
  const steps = proposal?.trace.steps ?? [];
  const types = [...new Set(steps.map((s) => s.type))];
  const shown = only === 'all' ? steps : steps.filter((s) => s.type === only);

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
        {!proposal ? <Empty>{NEEDS_RUN}</Empty> : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-slate-500">filter:</span>
              <button onClick={() => setOnly('all')} className={`cursor-pointer rounded px-2 py-0.5 ${only === 'all' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>all {steps.length}</button>
              {types.map((t) => (
                <button
                  key={t} onClick={() => setOnly(t)}
                  className={`cursor-pointer rounded px-2 py-0.5 ${only === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >{t} {steps.filter((s) => s.type === t).length}</button>
              ))}
            </div>
            <dl className="rounded-md bg-slate-50 px-3 py-2 text-xs">
              <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-1">
                <dt className="text-slate-500">proposal</dt><dd className="font-mono">{proposal.trace.proposal_id}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-1">
                <dt className="text-slate-500">rerun hash</dt><dd className="font-mono" title={proposal.trace.rerun_hash}>{proposal.trace.rerun_hash.slice(0, 24)}…</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-slate-500">pack · room · goal</dt>
                <dd>{proposal.trace.pack} · {proposal.trace.location} · “{proposal.trace.goal}”</dd>
              </div>
            </dl>
            <ModeMixLine mix={proposal.trace.mode_mix} />

            <ol className="relative ml-2 border-l border-slate-300">
              {shown.map((s, i) => <Step key={i} s={s} />)}
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

function Step({ s }: { s: TraceStep }) {
  return (
    <li className="mb-3 ml-4">
      <span className={`absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full ${DOT[s.result ?? 'info'] ?? 'bg-slate-400'}`} aria-hidden />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">{s.type}</span>
        <span className="font-medium">{s.label}</span>
        {s.mode && <ModeBadge mode={s.mode} />}
        {s.id && <span className="font-mono text-[11px] text-slate-400">{s.id}</span>}
        <Time iso={s.at} />
      </div>
      {s.source && <div className="text-[11px] text-slate-500">source: {s.source}</div>}
      {s.detail && <div className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-slate-600">{s.detail}</div>}
    </li>
  );
}
