// Quota Guardian (F41) plus the call log. This is the screen that proves the
// demo cannot burn the API key and that every network call is visible. Every
// figure is the server's own word — nothing here computes a percentage, sums a
// count or echoes anything that could be a credential.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { HealthInfo, QlooCallLogEntry, RestCallLogEntry } from '@/lib/types';
import { Empty, MeterBar, ModeBadge, Note, Panel, Skeleton, Stat, Time, VerdictBanner } from '@/components/common';

const yesNo = (b: boolean) => (b ? 'yes' : 'no');

/** One metered bucket: the server's used/cap pair, drawn as a bar and printed as itself. */
function Bucket({ label, used, cap, hint }: { label: string; used: number; cap: number; hint: string }) {
  return (
    <div className="tb-arm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="font-mono text-[12px] text-slate-800">{used} / {cap}</span>
      </div>
      <div className="mt-1.5">
        <MeterBar pct={cap > 0 ? (used / cap) * 100 : 0} muted={used === 0} caption={hint} />
      </div>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// The server already redacts these inputs; we only render what it chose to show.
// The guard matters: an older server row can carry no `inputs_redacted` at all,
// and one undefined field must not take the whole screen down.
function redactedInputs(inputs: Record<string, unknown> | null | undefined): string {
  if (!inputs || typeof inputs !== 'object') return '';
  return Object.entries(inputs).map(([k, val]) => `${k}: ${formatValue(val)}`).filter((s) => !s.endsWith(': ')).join(' · ');
}

export default function BudgetScreen() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  // null means "not loaded": an empty log and a failed fetch are different facts,
  // and printing "no call has been made" for a fetch that never arrived would
  // turn a missing answer into a claim about the server.
  const [rest, setRest] = useState<RestCallLogEntry[] | null>(null);
  const [qloo, setQloo] = useState<QlooCallLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping a counter is how this screen reloads: the effect below owns the
  // fetching, so a click never writes state synchronously.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fail = (what: string) => (e: unknown) => {
      if (!cancelled) setError((prev) => (prev ? `${prev}; ${what}: ${String(e)}` : `${what}: ${String(e)}`));
    };
    // No state is written before the responses land: resetting these first would
    // render the panel twice on every fetch.
    api.health().then((r) => { if (!cancelled) setHealth(r); }).catch(fail('health'));
    api.restLog().then((r) => { if (!cancelled) setRest(r.log); }).catch(fail('REST log'));
    api.qlooLog().then((r) => { if (!cancelled) setQloo(r.log); }).catch(fail('call log'));
    return () => { cancelled = true; };
  }, [nonce]);

  const reload = () => { setError(null); setNonce((n) => n + 1); };

  return (
    <div className="space-y-5">
      {error && <Note tone="bad" title="Fetch failed">{error}</Note>}

      <Panel
        title="Budget and guards"
        description="Live calls are metered per visitor and globally. Every figure below is the server's own word."
        actions={<Button size="sm" variant="outline" onClick={reload}>Reload</Button>}
      >
        {!health ? (
          <Skeleton lines={5} />
        ) : (
          <>
            <VerdictBanner
              state={health.live_allowed ? 'pass' : health.floor_reached ? 'warn' : 'fail'}
              title={health.live_allowed
                ? 'The budget still allows live calls on this host'
                : health.floor_reached
                  ? 'The monthly floor is reached — live calls stop and stored answers serve'
                  : 'Live calls are switched off for this host — every answer is served from store'}
            >
              These are the server's own guard flags, restated: live_allowed {yesNo(health.live_allowed)} · floor_reached {yesNo(health.floor_reached)} · finals mode {health.finals_mode ? 'on' : 'off'}.
            </VerdictBanner>

            <div className="grid gap-2 sm:grid-cols-2">
              <Stat value={health.per_run_call_budget} label="Qloo calls per run" hint="one run cannot spend more than this" />
              <Stat
                value={`${health.harness_quota.used} / ${health.harness_quota.soft_limit}`}
                label="real quota the harness reports"
                hint={health.harness_quota.within_limit ? 'within the soft limit' : 'over the soft limit'}
              />
            </div>

            <div className="tb-arm flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>qloo key: <strong className="font-semibold text-slate-800">{health.qloo_key}</strong></span>
              <span title="Qloo REST traffic is switched on for this host">
                live switched on: <strong className="font-semibold text-slate-800">{yesNo(health.qloo_rest_active)}</strong>
              </span>
              <span title="Both the switch and the budget allow a request to reach Qloo">
                a live call can leave this box: <strong className="font-semibold text-slate-800">{yesNo(health.live_possible)}</strong>
              </span>
              <span>explanation writer: <strong className="font-semibold text-slate-800">{health.llm_model}</strong></span>
              <span className="flex items-center gap-1">
                default mode:{' '}
                {(['live', 'cached', 'replay'] as const).includes(health.default_mode)
                  ? <ModeBadge mode={health.default_mode} />
                  : <strong className="font-semibold text-slate-800">{health.default_mode}</strong>}
              </span>
            </div>

            <Note tone="info">{health.note}</Note>

            <div>
              <div className="mb-1 text-xs font-semibold text-slate-700">Budget buckets</div>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                <Bucket label="this visitor · hour" used={health.quota.visitor_hour.used} cap={health.quota.visitor_hour.limit} hint={health.buckets.visitor_hour} />
                <Bucket label="this visitor · day" used={health.quota.visitor_day.used} cap={health.quota.visitor_day.limit} hint={health.buckets.visitor_day} />
                <Bucket label="whole demo · day" used={health.quota.global_day.used} cap={health.quota.global_day.limit} hint={health.buckets.global_day} />
                <Bucket label="whole month" used={health.quota.monthly.used} cap={health.quota.monthly.floor} hint={`${health.buckets.monthly} — the floor is where live calls stop`} />
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Every Qloo call this session"
        description="Each live REST call and each adapter call the server made, with status, latency, mode and cache hit."
      >
        {rest === null && qloo === null ? (
          <Skeleton lines={4} />
        ) : rest?.length === 0 && qloo?.length === 0 ? (
          <Empty>No Qloo call has been made from this server since it started. Run a proposal in Live or Cached mode.</Empty>
        ) : (
          <>
            {(rest?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">REST log</span>
                  <span className="tb-pill">{rest?.length} call(s)</span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-[11px] uppercase text-slate-500">
                      <th className="py-1.5 pr-2 pl-3">#</th><th className="py-1.5 pr-2">at</th><th className="py-1.5 pr-2">workflow</th>
                      <th className="py-1.5 pr-2">path</th><th className="py-1.5 pr-2">HTTP</th><th className="py-1.5 pr-2">entities</th>
                      <th className="py-1.5 pr-2">mode</th><th className="py-1.5 pr-2">cache</th><th className="py-1.5">ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rest ?? []).map((r) => (
                      <tr key={r.seq} className="border-t border-slate-100 align-top odd:bg-slate-50/60">
                        <td className="py-1.5 pr-2 pl-3 font-mono text-slate-400">{r.seq}</td>
                        <td className="py-1.5 pr-2"><Time iso={r.at} /></td>
                        <td className="py-1.5 pr-2">{r.workflow}</td>
                        <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-600">{r.path}</td>
                        <td className="py-1.5 pr-2">{r.status}</td>
                        <td className="py-1.5 pr-2">{r.entity_count}</td>
                        <td className="py-1.5 pr-2"><ModeBadge mode={r.mode} /></td>
                        <td className="py-1.5 pr-2">{r.cache_hit ? 'hit' : 'miss'}</td>
                        <td className="py-1.5">{r.latency_ms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}

            {(qloo?.length ?? 0) > 0 && (
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">Adapter log</span>
                  <span className="tb-pill">{qloo?.length} call(s)</span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-[11px] uppercase text-slate-500">
                      <th className="py-1.5 pr-2 pl-3">#</th><th className="py-1.5 pr-2">at</th><th className="py-1.5 pr-2">workflow</th><th className="py-1.5 pr-2">variant</th>
                      <th className="py-1.5 pr-2">endpoint</th><th className="py-1.5 pr-2">entities</th><th className="py-1.5 pr-2">mode</th>
                      <th className="py-1.5 pr-2">cache</th><th className="py-1.5 pr-2">ms</th><th className="py-1.5">inputs (redacted)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(qloo ?? []).map((c) => (
                      <tr key={`${c.at}:${c.pack}:${c.seq}`} className="border-t border-slate-100 align-top odd:bg-slate-50/60">
                        <td className="py-1.5 pr-2 pl-3 font-mono text-slate-400">{c.seq}</td>
                        <td className="py-1.5 pr-2"><Time iso={c.at} /></td>
                        <td className="py-1.5 pr-2">{c.workflow}<div className="text-[10px] text-slate-400">{c.pack} · {c.location}</div></td>
                        <td className="py-1.5 pr-2 text-slate-600">{c.variant ?? '—'}</td>
                        <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-600">{c.endpoint ?? '—'}</td>
                        <td className="py-1.5 pr-2">{c.entity_count ?? 0}</td>
                        <td className="py-1.5 pr-2">{c.failed ? <span className="text-slate-500">no read</span> : <ModeBadge mode={c.mode} />}</td>
                        <td className="py-1.5 pr-2">{c.failed ? '—' : c.cache_hit ? 'hit' : 'miss'}</td>
                        <td className="py-1.5 pr-2">{c.latency_ms}</td>
                        <td className="py-1.5 text-slate-600">{redactedInputs(c.inputs_redacted) || '—'}{c.note ? <span className="text-slate-400"> · {c.note}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-[11px] leading-relaxed text-slate-500">
          Keys and response bodies are never logged or returned to the browser.
        </p>
      </Panel>
    </div>
  );
}
