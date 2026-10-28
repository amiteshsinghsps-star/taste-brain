// Ablation Lab (F11). The measured answer to "does the taste data matter?":
// arms A-E are recomputed from one stored run, offline, and the figures are
// published exactly as computed — including when they are unflattering.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chips, Empty, ModeBadge, Note, Panel } from '@/components/common';
import { pct } from '@/lib/format';
import { NEEDS_RUN, useApp } from '@/lib/app-context';
import { api } from '@/lib/api';
import type { AblationResult } from '@/lib/types';

export default function AblationScreen() {
  const { proposal } = useApp();
  const [data, setData] = useState<{ ablation: AblationResult; headline: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = proposal?.proposal_id ?? '';
  const load = () => {
    if (!id) return;
    setBusy(true);
    api.ablation(id).then((r) => { setData(r); setError(null); }).catch((e) => setError(String(e?.message ?? e))).finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, [id]);
  const reload = () => load();

  return (
    <div className="space-y-5">
      <Panel
        title="Ablation Lab — how much of this list depends on Qloo"
        description="Four alternative rankings built from the same stored rows: without the room, without the taste seeds, without Qloo at all, and with Qloo's order deliberately destroyed."
        mode={data?.ablation.source_mode}
        actions={<Button size="sm" variant="outline" onClick={reload} disabled={busy || !id}>{busy ? 'Computing…' : 'Recompute'}</Button>}
      >
        {!id ? <Empty>{NEEDS_RUN}</Empty> : error ? <Note tone="bad" title="No ablation">{error}</Note> : !data ? <Empty>Computing arms from the stored run…</Empty> : (
          <>
            <Note tone="good" title="Measured">{data.headline}</Note>
            <p className="text-[11px] text-slate-500">
              k = {data.ablation.k} · the run pooled {data.ablation.candidate_pool} candidate(s) · each arm is compared over the
              top-k it actually returned, printed in the positions-changed column · computed {data.ablation.computed_at} from run{' '}
              {data.ablation.proposal_id} · source mode {data.ablation.source_mode}. Zero Qloo calls: every arm reads the snapshot.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="text-[11px] uppercase text-slate-500">
                    <th className="py-1 pr-3">arm</th>
                    <th className="pr-3">rows in arm</th>
                    <th className="pr-3">overlap@k with the real list</th>
                    <th className="pr-3">Kendall τ</th>
                    <th className="pr-3">positions changed / that arm's k</th>
                    <th>the order it gives</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ablation.rows.map((r) => (
                    <tr key={r.arm} className="border-t border-slate-100 align-top">
                      <td className="py-2 pr-3">
                        <div className="font-semibold">{r.label}</div>
                        {!r.available && <span className="text-[11px] text-amber-700">no stored rows for this arm</span>}
                        <div className="mt-0.5 max-w-xs text-[11px] leading-relaxed text-slate-500">{r.note}</div>
                      </td>
                      <td className="pr-3">{r.arm_pool}</td>
                      <td className="pr-3">{r.available ? pct(r.overlap_at_k) : '—'}</td>
                      <td className="pr-3">{r.available ? (r.kendall_tau === null ? 'not computable' : r.kendall_tau.toFixed(4)) : '—'}</td>
                      <td className="pr-3">{r.available ? (r.changed_in_top_k === null || r.k_effective === null ? '—' : `${r.changed_in_top_k} of ${r.k_effective}`) : '—'}</td>
                      <td className="max-w-md"><Chips items={r.top_names} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Note tone="info" title="How to read it">
              Arm E is the control that matters: it takes Qloo's own items and shuffles the order with a fixed seed. If a
              destroyed order scored like the real one, the ranking would be carrying no signal and this app would be
              decoration. Overlap and τ are computed against arm A, the list the proposal actually used.
              {data.ablation.candidate_pool <= data.ablation.k && ' On this run the candidate pool is smaller than k, so every arm holds the same items and overlap@k is 100% by construction — read τ and the positions changed, not the overlap column.'}
            </Note>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <ModeBadge mode={data.ablation.source_mode} />
              <span>the snapshot is stored server-side; nothing on this screen came back over the network</span>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
