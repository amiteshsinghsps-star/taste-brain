// Ablation Lab (F11). The measured answer to "does the taste data matter?":
// arms A-E are recomputed from one stored run, offline, and the figures are
// published exactly as computed — including when they are unflattering.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chips, Empty, MeterBar, ModeBadge, Note, Panel, Skeleton, Stat } from '@/components/common';
import { num, pct } from '@/lib/format';
import { NEEDS_RUN, useApp } from '@/lib/app-context';
import { api } from '@/lib/api';
import type { AblationResult, AblationRow } from '@/lib/types';

export default function AblationScreen() {
  const { proposal } = useApp();
  const [data, setData] = useState<{ ablation: AblationResult; headline: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Recompute is a re-run of the same request, so it bumps a counter the effect
  // watches instead of calling setState from the effect body.
  const [nonce, setNonce] = useState(0);

  const id = proposal?.proposal_id ?? '';
  useEffect(() => {
    if (!id) return;
    let alive = true;
    api.ablation(id)
      .then((r) => { if (alive) { setData(r); setError(null); } })
      .catch((e) => { if (alive) setError(String(e?.message ?? e)); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [id, nonce]);
  const reload = () => { setBusy(true); setNonce((n) => n + 1); };

  return (
    <div className="space-y-5">
      <Panel
        title="Ablation Lab — how much of this list depends on Qloo"
        description="Four alternative rankings built from the same stored rows: without the room, without the taste seeds, without Qloo at all, and with Qloo's order deliberately destroyed."
        mode={data?.ablation.source_mode}
        actions={<Button size="sm" variant="outline" onClick={reload} disabled={busy || !id}>{busy ? 'Computing…' : 'Recompute'}</Button>}
      >
        {!id ? <Empty>{NEEDS_RUN}</Empty> : error ? <Note tone="bad" title="No ablation">{error}</Note> : !data ? <Skeleton lines={5} /> : (
          <>
            <Note tone="good" title="Measured">{data.headline}</Note>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={data.ablation.k} label="k compared" hint="each arm is scored over the top-k it actually returned" />
              <Stat value={num(data.ablation.candidate_pool)} label="candidates pooled" hint="the run pooled this many candidates" />
              <Stat value={data.ablation.rows.length} label="arms computed" hint="all arms are read from the stored snapshot" />
              <Stat value={data.ablation.source_mode} label="source mode" hint="the mode stamped on the run these arms were rebuilt from" />
            </div>

            <p className="text-[11px] text-slate-500">
              Computed {data.ablation.computed_at} from run <code className="font-mono">{data.ablation.proposal_id}</code> ·
              source mode {data.ablation.source_mode} · overlap and τ are measured over each arm's own top-k, printed in the
              positions-changed line.
            </p>

            <div className="grid gap-2.5 lg:grid-cols-2">
              {data.ablation.rows.map((r) => <ArmCard key={r.arm} row={r} />)}
            </div>

            <Note tone="info" title="How to read it">
              Arm E is the control that matters: it keeps Qloo's items and shuffles their order with a fixed seed. If a
              destroyed order scored like the real one, the ranking would carry no signal. Overlap and τ are computed
              against arm A, the list the proposal actually used.
              {data.ablation.candidate_pool <= data.ablation.k && ' On this run the candidate pool is smaller than k, so every arm holds the same items and overlap@k is 100% by construction — read τ and the positions changed, not the overlap bar.'}
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

/** One arm: the bar length and every number in it are the server's own fields. */
function ArmCard({ row: r }: { row: AblationRow }) {
  const overlap = r.available ? r.overlap_at_k : null;
  const tau = r.available ? r.kendall_tau : null;
  return (
    <article className="tb-arm" data-st={r.arm === 'full' ? 'baseline' : undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="text-sm font-bold text-slate-800">{r.label}</h3>
        {r.arm === 'full' && <span className="tb-chip">the list used</span>}
        {r.arm === 'shuffled_qloo' && <span className="tb-chip">the control</span>}
        {!r.available && <span className="ml-auto text-[11px] font-medium text-amber-700">no stored rows for this arm</span>}
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{r.note}</p>

      <div className="mt-2.5">
        <MeterBar
          pct={overlap === null ? Number.NaN : overlap * 100}
          muted={r.arm !== 'full'}
          hint={`overlap@k ${pct(overlap)} against arm A`}
          caption={<span>overlap@k with the real list · <strong className="font-semibold text-slate-700">{pct(overlap)}</strong></span>}
        />
      </div>

      <dl className="mt-2.5 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-slate-400">Kendall τ</dt>
          <dd className="font-semibold tabular-nums text-slate-700">
            {tau === null ? (r.available ? 'not computable' : '—') : tau.toFixed(4)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">positions changed</dt>
          <dd className="font-semibold tabular-nums text-slate-700">
            {r.available && r.changed_in_top_k !== null && r.k_effective !== null ? `${r.changed_in_top_k} of ${r.k_effective}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">rows in arm</dt>
          <dd className="font-semibold tabular-nums text-slate-700">{num(r.arm_pool)}</dd>
        </div>
      </dl>

      {r.top_names.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-slate-50 px-2 py-1.5">
          <Chips items={r.top_names} title="the order it gives" />
        </div>
      )}
    </article>
  );
}
