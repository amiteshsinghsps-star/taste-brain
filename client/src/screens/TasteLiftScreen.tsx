// Taste Lift measurement (PRD §12). The same fixed request set run through the
// grounded agent (Arm B) and, only when an LLM key exists, a plain rules-only LLM
// (Arm A). Every figure below is the server's own — this screen only formats it.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chips, Empty, KV, ModeBadge, Note, Panel, Time } from '@/components/common';
import { num, pct } from '@/lib/format';
import { api } from '@/lib/api';
import type { ArmMetrics, TasteLiftResult } from '@/lib/types';

/** Display guard: a number the server did not send stays a dash. No maths here. */
function count(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : num(n, 0);
}

export default function TasteLiftScreen() {
  const [result, setResult] = useState<TasteLiftResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.evalResults()
      .then((r) => { if (alive) setResult(r.results); })
      .catch((e) => { if (alive) setError(String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const runEval = useCallback(async () => {
    setRunning(true); setError(null);
    try {
      const r = await api.evalRun();
      setResult(r.results);
    } catch (e) {
      setError(String(e));
    } finally { setRunning(false); }
  }, []);

  return (
    <div className="space-y-5">
      <Panel
        title="Taste Lift — grounded agent vs plain LLM"
        description="PRD §12. One fixed request set, run through the grounded agent (Arm B) and, only when an LLM key exists, a plain rules-only LLM (Arm A). Figures are published exactly as the run returns them."
        actions={<Button size="sm" onClick={runEval} disabled={running}>{running ? 'Running the fixed request set…' : 'Run the fixed request set'}</Button>}
      >
        {error && <Note tone="bad" title="The engine refused">{error}</Note>}
        {running && <p className="text-sm text-slate-500">The fixed set is running — this takes a few seconds.</p>}
        {loading && !error && <p className="text-sm text-slate-500">Loading the last run…</p>}
        {!loading && !running && !result && !error && (
          <Empty>
            No Taste Lift run exists on this server yet. Press <strong>Run the fixed request set</strong> to compute one.
            Nothing here is back-filled or estimated — the figures are published whatever the run returns.
          </Empty>
        )}
      </Panel>

      {result && (
        <Panel title="Run stamp" description="Facts the server attached to this run.">
          <dl className="rounded-md bg-slate-50 px-2.5 py-1.5">
            <KV k="run_date" v={<Time iso={result.run_date} />} />
            <KV k="sample_size" v={count(result.sample_size)} />
            <KV k="model" v={result.model} />
            <KV k="git_commit" v={result.git_commit} />
            {(result.mode === 'live' || result.mode === 'cached' || result.mode === 'replay') && (
              <KV k="mode" v={<ModeBadge mode={result.mode} />} />
            )}
          </dl>
        </Panel>
      )}

      {result && (
        <Panel
          title="Summary — Arm B (grounded) vs Arm A (plain LLM)"
          description="Mean of the deterministic checks over the request set, as reported by the server."
        >
          {!result.summary.armA.ran && (
            <Note tone="warn" title="Arm A did not run">
              Arm A did not run because no LLM key is configured on this host, so only Arm B figures are published and no
              lift percentage is claimed.
            </Note>
          )}
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="text-[11px] uppercase text-slate-500">
                <th className="py-1 pr-2">measure</th>
                <th className="py-1 pr-2">Arm B (grounded)</th>
                <th className="py-1">Arm A (plain LLM)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100">
                <td className="py-1 pr-2 font-medium">grounding_rate</td>
                <td className="py-1 pr-2">{pct(result.summary.armB.grounding_rate)}</td>
                <td className="py-1">{pct(result.summary.armA.grounding_rate)}</td>
              </tr>
              <tr className="border-t border-slate-100">
                <td className="py-1 pr-2 font-medium">rule_compliance</td>
                <td className="py-1 pr-2">{pct(result.summary.armB.rule_compliance)}</td>
                <td className="py-1 text-slate-500">not measured</td>
              </tr>
              <tr className="border-t border-slate-100">
                <td className="py-1 pr-2 font-medium">specificity</td>
                <td className="py-1 pr-2">{pct(result.summary.armB.specificity)}</td>
                <td className="py-1">{pct(result.summary.armA.specificity)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      )}

      {result && (
        <Panel
          title="Per-request detail"
          description="The server's own note for each arm, rendered verbatim. Raw items are what that arm returned."
        >
          {result.per_request.length ? (
            result.per_request.map((pr, i) => <RequestBlock key={`${pr.request.pack}-${pr.request.location}-${i}`} pr={pr} />)
          ) : (
            <Empty>The run returned no per-request rows. Nothing is filled in here.</Empty>
          )}
        </Panel>
      )}
    </div>
  );
}

function RequestBlock({ pr }: { pr: TasteLiftResult['per_request'][number] }) {
  return (
    <article className="rounded-lg border border-slate-200 p-3">
      <div className="text-sm font-semibold">{pr.request.pack} · {pr.request.location}</div>
      <p className="mt-0.5 text-xs text-slate-600">{pr.request.goal}</p>
      <ArmBlock label="Arm B (grounded)" arm={pr.armB} showItems note="note from the server" />
      <ArmBlock label="Arm A (plain LLM)" arm={pr.armA} showItems={pr.armA.ran} note="ran / note" />
    </article>
  );
}

function ArmBlock({ label, arm, showItems, note }: {
  label: string;
  arm: ArmMetrics;
  showItems: boolean;
  note: string;
}) {
  return (
    <div className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5">
      <div className="text-xs font-semibold text-slate-700">{label}</div>
      <dl className="mt-1">
        <KV k="ran" v={arm.ran ? 'yes' : 'no'} />
        <KV k={note} v={arm.note} />
        <KV k="item_count" v={count(arm.item_count)} />
      </dl>
      {showItems && (
        arm.raw_items.length
          ? <div className="mt-1.5"><Chips items={arm.raw_items} title="returned" /></div>
          : <p className="mt-1 text-[11px] text-slate-500">No items returned by this arm.</p>
      )}
    </div>
  );
}
