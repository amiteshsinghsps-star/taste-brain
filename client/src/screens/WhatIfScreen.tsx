// What-if (F13). Recompute the same stored rows under a different threshold,
// term or band. Zero Qloo calls: nothing here goes back to the network, and the
// answer is "these items change", not "this will sell more".

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, ModeBadge, Note, Panel } from '@/components/common';
import { NEEDS_RUN, useApp } from '@/lib/state';
import { api } from '@/lib/api';
import type { WhatIfResult } from '@/lib/types';

export default function WhatIfScreen() {
  const { proposal, currentPack, recentPlays } = useApp();
  const numericRules = (currentPack?.rules ?? []).filter((r) => typeof r.value === 'number' && r.kind.startsWith('numeric'));

  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [bandMin, setBandMin] = useState('');
  const [bandMax, setBandMax] = useState('');
  const [termEntity, setTermEntity] = useState('');
  const [termField, setTermField] = useState('guarantee_usd');
  const [termValue, setTermValue] = useState('');
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!proposal) return <div className="space-y-5"><Panel title="What-if" description="Recompute a stored run under a different number."><Empty>{NEEDS_RUN}</Empty></Panel></div>;

  const bandSent = bandMin !== '' || bandMax !== '';
  const rule_overrides: Record<string, number> = {};
  for (const [id, raw] of Object.entries(thresholds)) { const n = Number(raw); if (raw !== '' && Number.isFinite(n) && n >= 0) rule_overrides[id] = n; }
  const offer_terms: Record<string, Record<string, number>> = {};
  if (termEntity.trim() && termValue !== '') {
    const v = Number(termValue);
    if (Number.isFinite(v) && v >= 0) offer_terms[termEntity.trim()] = { [termField.trim() || 'guarantee_usd']: v };
  }

  const canRun = Object.keys(rule_overrides).length > 0 || Object.keys(offer_terms).length > 0 || bandSent || recentPlays.length > 0;

  const run = async () => {
    setBusy(true); setError(null);
    const band = bandSent ? { min: bandMin === '' ? undefined : Number(bandMin), max: bandMax === '' ? undefined : Number(bandMax) } : undefined;
    try {
      const r = await api.whatIf({
        pack: proposal.pack, location: proposal.location, proposal_id: proposal.proposal_id,
        rule_overrides: Object.keys(rule_overrides).length ? rule_overrides : undefined,
        offer_terms: Object.keys(offer_terms).length ? offer_terms : undefined,
        recent_plays: recentPlays.length ? recentPlays : undefined,
        band,
      });
      setResult(r.whatif);
    } catch (e: any) { setError(String(e?.message ?? e)); setResult(null); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <Panel
        title="What-if — move one number, see what moves"
        description="The same stored Qloo rows, re-filtered. This changes a rule you own; it does not change what Qloo said."
        mode={proposal.mode}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">Rule thresholds ({currentPack?.display_name ?? proposal.pack})</div>
            {numericRules.length === 0 && <p className="text-[11px] text-slate-500">This pack has no numeric threshold to move — a band or a term still works.</p>}
            {numericRules.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <label className="w-40 shrink-0 truncate text-[11px] text-slate-600" title={r.snippet ?? r.source}>{r.id}</label>
                <span className="w-16 shrink-0 text-right text-[11px] text-slate-400">now {r.value?.toLocaleString('en-US')}</span>
                <Input
                  type="number" min={0} className="w-28" value={thresholds[r.id] ?? ''}
                  onChange={(e) => setThresholds((t) => ({ ...t, [r.id]: e.target.value }))}
                />
              </div>
            ))}

            <div className="pt-1 text-xs font-semibold text-slate-700">Qloo popularity band (floats 0 to 1 — the same rule Qloo enforces)</div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-600">min</label>
              <Input type="number" step="0.01" min={0} max={1} className="w-24" value={bandMin} onChange={(e) => setBandMin(e.target.value)} placeholder="unset" />
              <label className="text-[11px] text-slate-600">max</label>
              <Input type="number" step="0.01" min={0} max={1} className="w-24" value={bandMax} onChange={(e) => setBandMax(e.target.value)} placeholder="unset" />
            </div>
            <p className="text-[11px] text-slate-500">
              Leave either end unset to keep the band this run was captured under. Anything Qloo placed outside a tightened
              band drops out of the list — it is filtered before ranking, so it never appears as a rule rejection.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">A term of your own</div>
            <p className="text-[11px] leading-relaxed text-slate-500">The guarantee ceiling is a number only you know. Enter it against the entity and the rule can be proven — Taste Brain will never fill it in for you.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input className="w-48" value={termEntity} maxLength={64} onChange={(e) => setTermEntity(e.target.value)} placeholder="entity id from the plan screen" />
              <Input className="w-36" value={termField} maxLength={40} onChange={(e) => setTermField(e.target.value)} placeholder="field" />
              <Input className="w-28" type="number" min={0} value={termValue} onChange={(e) => setTermValue(e.target.value)} placeholder="value" />
            </div>

            <div className="pt-1 text-xs font-semibold text-slate-700">No-repeat window currently in force</div>
            {recentPlays.length
              ? <div className="flex flex-wrap gap-1.5">{recentPlays.map((n) => <span key={n} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{n}</span>)}</div>
              : <p className="text-[11px] text-slate-500">Empty. Edit it on the Plan screen and re-run to see the window bite.</p>}

            <div className="pt-2">
              <Button onClick={run} disabled={busy || !canRun}>{busy ? 'Recomputing…' : 'Recompute offline'}</Button>
              {!canRun && <p className="mt-1 text-[11px] text-slate-500">Nothing to recompute yet: change a threshold, set a band, add a term or fill the window.</p>}
            </div>
          </div>
        </div>

        {error && <Note tone="bad" title="Refused">{error}</Note>}

        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <ModeBadge mode={proposal.mode} />
              <span>{result.qloo_calls_used} Qloo calls used to answer this</span>
              <span className="text-slate-400">· recomputed {result.recomputed_at}</span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <OrderedList title="As it ran" rows={result.before} />
              <OrderedList title="Under your number" rows={result.after} />
            </div>

            {result.changes.length === 0
              ? <Note tone="info">Nothing changed in the list. That is the answer: your new number does not touch this room’s result.</Note>
              : (
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-slate-700">What moved ({result.changes.length})</div>
                  {result.changes.map((c) => (
                    <div key={c.entity_id} className={`rounded-md border px-2.5 py-1.5 text-xs ${c.direction === 'added' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
                      <span className="font-semibold">{c.name}</span> {c.direction === 'added' ? 'comes in' : 'goes out'} — {c.because}
                      {c.qloo_rank !== null && <span className="opacity-70"> · Qloo rank {c.qloo_rank}</span>}
                    </div>
                  ))}
                </div>
              )}

            {result.flip_points_offered.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-700">Flip points the engine offers instead of a guess</div>
                {result.flip_points_offered.map((f, i) => (
                  <div key={i} className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-900">
                    <span className="font-semibold">{f.name}</span> · {f.rule_id}: would need {f.required_threshold.toLocaleString('en-US')} — {f.note}
                  </div>
                ))}
              </div>
            )}

            <div className="text-[11px] text-slate-500">
              Rules applied: {result.rules_applied.map((r) => `${r.id}${r.overridden ? ' (your value)' : ''}`).join(', ')}
            </div>
            {result.notes.map((n, i) => <Note key={i} tone="warn">{n}</Note>)}
          </div>
        )}
      </Panel>
    </div>
  );
}

function OrderedList({ title, rows }: { title: string; rows: { entity_id: string; name: string; rank: number }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      {rows.length === 0 ? <p className="text-[11px] text-slate-500">empty</p> : (
        <ol className="space-y-0.5">
          {rows.map((r) => (
            <li key={r.entity_id} className="flex items-baseline gap-2 text-xs">
              <span className="w-4 text-right font-mono text-slate-400">{r.rank}</span>
              <span>{r.name}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
