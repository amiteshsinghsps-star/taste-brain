// W1 — the do-not-trust-us Verifier page. It takes a decision export and shows
// what the same module the CLI runs computed. Nothing here is re-checked by the
// browser: the ledger hash needs node:crypto, so the recomputation happens in
// verify/verifier.ts on the server, and the CLI runs that identical file.
// No Qloo call and no external request is made by any path on this screen.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, Hash, Note, Panel, StatusPill, Time } from '@/components/common';
import { api } from '@/lib/api';
import { useApp } from '@/lib/state';
import type { DecisionExport, VerifyReport } from '@/lib/types';

export default function VerifyScreen() {
  const { proposal } = useApp();
  const [exp, setExp] = useState<DecisionExport | null>(null);
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verifyCurrent = useCallback(async () => {
    if (!proposal) return;
    setBusy(true); setError(null);
    try {
      const fetched = await api.exportDecision(proposal.proposal_id);
      setExp(fetched);
      const r = await api.verifyDecision(fetched);
      setReport(r.report);
    } catch (e) {
      setExp(null); setReport(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [proposal]);

  useEffect(() => { setReport(null); setExp(null); setError(null); }, [proposal?.proposal_id]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as DecisionExport;
      setExp(parsed);
      const r = await api.verifyDecision(parsed);
      setReport(r.report);
    } catch (e) {
      setReport(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const downloadHref = exp ? URL.createObjectURL(new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' })) : null;

  return (
    <div className="space-y-5">
      <Panel
        title="Do-not-trust-us Verifier (W1)"
        description="Recompute a decision from its exported evidence. Same module as the CLI, no Qloo key and no network call on either path."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-600">
              <span className="sr-only">Choose an export file to verify</span>
              <input
                type="file"
                accept="application/json,.json"
                className="max-w-[14rem] cursor-pointer text-xs file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            <Button size="sm" onClick={verifyCurrent} disabled={busy || !proposal}>
              {busy ? 'Verifying…' : 'Verify this run'}
            </Button>
          </div>
        }
      >
        {!proposal && <Empty>No run is loaded. The file picker above still works — verify any export, including one taken from another server.</Empty>}
        {error && <Note tone="bad" title="Verification could not run">{error}</Note>}
      </Panel>

      {exp && (
        <Panel title="What is being checked" description="The file the checks were computed over, exactly as exported.">
          <div className="grid gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-xs">
            <div className="flex justify-between gap-3"><span className="text-slate-500">schema</span><span className="font-mono">{exp.schema}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">proposal</span><span className="font-mono">{exp.provenance.proposal_id}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">room</span><span>{exp.provenance.pack} · {exp.provenance.location}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">badge on the run</span><span className="font-medium">{exp.provenance.decision_mode}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">rule set pinned to</span>{exp.rules?.pinned_version ? <Hash value={exp.rules.pinned_version} /> : <span className="text-slate-400">not stated</span>}</div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">ledger entries</span><span>{exp.ledger?.length ?? 0}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">evidence rows</span><span>{exp.evidence?.entity_ids?.length ?? 0}</span></div>
            <div className="flex justify-between gap-3"><span className="text-slate-500">exported at</span>{exp.exported_at ? <Time iso={exp.exported_at} /> : <span className="text-slate-400">no timestamp</span>}</div>
          </div>
          {downloadHref && (
            <p className="mt-2 text-xs">
              <a className="text-indigo-700 underline" href={downloadHref} download={`taste-brain-${exp.provenance.proposal_id}.json`}>
                Download this export
              </a>
              {' '}and check it yourself, away from this server:
              <code className="ml-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">npm run verify -- taste-brain-{exp.provenance.proposal_id}.json</code>
            </p>
          )}
        </Panel>
      )}

      {report && (
        <Panel
          title={report.ok ? 'PASS' : 'FAIL'}
          description={<>Every number below was recomputed from the export file, not restated from the run. Computed at <Time iso={report.ran_at} /></>}
          actions={<span className={`rounded px-2 py-1 text-sm font-semibold ${report.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{report.passed}/{report.checks.length} checks</span>}
        >
          {report.error ? (
            <Note tone="bad" title="Not a decision export">{report.error}</Note>
          ) : (
            <>
              <ul className="space-y-2.5">
                {report.checks.map((c) => (
                  <li key={c.id} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={c.status === 'pass' ? 'pass' : 'fail'}>{c.status.toUpperCase()}</StatusPill>
                      <span className="font-medium text-sm text-slate-800">{c.name}</span>
                      <span className="font-mono text-[11px] text-slate-400">{c.id}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{c.detail}</p>
                    {c.first_failing && (
                      <p className="mt-1 text-[11px] font-medium text-red-800">first failing record: {c.first_failing}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      )}

      {(exp?.honest_scope || report) && (
        <Panel title="What this proves, and what it does not" description="Stated by the export itself, not by the page.">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">It proves</h3>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-700">
                {(exp?.honest_scope.proves ?? ['the five checks above were recomputed from this file']).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900">It does not prove</h3>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-700">
                {(exp?.honest_scope.does_not_prove ?? ['without an export file, the limits cannot be stated']).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          </div>
          <Note tone="info" title="Where the arithmetic happens">
            The recomputation runs in <code className="font-mono">server/src/verify/verifier.ts</code> — the same file the CLI loads. The browser
            renders the report; it does not compute hashes, because the ledger hash uses node:crypto. To reproduce this verdict with no
            server at all, download the export and run the command above.
          </Note>
        </Panel>
      )}
    </div>
  );
}
