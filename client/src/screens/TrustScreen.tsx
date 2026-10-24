// Trust Center (F47). The engine states, in its own words, which guardrails
// passed, which failed and which it could not prove. Every number here is the
// server's — the client only renders report.passed / failed / unproven and the
// arrays it was given; nothing is recounted locally.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chips, Empty, Hash, Note, Panel, StatusPill, Time } from '@/components/common';
import { api } from '@/lib/api';
import type { TrustCheck, TrustReport } from '@/lib/types';

function CheckPill({ status }: { status: TrustCheck['status'] }) {
  const asRule = status === 'fail' ? 'fail' : status === 'pass' ? 'pass' : 'needs_data';
  return <StatusPill status={asRule}>{status}</StatusPill>;
}

export default function TrustScreen() {
  const [report, setReport] = useState<TrustReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    setError(null);
    api.trust()
      .then((r) => setReport(r.report))
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      {error && <Note tone="bad" title="The trust report could not be read">{error}</Note>}

      {report && (
        <Panel
          title="Trust Center (F47)"
          description={<span className="flex items-center gap-2">Report generated at <Time iso={report.generated_at} /></span>}
          actions={<Button size="sm" variant="outline" onClick={load} disabled={busy}>{busy ? 'Reloading…' : 'Reload'}</Button>}
        >
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">pass · {report.passed}</span>
            <span className="rounded bg-red-50 px-2 py-1 text-red-800">fail · {report.failed}</span>
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">unproven · {report.unproven}</span>
          </div>
          {report.proposal_id === null && (
            <Note tone="warn" title="No run to check against yet">
              The checks run against the most recent stored run; there is none yet on this server. The counts and results below
              reflect that — several guardrails are marked unproven until a proposal exists.
            </Note>
          )}
        </Panel>
      )}

      {report && (
        <Panel
          title={`The ${report.checks.length} checks`}
          description="Each guardrail either passes on the current data, reports its own failure, or says it could not be proven."
        >
          {report.checks.length === 0 ? (
            <Empty>The server returned no checks.</Empty>
          ) : (
            <ul className="space-y-2.5">
              {report.checks.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 px-3 py-2">
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
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={report.ledger.ok ? 'rounded bg-emerald-50 px-2 py-1 text-emerald-800' : 'rounded bg-red-50 px-2 py-1 text-red-800'}>
              chain {report.ledger.ok ? 'intact' : 'broken'}
            </span>
            <span className="text-slate-600">{report.ledger.length} entr{report.ledger.length === 1 ? 'y' : 'ies'} read</span>
            {report.ledger.head_hash && <span className="flex items-center gap-1 text-slate-600">head <Hash value={report.ledger.head_hash} /></span>}
          </div>
          {!report.ledger.ok && report.ledger.first_broken_seq !== null && (
            <Note tone="bad" title={`First broken entry: ${report.ledger.first_broken_seq}`}>{report.ledger.reason}</Note>
          )}
          {report.ledger.length === 0 ? (
            <Empty>No decision has been written yet, so there is no chain to display. Approve or reject a proposal and the first linked entry appears here.</Empty>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-2">seq</th><th className="py-1 pr-2">at</th><th className="py-1 pr-2">action</th>
                  <th className="py-1 pr-2">proposal</th><th className="py-1 pr-2">pack · room</th><th className="py-1 pr-2">actor</th><th className="py-1">hash</th>
                </tr>
              </thead>
              <tbody>
                {report.ledger.entries.map((e) => (
                  <tr key={e.seq} className="border-t border-slate-100 align-top">
                    <td className="py-1 pr-2 text-slate-400">{e.seq}</td>
                    <td className="py-1 pr-2"><Time iso={e.at} /></td>
                    <td className="py-1 pr-2 font-medium text-slate-800">{e.action}</td>
                    <td className="py-1 pr-2 font-mono text-[11px] text-slate-600">{e.proposal_id}</td>
                    <td className="py-1 pr-2 text-slate-600">{e.pack} · {e.location}</td>
                    <td className="py-1 pr-2 text-slate-600">{e.actor}</td>
                    <td className="py-1"><Hash value={e.hash} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {report && (
        <Panel title="Tamper demonstration" description="Run on an in-memory copy of the last entry. The real ledger was not modified.">
          <div className="grid gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-xs">
            <div className="flex justify-between gap-3"><span className="text-slate-500">field changed</span><span className="font-medium text-slate-800">{report.tamper_demo.changed_field}</span></div>
            <div className="flex items-center justify-between gap-3"><span className="text-slate-500">stored hash</span>{report.tamper_demo.stored_hash ? <Hash value={report.tamper_demo.stored_hash} /> : <span className="text-slate-400">no entry to forge</span>}</div>
            <div className="flex items-center justify-between gap-3"><span className="text-slate-500">recomputed hash</span>{report.tamper_demo.recomputed_hash ? <Hash value={report.tamper_demo.recomputed_hash} /> : <span className="text-slate-400">no entry to forge</span>}</div>
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
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-3">probe (text)</th>
                  <th className="py-1">outcome</th>
                </tr>
              </thead>
              <tbody>
                {report.probes.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-700">{p.probe}</td>
                    <td className="py-1.5 text-slate-600">{p.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {report && (
        <Panel title="Parameter allowlist" description="Only these Qloo parameters are permitted per endpoint.">
          {report.allowlist.length === 0 ? (
            <Empty>The server returned no allowlisted endpoints.</Empty>
          ) : (
            <ul className="space-y-2">
              {report.allowlist.map((a) => (
                <li key={a.endpoint} className="rounded-md border border-slate-200 px-3 py-2">
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
                <div key={i} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <Time iso={v.at} />
                    <span className="font-mono">{v.endpoint}</span>
                    <span className="font-semibold">{v.param}</span>
                  </div>
                  <div>{v.detail}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {report && (
        <Panel title="Capability coverage" description="Counts of Qloo capabilities verified against this key, as reported by the coverage board.">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-800">verified · {report.coverage.verified}</span>
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-900">accepted but empty · {report.coverage.accepted_but_empty}</span>
            <span className="rounded bg-red-50 px-2 py-1 text-red-800">not usable · {report.coverage.not_usable}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">verified at <Time iso={report.coverage.verified_at} /></div>
        </Panel>
      )}

      {!report && !error && (
        <Panel title="Trust Center (F47)" description="Loading the report.">
          <Empty>Reading the trust report…</Empty>
        </Panel>
      )}
    </div>
  );
}
