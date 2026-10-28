// Co-promotion partners (V5). Qloo is asked the same taste question for brands
// and places instead of artists. This is audience overlap only — it is not
// evidence that any company has agreed to anything.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chips, Empty, FetchedAt, MeterBar, ModeBadge, Note, Panel, Stat } from '@/components/common';
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
              These are audience-overlap matches only. Nothing here means a company has agreed to a promotion, and no partner
              is added to fill the screen — the engine stops at “this entity answers to the same taste signal as this room’s audience”.
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

            {!data && !busy && !error && <Empty>Not asked yet. “Ask Qloo” spends one call per entity type against the run budget.</Empty>}

            {data && rows.length === 0 && <Empty>{data.partners.note}</Empty>}

            {data && rows.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat value={rows.length} label="partners returned" hint="rows the engine sent back for this room" />
                  <Stat value={data.partners.qloo_calls_used} label="Qloo calls used" hint="counted against the run budget and written to the call log" />
                  <Stat value={data.partners.audience_tags.length} label="audience tags compared" hint="the portrait the overlap was computed against" />
                </div>
                <div className="space-y-2">
                  {data.partners.audience_tags.length > 0 && (
                    <div className="text-[11px] text-slate-500"><Chips items={data.partners.audience_tags} title="audience tags the overlap was computed against" /></div>
                  )}
                  <div className="grid gap-2.5 lg:grid-cols-2">
                    {rows.map((r) => (
                      <article key={r.entity_id} className="tb-arm tb-lift tb-status" data-st={r.shared_tags.length ? 'ok' : 'empty'}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`tb-medal flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${r.qloo_rank === 1 ? 'tb-medal-gold' : r.qloo_rank === 2 ? 'tb-medal-silver' : r.qloo_rank === 3 ? 'tb-medal-bronze' : ''}`} title="Qloo's own order">{r.qloo_rank}</span>
                          <span className="text-sm font-bold text-slate-800">{r.name}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{r.type} · {r.variant}</span>
                          <ModeBadge mode={r.mode} />
                        </div>
                        <div className="mt-2">
                          <MeterBar
                            pct={typeof r.popularity === 'number' && Number.isFinite(r.popularity) ? r.popularity * 100 : Number.NaN}
                            caption={<span>Qloo popularity · <strong className="font-semibold text-slate-700">{num(r.popularity)}</strong></span>}
                          />
                        </div>
                        {r.shared_tags.length
                          ? <div className="mt-1.5"><Chips items={r.shared_tags} title="tags shared with this room’s audience" /></div>
                          : <p className="mt-1.5 text-[11px] text-slate-500">Qloo returned no tag this entity shares with the audience portrait on this run — the overlap is the query itself, nothing more.</p>}
                        {r.explainability && <p className="mt-1.5 text-[11px] italic leading-relaxed text-slate-600">“{r.explainability}” — Qloo’s own words</p>}
                        <p className="mt-1 text-[11px] text-slate-400">{r.endpoint} · <FetchedAt iso={r.fetched_at} mode={r.mode} /></p>
                      </article>
                    ))}
                  </div>
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
