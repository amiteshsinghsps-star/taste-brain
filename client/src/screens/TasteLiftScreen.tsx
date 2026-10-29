// Taste Lift measurement (PRD §12). The same fixed request set run through the
// grounded agent (Arm B) and, only when an LLM key exists, a plain rules-only LLM
// (Arm A). Every figure below is the server's own — this screen only formats it.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Chips, Empty, KV, MeterBar, ModeBadge, Note, Panel, Skeleton, Stat, Time,
} from '@/components/common';
import { num, pct } from '@/lib/format';
import { api } from '@/lib/api';
import type { ArmMetrics, TasteLiftResult, TasteMode } from '@/lib/types';

/** Display guard: a number the server did not send stays a dash. No maths here. */
function count(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : num(n, 0);
}

const MODES: TasteMode[] = ['live', 'cached', 'replay'];

/** A rate the server sent as a fraction; the bar restates it, it does not derive it. */
function bar(x: number | null | undefined): number {
  return x === null || x === undefined || !Number.isFinite(x) ? Number.NaN : x * 100;
}

// The three measures, each defined by the server's own comment for the field.
const MEASURES: { key: 'grounding_rate' | 'rule_compliance' | 'specificity'; means: 'both' | 'armB'; definition: string }[] = [
  { key: 'grounding_rate', means: 'both', definition: 'share of shown items traceable to a Qloo id in the run' },
  { key: 'rule_compliance', means: 'armB', definition: 'share of shown items passing every applicable rule' },
  { key: 'specificity', means: 'both', definition: "share of named items present in that location's Qloo results" },
];

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
        description="One fixed request set, run through the grounded agent (Arm B) and, only when an LLM key exists, a plain rules-only LLM (Arm A). Figures are published exactly as the server returns them."
        actions={<Button size="sm" onClick={runEval} disabled={running}>{running ? 'Running the fixed request set…' : 'Run the fixed request set'}</Button>}
      >
        {error && <Note tone="bad" title="The engine refused">{error}</Note>}
        {(running || loading) && !error && <Skeleton lines={4} />}
        {!loading && !running && !result && !error && (
          <Empty>
            No Taste Lift run exists on this server yet. Press <strong>Run the fixed request set</strong> to compute one.
            Nothing here is back-filled or estimated — the figures are published whatever the run returns.
          </Empty>
        )}
      </Panel>

      {result && (
        <Panel title="Run stamp" description="Facts the server attached to this run.">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={count(result.sample_size)} label="requests in the set" />
            <Stat value={<Time iso={result.run_date} />} label="run date" />
            <Stat
              value={MODES.includes(result.mode) ? <ModeBadge mode={result.mode} /> : (result.mode ? String(result.mode) : '—')}
              label="mode"
            />
            <Stat value={String(result.rubric.length)} label="rubric lines scored" hint={result.rubric.join(' · ')} />
          </div>
          <dl className="mt-2.5 rounded-md bg-slate-50 px-2.5 py-1.5">
            <KV k="model" v={result.model} />
            <KV k="git_commit" v={result.git_commit} />
            <KV k="rubric" v={result.rubric.join(' · ')} />
          </dl>
        </Panel>
      )}

      {result && (
        <Panel
          title="Summary — Arm B (grounded) vs Arm A (plain LLM)"
          description="Mean of the deterministic checks over the request set, as reported by the server. Both bars share one scale: full width is 100%."
        >
          {!result.summary.armA.ran && (
            <Note tone="warn" title="Arm A did not run">
              Arm A did not run because no LLM key is configured on this host, so only Arm B figures are published and no
              lift percentage is claimed.
            </Note>
          )}
          <div className="grid gap-2.5 lg:grid-cols-3">
            {MEASURES.map((m) => (
              <article key={m.key} className="tb-arm">
                <h3 className="text-sm font-bold text-slate-800">{m.key.replace(/_/g, ' ')}</h3>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{m.definition}</p>
                <div className="mt-2.5 space-y-2.5">
                  <MeterBar
                    pct={bar(result.summary.armB[m.key])}
                    caption={<span>Arm B grounded · <strong className="font-semibold text-slate-700">{pct(result.summary.armB[m.key])}</strong></span>}
                  />
                  {m.means === 'both' ? (
                    <MeterBar
                      muted
                      pct={bar(result.summary.armA[m.key as 'grounding_rate' | 'specificity'])}
                      caption={<span>Arm A plain LLM · <strong className="font-semibold text-slate-700">{pct(result.summary.armA[m.key as 'grounding_rate' | 'specificity'])}</strong></span>}
                    />
                  ) : (
                    <p className="text-[10px] text-slate-500">Arm A — not measured: rules cannot be run on items an LLM named without an id.</p>
                  )}
                </div>
              </article>
            ))}
          </div>
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
    <article className="tb-arm tb-lift mt-2.5 p-3 first:mt-0">
      <div className="text-sm font-semibold text-slate-800">{pr.request.pack} · {pr.request.location}</div>
      <p className="mt-0.5 text-xs text-slate-600">{pr.request.goal}</p>
      <div className="mt-2 grid gap-2.5 lg:grid-cols-2">
        <ArmBlock label="Arm B (grounded)" arm={pr.armB} showItems />
        <ArmBlock label="Arm A (plain LLM)" arm={pr.armA} showItems={pr.armA.ran} />
      </div>
    </article>
  );
}

function ArmBlock({ label, arm, showItems }: {
  label: string;
  arm: ArmMetrics;
  showItems: boolean;
}) {
  return (
    <div className="tb-arm tb-status" data-st={arm.ran ? 'ok' : 'dead'}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <span className="tb-pill" data-on={arm.ran ? 'true' : 'false'}>
          {arm.ran ? 'ran' : 'did not run'}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{arm.note}</p>
      {arm.ran && (
        <div className="mt-2 space-y-2">
          <MeterBar pct={bar(arm.grounding_rate)} caption={<span>grounding_rate · <strong className="font-semibold text-slate-700">{pct(arm.grounding_rate)}</strong></span>} />
          <MeterBar pct={bar(arm.rule_compliance)} caption={<span>rule_compliance · <strong className="font-semibold text-slate-700">{pct(arm.rule_compliance)}</strong></span>} />
          <MeterBar pct={bar(arm.specificity)} caption={<span>specificity · <strong className="font-semibold text-slate-700">{pct(arm.specificity)}</strong></span>} />
        </div>
      )}
      <dl className="mt-1.5">
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
