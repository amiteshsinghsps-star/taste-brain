// Evidence cards (F14). One card per displayed item: the exact Qloo field the
// claim rests on, where it came from, when it was fetched, and which part is
// ours rather than Qloo's.

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Chips, CountUp, Empty, FetchedAt, JsonBlock, KV, ModeBadge, Note, Panel, Stat, StatusPill } from '@/components/common';
import { num } from '@/lib/format';
import { NEEDS_RUN, useApp } from '@/lib/app-context';
import type { ProposalItem } from '@/lib/types';

export default function EvidenceScreen() {
  const { proposal } = useApp();
  const items = proposal?.items ?? [];
  const [q, setQ] = useState('');
  const shown = items.filter((i) => {
    const n = q.trim().toLowerCase();
    return !n || i.name.toLowerCase().includes(n) || i.evidence.endpoint.toLowerCase().includes(n) || i.evidence.workflow.toLowerCase().includes(n);
  });

  return (
    <div className="space-y-5">
      <Panel
        title="Evidence behind this proposal"
        description="Every card is copied from the stored result the run used. A claim with no card behind it does not appear anywhere in this app."
        mode={proposal?.mode}
      >
        {!proposal ? <Empty>{NEEDS_RUN}</Empty> : items.length === 0 ? (
          <Empty>This run returned nothing that cleared every applicable rule, so there is no evidence card to show. The refusals and their flip points are on the Plan screen.</Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={<CountUp value={items.length} />} label="evidence cards" hint="one per shown item" />
              <Stat value={<CountUp value={items.filter((i) => i.evidence.mode === 'live').length} />} label="read from Qloo now" />
              <Stat value={<CountUp value={items.filter((i) => i.evidence.mode === 'cached').length} />} label="from stored answers" />
              <Stat value={<CountUp value={proposal.rejections.length} />} label="refused, with reasons" />
            </div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter cards by name, endpoint or workflow…" className="h-8 w-72 text-xs" />
            {!shown.length ? (
              <Empty>No evidence card matches “{q}”.</Empty>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {shown.map((it) => <EvidenceCard key={it.entity_id} item={it} />)}
              </div>
            )}
          </>
        )}

        {proposal && proposal.rejections.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-red-800">Refused items keep their evidence too ({proposal.rejections.length})</div>
            {proposal.rejections.map((r) => (
              <div key={`${r.entity_id}:${r.rule_id ?? r.check}`} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-900">
                <span className="font-semibold">{r.name}</span> — {r.reason}
                <span className="text-red-700"> · refused at {r.at}</span>
              </div>
            ))}
          </div>
        )}

        {proposal?.local_lift_note && <Note tone="info">{proposal.local_lift_note}</Note>}
      </Panel>
    </div>
  );
}

function EvidenceCard({ item }: { item: ProposalItem }) {
  const e = item.evidence;
  return (
    <article className="tb-lift rounded-xl border border-slate-200 bg-white/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{item.rank}</span>
        <span className="font-semibold">{item.name}</span>
        <ModeBadge mode={e.mode} />
        <span className="ml-auto text-[10px] text-slate-400">Qloo rank {e.qloo_rank}</span>
      </div>
      <dl className="mt-2">
        <KV k="entity id" v={<code className="font-mono text-[11px]">{e.entity_id}</code>} />
        <KV k="endpoint" v={<code className="font-mono text-[11px]">{e.endpoint}</code>} />
        <KV k="workflow" v={e.workflow} />
        <KV k="fetched at" v={<FetchedAt iso={e.fetched_at} mode={e.mode} />} />
        <KV k="Qloo rank" v={`${e.qloo_rank} — Qloo's own order, nothing was re-sorted`} />
        <KV k="popularity" v={num(e.popularity)} />
        <KV k="obscurity" v={num(e.obscurity, 1)} />
        <KV k="followers" v={num(e.followers, 0)} />
        <KV k="genres" v={e.primary_genres.length ? e.primary_genres.join(', ') : 'not returned'} />
        <KV k="fit shown in the UI" v={e.fit_note} />
      </dl>
      <div className="mt-2"><Chips items={e.qloo_tags.map((t) => t.name)} title="Qloo tags" /></div>
      {e.explainability ? (
        <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] italic leading-relaxed text-slate-600">
          “{e.explainability}” — Qloo's own description of this entity
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">Qloo returned no explanation text for this entity on this run.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.rule_results.map((r) => <StatusPill key={r.rule_id} status={r.status}>{r.rule_id}: {r.status}</StatusPill>)}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
        The explanation under these fields is written for this item only. {item.approval_blocked ? 'This item is visible but cannot be approved until the missing term is entered.' : 'Every rule that could be proven on the data on file passed.'}
      </p>
      <div className="mt-2"><JsonBlock obj={e} label="raw evidence JSON" /></div>
    </article>
  );
}
