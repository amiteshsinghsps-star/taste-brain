// Quota Guardian (F41) plus the call log. This is the screen that proves the
// demo cannot burn the API key and that every network call is visible. Every
// figure is the server's own word — nothing here computes a percentage, sums a
// count or echoes anything that could be a credential.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { HealthInfo, QlooCallLogEntry, RestCallLogEntry } from '@/lib/types';
import { Empty, KV, ModeBadge, Note, Panel, Time } from '@/components/common';

const yesNo = (b: boolean) => (b ? 'yes' : 'no');

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
  const [rest, setRest] = useState<RestCallLogEntry[]>([]);
  const [qloo, setQloo] = useState<QlooCallLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api.health().then(setHealth).catch((e) => setError(String(e)));
    api.restLog().then((r) => setRest(r.log)).catch((e) => setError(String(e)));
    api.qlooLog().then((r) => setQloo(r.log)).catch((e) => setError(String(e)));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      {error && <Note tone="bad" title="Fetch failed">{error}</Note>}

      <Panel
        title="Budget and guards"
        description="Live traffic is metered per visitor and globally; a monthly floor switches live paths to Cached, then Replay. These are the server's own figures."
        actions={<Button size="sm" variant="outline" onClick={load}>Reload</Button>}
      >
        {!health ? (
          <p className="text-sm text-slate-500">Loading health…</p>
        ) : (
          <>
            <dl className="rounded-md bg-slate-50 px-2.5 py-1.5">
              <KV k="status" v={health.status} />
              <KV k="qloo key" v={health.qloo_key} />
              <KV k="finals mode" v={health.finals_mode ? 'on' : 'off'} />
              <KV k="live allowed by budget" v={yesNo(health.live_allowed)} />
              <KV k="live switched on for this host" v={yesNo(health.qloo_rest_active)} />
              <KV k="a live call can leave this box" v={yesNo(health.live_possible)} />
              <KV k="floor reached" v={yesNo(health.floor_reached)} />
              <KV k="per-run call budget" v={`${health.per_run_call_budget} Qloo calls`} />
              <KV k="harness day counter" v={`${health.harness_quota.used} of ${health.harness_quota.soft_limit} real Qloo calls ${health.harness_quota.within_limit ? '' : '(over soft limit)'}`} />
              <KV k="llm model" v={health.llm_model} />
              <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1">
                <dt className="shrink-0 text-xs text-slate-500">default mode</dt>
                <dd className="text-right">
                  {(['live', 'cached', 'replay'] as const).includes(health.default_mode)
                    ? <ModeBadge mode={health.default_mode} />
                    : <span className="text-xs font-medium text-slate-800">{health.default_mode}</span>}
                </dd>
              </div>
            </dl>

            <Note tone="info">{health.note}</Note>

            <div>
              <div className="mb-1 text-xs font-semibold text-slate-700">Budget buckets</div>
              <dl className="rounded-md bg-slate-50 px-2.5 py-1.5">
                <KV k="this visitor · hour" v={health.buckets.visitor_hour} />
                <KV k="this visitor · day" v={health.buckets.visitor_day} />
                <KV k="whole demo · day" v={health.buckets.global_day} />
                <KV k="whole month" v={health.buckets.monthly} />
              </dl>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold text-slate-700">Raw counters</div>
              <dl className="rounded-md bg-slate-50 px-2.5 py-1.5">
                <KV k="visitor_hour" v={`${health.quota.visitor_hour.used} / ${health.quota.visitor_hour.limit}`} />
                <KV k="visitor_day" v={`${health.quota.visitor_day.used} / ${health.quota.visitor_day.limit}`} />
                <KV k="global_day" v={`${health.quota.global_day.used} / ${health.quota.global_day.limit}`} />
                <KV k="monthly / floor" v={`${health.quota.monthly.used} / ${health.quota.monthly.floor}`} />
              </dl>
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Every Qloo call this session"
        description="Each live REST call and each adapter call the server made, with status, latency, mode and cache hit."
      >
        {rest.length === 0 && qloo.length === 0 ? (
          <Empty>No Qloo call has been made from this server since it started. Run a proposal in Live or Cached mode.</Empty>
        ) : (
          <>
            {rest.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-700">REST log</div>
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-[11px] uppercase text-slate-500">
                      <th className="py-1 pr-2">#</th><th className="py-1 pr-2">at</th><th className="py-1 pr-2">workflow</th>
                      <th className="py-1 pr-2">path</th><th className="py-1 pr-2">HTTP</th><th className="py-1 pr-2">entities</th>
                      <th className="py-1 pr-2">mode</th><th className="py-1 pr-2">cache</th><th className="py-1">ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rest.map((r) => (
                      <tr key={r.seq} className="border-t border-slate-100 align-top">
                        <td className="py-1 pr-2 text-slate-400">{r.seq}</td>
                        <td className="py-1 pr-2"><Time iso={r.at} /></td>
                        <td className="py-1 pr-2">{r.workflow}</td>
                        <td className="py-1 pr-2 font-mono text-[11px] text-slate-600">{r.path}</td>
                        <td className="py-1 pr-2">{r.status}</td>
                        <td className="py-1 pr-2">{r.entity_count}</td>
                        <td className="py-1 pr-2"><ModeBadge mode={r.mode} /></td>
                        <td className="py-1 pr-2">{r.cache_hit ? 'hit' : 'miss'}</td>
                        <td className="py-1">{r.latency_ms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {qloo.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-700">Adapter log</div>
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-[11px] uppercase text-slate-500">
                      <th className="py-1 pr-2">#</th><th className="py-1 pr-2">at</th><th className="py-1 pr-2">workflow</th><th className="py-1 pr-2">variant</th>
                      <th className="py-1 pr-2">endpoint</th><th className="py-1 pr-2">entities</th><th className="py-1 pr-2">mode</th>
                      <th className="py-1 pr-2">cache</th><th className="py-1 pr-2">ms</th><th className="py-1">inputs (redacted)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qloo.map((c) => (
                      <tr key={`${c.at}:${c.pack}:${c.seq}`} className="border-t border-slate-100 align-top">
                        <td className="py-1 pr-2 text-slate-400">{c.seq}</td>
                        <td className="py-1 pr-2"><Time iso={c.at} /></td>
                        <td className="py-1 pr-2">{c.workflow}<div className="text-[10px] text-slate-400">{c.pack} · {c.location}</div></td>
                        <td className="py-1 pr-2 text-slate-600">{c.variant ?? '—'}</td>
                        <td className="py-1 pr-2 font-mono text-[11px] text-slate-600">{c.endpoint ?? '—'}</td>
                        <td className="py-1 pr-2">{c.entity_count ?? 0}</td>
                        <td className="py-1 pr-2"><ModeBadge mode={c.mode} /></td>
                        <td className="py-1 pr-2">{c.cache_hit ? 'hit' : 'miss'}</td>
                        <td className="py-1 pr-2">{c.latency_ms}</td>
                        <td className="py-1 text-slate-600">{redactedInputs(c.inputs_redacted) || '—'}{c.note ? <span className="text-slate-400"> · {c.note}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
