// Owner approval brief (V6). The one page a person signs. Every line in it is
// the server's own text — this screen lays it out, adds a mode stamp and a
// download, and never summarises it into a new number.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, ModeBadge, Note, Panel, Time } from '@/components/common';
import { NEEDS_RUN, useApp } from '@/lib/app-context';
import { api } from '@/lib/api';
import type { ApprovalBrief } from '@/lib/types';

export default function BriefScreen() {
  const { proposal, approver, setApprover } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The brief names its approver, so it belongs to the run *and* the signature
  // it was written for: changing either retires it without a reset effect.
  const [written, setWritten] = useState<{ id: string; signee: string; brief: ApprovalBrief } | null>(null);

  const id = proposal?.proposal_id ?? '';
  const signee = approver.trim() || 'the approver on file';
  const brief = written && written.id === id && written.signee === signee ? written.brief : null;

  const load = () => {
    if (!id) return;
    setBusy(true); setError(null);
    api.brief(id, signee)
      .then((r) => { setWritten({ id, signee, brief: r.brief }); setError(null); })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setBusy(false));
  };

  const download = () => {
    if (!brief) return;
    const blob = new Blob([brief.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${brief.proposal_id}.brief.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Approval brief"
        description="Generated from the proposal, not retyped: the ask, the mode, what is approved, what was refused and what the owner still owes."
        mode={proposal?.mode}
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={busy || !id}>{busy ? 'Writing…' : brief ? 'Rewrite' : 'Write the brief'}</Button>
            {brief && <Button size="sm" variant="outline" onClick={download}>Download .txt</Button>}
          </div>
        }
      >
        {!proposal ? <Empty>{NEEDS_RUN}</Empty> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-slate-500">named approver</label>
              <Input value={approver} onChange={(e) => setApprover(e.target.value)} maxLength={80} placeholder="your name" className="w-56" />
              <span className="text-[11px] text-slate-500">used in the title and the sign-off line only; leave blank and the brief marks it "the approver on file" rather than inventing one</span>
            </div>
            {error && <Note tone="bad" title="Refused">{error}</Note>}

            {brief && (
              <article className="rounded-lg border border-slate-300 bg-white p-4">
                <header className="border-b border-slate-200 pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold tracking-tight">{brief.title}</h3>
                    <ModeBadge mode={proposal.mode} />
                    <Time iso={brief.written_at} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">proposal {brief.proposal_id} · {proposal.pack} · {proposal.location} · status {proposal.status}</p>
                </header>
                <div className="mt-3 space-y-3">
                  {brief.sections.map((s) => (
                    <section key={s.heading}>
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.heading}</h4>
                      {s.lines.length ? (
                        <ul className="mt-1 space-y-0.5">
                          {s.lines.map((l, i) => <li key={i} className="text-[13px] leading-relaxed text-slate-800">{l}</li>)}
                        </ul>
                      ) : <p className="mt-1 text-[13px] text-slate-500">Nothing to report in this section on this run.</p>}
                    </section>
                  ))}
                </div>
                <footer className="mt-4 border-t border-slate-200 pt-2 text-[12px] italic text-slate-600">{brief.sign_off}</footer>
              </article>
            )}

            {!brief && !busy && (
              <Empty>Press <strong>Write the brief</strong>. A brief is not a pitch document: it states the mode the data came in,
                the count of items the rules refused, and the terms still missing — and it says plainly that no ticket sale or
                revenue figure is predicted anywhere in this system.</Empty>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
