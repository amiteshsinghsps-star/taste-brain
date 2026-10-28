// Trust Center (F47). The engine states, in its own words, which guardrails
// passed, which failed and which it could not prove. Every number here is the
// server's — the client only renders report.passed / failed / unproven and the
// arrays it was given; nothing is recounted locally.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chips, Empty, FilterPills, Hash, Note, Panel, ScoreRing, Skeleton, Stat, StatusPill, Time, VerdictBanner } from '@/components/common';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import type { TrustCheck, TrustReport } from '@/lib/types';

function CheckPill({ status }: { status: TrustCheck['status'] }) {
  const asRule = status === 'fail' ? 'fail' : status === 'pass' ? 'pass' : 'needs_data';
  return <StatusPill status={asRule}>{status}</StatusPill>;
}

// The card edge carries the check's own status; nothing here is inferred from it.
const SPINE: Record<TrustCheck['status'], 'ok' | 'dead' | 'empty'> = { pass: 'ok', fail: 'dead', unproven: 'empty' };

export default function TrustScreen() {
  const { proposal } = useApp();
  const [report, setReport] = useState<TrustReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState('all');

  const load = useCallback(() => {
    api.trust()
      .then((r) => { setReport(r.report); setError(null); })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // The busy flag is set by the click, not by the effect: on mount there is
  // nothing to wait for yet, and setting it there re-renders the panel twice.
  const reload = () => { setBusy(true); load(); };

  const counts = useMemo(() => {
    const c = { all: 0, pass: 0, fail: 0, unproven: 0 };
    for (const k of report?.checks ?? []) {
      c.all += 1;
      c[k.status] += 1;
    }
    return c;
  }, [report]);
  const shown = (report?.checks ?? []).filter((c) => only === 'all' || c.status === only);

  return (
    <div className="space-y-5">
      {error && <Note tone="bad" title="The trust report could not be read">{error}</Note>}

      {report && (
        <Panel
          title="Trust Center"
          description={<span className="flex items-center gap-2">Report generated at <Time iso={report.generated_at} /></span>}
          actions={<Button size="sm" variant="outline" onClick={reload} disabled={busy}>{busy ? 'Reloading…' : 'Reload'}</Button>}
        >
          <div className="flex flex-wrap items-start gap-4">
            <ScoreRing passed={report.passed} total={report.checks.length} ok={report.failed === 0} />
            <div className="min-w-0 flex-1 space-y-2">
              <VerdictBanner
                state={report.failed > 0 ? 'fail' : report.unproven > 0 ? 'warn' : 'pass'}
                title={
                  report.failed > 0 ? `${report.failed} guardrail(s) failed on this data`
                    : report.unproven > 0 ? `No failures — ${report.unproven} guardrail(s) could not be proven`
                    : 'Every guardrail the engine could test, it passed'
                }
              >
                The counts are the report's own: {report.passed} passed, {report.failed} failed, {report.unproven} unproven out of {report.checks.length} checks.
              </VerdictBanner>
              <div className="grid gap-2 sm:grid-cols-3">
                <Stat value={report.passed} label="passed" hint="the report's own passed count" />
                <Stat value={report.failed} label="failed" hint="the report's own failed count" />
                <Stat value={report.unproven} label="unproven" hint="checks that say they could not be proven on this data" />
              </div>
            </div>
          </div>
          {report.proposal_id === null ? (
            <Note tone="warn" title="No run to check against yet">
              The checks run against the most recent stored run; there is none yet on this server. The counts and results below
              reflect that — several guardrails are marked unproven until a proposal exists.
            </Note>
          ) : (
            <div className="mt-2 text-[11px] text-slate-500">
              These checks were run against the newest stored run: <code className="font-mono">{report.proposal_id}</code>.
            </div>
          )}
          {report.proposal_id !== null && proposal && proposal.proposal_id !== report.proposal_id && (
            <Note tone="warn" title="Not the run on your other screens">
              The run open elsewhere ({proposal.proposal_id}) is not the one this report audited. The checks describe
              {report.proposal_id} — open the run named above before quoting them.
            </Note>
          )}
        </Panel>
      )}

      {report && (
        <Panel
          title={`The ${report.checks.length} checks`}
          description="Each guardrail either passes on the current data, reports its own failure, or says it could not be proven."
          actions={report.checks.length > 0 && (
            <FilterPills
              value={only}
              onChange={setOnly}
              options={[
                { id: 'all', label: `all · ${counts.all}` },
                { id: 'pass', label: `pass · ${counts.pass}` },
                { id: 'fail', label: `fail · ${counts.fail}` },
                { id: 'unproven', label: `unproven · ${counts.unproven}` },
              ]}
            />
          )}
        >
          {report.checks.length === 0 ? (
            <Empty>The server returned no checks.</Empty>
          ) : shown.length === 0 ? (
            <Empty>No check carries that status on this report.</Empty>
          ) : (
            <ul className="grid gap-2.5 xl:grid-cols-2">
              {shown.map((c) => (
                <li key={c.id} className="tb-arm tb-status" data-st={SPINE[c.status]}>
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckPill status={c.status} />
                    <span className="font-mono text-[11px] text-slate-400">{c.id}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-800">{c.claim}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{c.evidence}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {report && (
        <Panel title="Ledger chain" description="The stored entries behind the hash chain, with the chain's own verdict. Nothing on this screen writes to the ledger.">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={report.ledger.ok ? 'pass' : 'fail'} title={report.ledger.reason ?? 'the chain walked clean'}>
              chain {report.ledger.ok ? 'intact' : 'broken'}
            </StatusPill>
            <div className="grid flex-1 gap-2 sm:grid-cols-3">
              <Stat value={report.ledger.length} label={report.ledger.length === 1 ? 'entry read' : 'entries read'} hint="how far the chain was walked" />
              <Stat value={<span className="text-[13px]">{report.ledger.head_hash ? <Hash value={report.ledger.head_hash} /> : 'no head yet'}</span>} label="head of the chain" />
              <Stat
                value={report.ledger.first_broken_seq === null ? 'none' : report.ledger.first_broken_seq}
                label="first broken entry"
                hint={report.ledger.reason ?? 'the chain reported no break'}
              />
            </div>
          </div>
          {!report.ledger.ok && report.ledger.first_broken_seq !== null && (
            <Note tone="bad" title={`First broken entry: ${report.ledger.first_broken_seq}`}>{report.ledger.reason}</Note>
          )}
          {report.ledger.length === 0 ? (
            <Empty>No decision has been written yet, so there is no chain to display. Approve or reject a proposal and the first linked entry appears here.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-2 pl-3">seq</th><th className="py-1.5 pr-2">at</th><th className="py-1.5 pr-2">action</th>
                    <th className="py-1.5 pr-2">proposal</th><th className="py-1.5 pr-2">pack · room</th><th className="py-1.5 pr-2">actor</th><th className="py-1.5">hash</th>
                  </tr>
                </thead>
                <tbody>
                  {report.ledger.entries.map((e) => (
                    <tr key={e.seq} className="border-t border-slate-100 align-top odd:bg-slate-50/60">
                      <td className="py-1.5 pr-2 pl-3 font-mono text-slate-400">{e.seq}</td>
                      <td className="py-1.5 pr-2"><Time iso={e.at} /></td>
                      <td className="py-1.5 pr-2 font-medium text-slate-800">{e.action}</td>
                      <td className="py-1.5 pr-2 font-mono text-[11px] text-slate-600">{e.proposal_id}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{e.pack} · {e.location}</td>
                      <td className="py-1.5 pr-2 text-slate-600">{e.actor}</td>
                      <td className="py-1.5"><Hash value={e.hash} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {report && (
        <Panel title="Tamper demonstration" description="Run on an in-memory copy of the last entry. The real ledger was not modified.">
          <div className="tb-arm grid gap-1.5 text-xs sm:grid-cols-3">
            <div><div className="text-slate-500">field changed</div><div className="font-medium text-slate-800">{report.tamper_demo.changed_field}</div></div>
            <div><div className="text-slate-500">stored hash</div><div className="mt-0.5">{report.tamper_demo.stored_hash ? <Hash value={report.tamper_demo.stored_hash} /> : <span className="text-slate-400">no entry to forge</span>}</div></div>
            <div><div className="text-slate-500">recomputed hash</div><div className="mt-0.5">{report.tamper_demo.recomputed_hash ? <Hash value={report.tamper_demo.recomputed_hash} /> : <span className="text-slate-400">no entry to forge</span>}</div></div>
          </div>
          {report.tamper_demo.detected
            ? <Note tone="good" title="Detected">The forged copy no longer hashes to the stored value, so the edit is detected. The stored entry is untouched — only a copy in memory was altered.</Note>
            : <Note tone="warn" title="Nothing to detect">There is no ledger entry to forge yet, so this run reports no demonstration. The stored ledger is never edited either way.</Note>}
        </Panel>
      )}

      {report && (
        <Panel title="Injection probes" description="The app's own deliberately-malformed test inputs, shown as text. React renders them literally — nothing here is interpreted.">
          {report.probes.length === 0 ? (
            <Empty>The server ran no probes.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1.5 pr-3 pl-3">probe (text)</th>
                    <th className="py-1.5">outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {report.probes.map((p, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top odd:bg-slate-50/60">
                      <td className="py-1.5 pr-3 pl-3 font-mono text-[11px] text-slate-700">{p.probe}</td>
                      <td className="py-1.5 text-slate-600">{p.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {report && (
        <Panel title="Parameter allowlist" description="Only these Qloo parameters are permitted per endpoint.">
          {report.allowlist.length === 0 ? (
            <Empty>The server returned no allowlisted endpoints.</Empty>
          ) : (
            <ul className="grid gap-2.5 lg:grid-cols-2">
              {report.allowlist.map((a) => (
                <li key={a.endpoint} className="tb-arm">
                  <div className="font-mono text-[11px] text-slate-700">{a.endpoint}</div>
                  {a.params.length
                    ? <div className="mt-1"><Chips items={a.params} title="allowed" /></div>
                    : <div className="mt-1 text-[11px] text-slate-500">no parameters allowed on this endpoint</div>}
                </li>
              ))}
            </ul>
          )}
          {report.violations.length === 0 ? (
            <Note tone="good" title="No violations logged">No unverified parameter has been refused on this host yet.</Note>
          ) : (
            <div className="space-y-1.5">
              <Note tone="warn" title="Refused before sending">An unverified parameter is refused here, before it is ever sent to Qloo.</Note>
              {report.violations.map((v, i) => (
                <div key={i} className="tb-arm tb-status" data-st="dead">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-red-900">
                    <Time iso={v.at} />
                    <span className="font-mono">{v.endpoint}</span>
                    <span className="font-semibold">{v.param}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-red-900">{v.detail}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {report && (
        <Panel title="Capability coverage" description="Counts of Qloo capabilities verified against this key, as reported by the coverage board.">
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat value={report.coverage.verified} label="verified against this key" />
            <Stat value={report.coverage.accepted_but_empty} label="accepted but empty" />
            <Stat value={report.coverage.not_usable} label="not usable" />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">verified at <Time iso={report.coverage.verified_at} /></div>
        </Panel>
      )}

      {!report && !error && (
        <Panel title="Trust Center" description="Loading the report.">
          <Skeleton lines={5} />
        </Panel>
      )}
    </div>
  );
}
