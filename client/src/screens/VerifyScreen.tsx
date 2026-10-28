// W1 — the do-not-trust-us Verifier page. It takes a decision export and shows
// what the same module the CLI runs computed. Nothing here is re-checked by the
// browser: the ledger hash needs node:crypto, so the recomputation happens in
// verify/verifier.ts on the server, and the CLI runs that identical file.
// No Qloo call and no external request is made by any path on this screen.

import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Hash, Note, Panel, ScoreRing, Stat, StatusPill, Time, VerdictBanner } from '@/components/common';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import type { DecisionExport, VerifyReport } from '@/lib/types';

export default function VerifyScreen() {
  const { proposal } = useApp();
  // One record per verification, tagged with what was verified: a run on this
  // server, or a file chosen from disk. Switching runs retires that run's
  // verdict without discarding a file the operator loaded themselves, which has
  // nothing to do with whichever run is active.
  const runId = proposal?.proposal_id ?? null;
  const [verified, setVerified] = useState<{ subject: string; exp: DecisionExport; report: VerifyReport | null } | null>(null);
  const shown = verified && (verified.subject.startsWith('file:') || verified.subject === `run:${runId}`) ? verified : null;
  const exp = shown?.exp ?? null;
  const report = shown?.report ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The native file picker is hidden behind a real button so it matches every
  // other action here; the input itself still owns the chosen file.
  const fileRef = useRef<HTMLInputElement>(null);

  const verifyCurrent = useCallback(async () => {
    if (!proposal) return;
    const subject = `run:${proposal.proposal_id}`;
    setBusy(true); setError(null);
    try {
      const fetched = await api.exportDecision(proposal.proposal_id);
      const r = await api.verifyDecision(fetched);
      setVerified({ subject, exp: fetched, report: r.report });
    } catch (e) {
      setVerified(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [proposal]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const subject = `file:${file.name}`;
    setBusy(true); setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as DecisionExport;
      const r = await api.verifyDecision(parsed);
      setVerified({ subject, exp: parsed, report: r.report });
    } catch (e) {
      setVerified(null);
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
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Verify an export file</Button>
            <Button size="sm" onClick={verifyCurrent} disabled={busy || !proposal}>
              {busy ? 'Verifying…' : 'Verify this run'}
            </Button>
          </div>
        }
      >
        {!shown && !error && (
          <VerdictBanner state="idle" title={proposal ? 'Not verified yet' : 'Nothing verified yet'}>
            {proposal
              ? 'Press Verify this run to pull its export and recompute every check over it — the page shows what the verifier returned, never a remembered verdict.'
              : 'Load a run and press Verify this run, or choose an export file above. The checks run on whatever is handed over, so a file produced by another server verifies here too.'}
          </VerdictBanner>
        )}
        {error && <Note tone="bad" title="Verification could not run">{error}</Note>}
      </Panel>

      {exp && (
        <Panel title="What is being checked" description="The file the checks were computed over, exactly as exported.">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Stat value={<span className="font-mono text-[13px]">{exp.provenance?.proposal_id ?? 'not stated'}</span>} label="proposal in the export" />
            <Stat value={exp.ledger?.length ?? 0} label="ledger entries carried" />
            <Stat value={exp.evidence?.entity_ids?.length ?? 0} label="evidence rows" />
            <Stat value={exp.provenance?.decision_mode ?? 'not stated'} label="badge on the run" />
          </div>
          <dl className="tb-arm grid gap-x-6 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-3 py-1"><dt className="text-slate-500">schema</dt><dd className="font-mono text-slate-800">{exp.schema}</dd></div>
            <div className="flex justify-between gap-3 py-1"><dt className="text-slate-500">room</dt><dd className="text-slate-800">{exp.provenance ? `${exp.provenance.pack} · ${exp.provenance.location}` : 'not stated'}</dd></div>
            <div className="flex justify-between gap-3 py-1"><dt className="text-slate-500">rule set pinned to</dt><dd>{exp.rules?.pinned_version ? <Hash value={exp.rules.pinned_version} /> : <span className="text-slate-400">not stated</span>}</dd></div>
            <div className="flex justify-between gap-3 py-1"><dt className="text-slate-500">exported at</dt><dd>{exp.exported_at ? <Time iso={exp.exported_at} /> : <span className="text-slate-400">no timestamp</span>}</dd></div>
          </dl>
          {downloadHref && exp.provenance?.proposal_id && (
            <p className="text-xs">
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
          title={report.error ? 'Verifier result' : `Verification ${report.ok ? 'passed' : 'failed'}`}
          description={<>Every number below was recomputed from the export file, not restated from the run. Computed at <Time iso={report.ran_at} /></>}
          actions={report.error ? undefined : (
            <div className="flex items-center gap-3">
              <span className="text-right text-[11px] leading-tight text-slate-500">
                checks that passed<br /><strong className="text-sm text-slate-800">{report.passed} of {report.checks.length}</strong>
              </span>
              <ScoreRing passed={report.passed} total={report.checks.length} ok={report.ok} />
            </div>
          )}
        >
          {report.error ? (
            <Note tone="bad" title="Not a decision export">{report.error}</Note>
          ) : (
            <>
              <VerdictBanner state={report.ok ? 'pass' : 'fail'} title={report.ok ? 'PASS — the export is internally consistent' : 'FAIL — this export does not hold together'}>
                {report.ok
                  ? 'Six recomputations agree with each other. What the page shows is what the hash-protected record says was decided.'
                  : 'At least one recomputation disagrees with the record beside it. Treat every figure on this run as unproven until the failing check below is explained.'}
              </VerdictBanner>
              <ul className="grid gap-2 xl:grid-cols-2">
                {report.checks.map((c) => (
                  <li key={c.id} className="tb-check" data-st={c.status === 'pass' ? 'pass' : 'fail'}>
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
            <div className="tb-arm tb-status" data-st="ok">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">It proves</h3>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-slate-700">
                {(exp?.honest_scope.proves ?? ['the five checks above were recomputed from this file']).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
            <div className="tb-arm tb-status" data-st="empty">
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
