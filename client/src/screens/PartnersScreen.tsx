// Co-promotion partners (V5). Qloo is asked the same taste question for brands
// and places instead of artists. This is audience overlap only — it is not
// evidence that any company has agreed to anything.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chips, Empty, FetchedAt, ModeBadge, Note, Panel } from '@/components/common';
import { num } from '@/lib/format';
import { NEEDS_RUN, useApp } from '@/lib/app-context';
import { api } from '@/lib/api';
import type { PartnerResult, TasteMode } from '@/lib/types';

export default function PartnersScreen() {
  const { proposal, mode } = useApp();
  // Answered against the run it was asked for, so changing runs retires the
  // answer without an effect that clears state after the render.
  const [asked, setAsked] = useState<{ id: string; result: { partners: PartnerResult; mode: TasteMode; degrade_reason?: string | null } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = asked && asked.id === proposal?.proposal_id ? asked.result : null;

  const ask = () => {
    if (!proposal) return;
    setBusy(true); setError(null);
    const id = proposal.proposal_id;
    api.partners({ pack: proposal.pack, location: proposal.location, proposal_id: id, mode })
      .then((r) => setAsked({ id, result: { partners: r.partners, mode: r.mode, degrade_reason: r.degrade_reason } }))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setBusy(false));
  };

  const rows = data?.partners.rows ?? [];

  return (
    <div className="space-y-5">
      <Panel
        title="Co-promotion partners"
        description="A room does not sell tickets alone. Qloo is asked for the brands and places that answer to the same taste signal — same seeds, different entity type."
        mode={proposal?.mode}
        actions={<Button size="sm" onClick={ask} disabled={busy || !proposal}>{busy ? 'Asking Qloo…' : data ? 'Ask again' : 'Ask Qloo'}</Button>}
      >
        {!proposal ? <Empty>{NEEDS_RUN}</Empty> : (
          <>
            <Note tone="warn" title="What this screen is not">
              Audience overlap only. Nothing here says a company has agreed to a promotion, and no partner is invented to
              fill the screen. Contact details and terms are yours to find; the engine stops at “this entity answers to the
              same taste signal as this room’s audience”.
            </Note>

            {error && <Note tone="bad" title="Refused">{error}</Note>}

            {data && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                <ModeBadge mode={data.mode} />
                <span>{data.partners.qloo_calls_used} Qloo call(s) used</span>
                <span>generated {data.partners.generated_at}</span>
                {data.degrade_reason && <span className="text-amber-700">served differently because: {data.degrade_reason}</span>}
              </div>
            )}

            {!data && !busy && !error && <Empty>Not asked yet. Pressing Ask Qloo spends one call per entity type against the run budget — in Replay mode it reads the stored partner rows.</Empty>}

            {data && rows.length === 0 && <Empty>{data.partners.note}</Empty>}

            {data && rows.length > 0 && (
              <>
                <div className="space-y-2">
                  {data.partners.audience_tags.length > 0 && (
                    <div className="text-[11px] text-slate-500"><Chips items={data.partners.audience_tags} title="audience tags the overlap was computed against" /></div>
                  )}
                  {rows.map((r) => (
                    <article key={r.entity_id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{r.name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{r.type} · {r.variant}</span>
                        <ModeBadge mode={r.mode} />
                        <span className="ml-auto text-[11px] text-slate-500">Qloo rank {r.qloo_rank} · popularity {num(r.popularity)}</span>
                      </div>
                      {r.shared_tags.length
                        ? <div className="mt-1.5"><Chips items={r.shared_tags} title="tags shared with this room’s audience" /></div>
                        : <p className="mt-1.5 text-[11px] text-slate-500">Qloo returned no tag this entity shares with the audience portrait on this run — the overlap is the query itself, nothing more.</p>}
                      {r.explainability && <p className="mt-1.5 text-[11px] italic leading-relaxed text-slate-600">“{r.explainability}” — Qloo’s own words</p>}
                      <p className="mt-1 text-[11px] text-slate-400">{r.endpoint} · <FetchedAt iso={r.fetched_at} mode={r.mode} /></p>
                    </article>
                  ))}
                </div>
                <Note tone="info">{data.partners.note}</Note>
                {data.partners.limits.length > 0 && (
                  <Note tone="warn" title="Limits reported by the engine">
                    {data.partners.limits.map((l, i) => <div key={i}>{l}</div>)}
                  </Note>
                )}
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
