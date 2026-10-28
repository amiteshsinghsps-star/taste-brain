// Decision ledger (F15). The append-only, hash-chained record of every
// proposed / decided / term / rule event. The screen shows the server's own
// chain-verification result and its own note; it adds no numbers of its own.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, FilterPills, Hash, JsonBlock, Note, Panel, Skeleton, Time } from '@/components/common';
import { api } from '@/lib/api';
import type { LedgerEntry } from '@/lib/types';

interface VerifyResult {
  ok: boolean; length: number; head_hash: string | null;
  first_broken_seq: number | null; reason: string | null; note: string;
  keyed: boolean; keyless_entries: number; keyless_note: string;
}

/** The server clamps its own read to 1..300 entries; these are its ceiling and a few steps under it. */
const LIMITS = [25, 50, 100, 300] as const;

const ACTION_TONE: Record<string, string> = {
  proposed: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  decided: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-800',
  terms: 'border-amber-200 bg-amber-50 text-amber-900',
  rule_change: 'border-sky-200 bg-sky-50 text-sky-800',
};

function fmtVal(v: unknown): string {
  if (Array.isArray(v)) {
    return v
      .map((x) => (x && typeof x === 'object' ? String((x as { name?: unknown }).name ?? JSON.stringify(x)) : String(x)))
      .join(', ');
  }
  if (v && typeof v === 'object') return JSON.stringify(v);
  return JSON.stringify(v ?? null);
}

function detailText(detail: Record<string, unknown> | null | undefined): string {
  if (!detail || typeof detail !== 'object') return 'no detail recorded';
  const keys = Object.keys(detail);
  if (!keys.length) return 'no detail recorded';
  return keys.map((k) => `${k}: ${fmtVal(detail[k])}`).join('  ·  ');
}

export default function LedgerScreen() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState<number>(50);
  const [newestFirst, setNewestFirst] = useState(true);
  const [only, setOnly] = useState('all');

  const load = useCallback(() => {
    Promise.all([api.ledger(limit), api.verify()])
      .then(([l, v]) => {
        setEntries(l.entries);
        setTotal(typeof l.total === 'number' ? l.total : null);
        setLimit(l.limit);
        setVerify(v);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  // Set by the click rather than by the effect — on mount the panel has nothing
  // to wait for, and writing the flag there costs a second render.
  const reload = () => { setBusy(true); load(); };

  const actionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries ?? []) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const shown = useMemo(() => {
    const list = entries ?? [];
    const filtered = only === 'all' ? list : list.filter((e) => e.action === only);
    return newestFirst ? [...filtered].reverse() : filtered;
  }, [entries, only, newestFirst]);

  // The head is whichever entry's hash the server named as the chain head — not
  // simply the newest row on the page, which may be a bounded read's newest.
  const headSeq = entries?.find((e) => e.hash === verify?.head_hash)?.seq;

  return (
    <div className="space-y-5">
      {error && <Note tone="bad" title="The ledger could not be read">{error}</Note>}

      <Panel
        title="Decision ledger"
        description="Every proposal, decision, term and rule change is written here once, chained by hash to the entry before it."
        actions={<Button size="sm" variant="outline" onClick={reload} disabled={busy}>{busy ? 'Reloading…' : 'Reload'}</Button>}
      >
        {verify && (
          verify.ok
            ? (
              <Note tone="good" title="Chain verified">
                <div>{verify.note}.</div>
                {verify.head_hash && <div className="mt-1 flex items-center gap-2">head hash <Hash value={verify.head_hash} /></div>}
                {/* The server's own sentence about how strong that chain is. */}
                <div className="mt-1 text-[11px] text-slate-600">{verify.keyless_note}</div>
              </Note>
            )
            : (
              <Note tone="bad" title="Chain broken">
                <div>{verify.note}.</div>
                <div>First broken at seq <strong>{verify.first_broken_seq ?? '—'}</strong>.</div>
                {verify.reason && <div>Reason: {verify.reason}</div>}
              </Note>
            )
        )}
        {verify && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${verify.keyed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
              {verify.keyed ? 'keyed chain (HMAC)' : 'unkeyed chain (sha256)'}
            </span>
            <span className="text-[10px] text-slate-500">
              {verify.keyed
                ? 'new entries are hashed with a key only this host holds'
                : 'a key only this host holds, or a head hash published elsewhere, is what would stop the whole file being rewritten'}
            </span>
          </div>
        )}
      </Panel>

      <Panel
        title="Entries"
        description={newestFirst
          ? 'Newest first on the page. Every entry carries the previous entry’s hash as prev_hash — switch to oldest first to follow those links downward by eye.'
          : 'Written order, oldest first on the page, so each entry’s prev_hash is the entry above it and the chain can be followed by eye.'}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1 text-[11px] text-slate-500">
              read back
              <select
                value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                className="cursor-pointer rounded-lg border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
                title="How many of the newest entries the server lists (its own ceiling is 300)"
              >
                {LIMITS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              entries
            </label>
            <Button size="sm" variant="outline" onClick={() => setNewestFirst((v) => !v)}>
              {newestFirst ? 'show oldest first' : 'show newest first'}
            </Button>
          </div>
        }
      >
        {!entries ? (
          busy ? <Skeleton lines={5} /> : <Empty>The ledger has not loaded.</Empty>
        ) : entries.length === 0 ? (
          <Empty>
            The ledger is empty because nothing has been proposed yet. The first proposal decided on this server writes the
            first entry here.
          </Empty>
        ) : (
          <>
            {total !== null && total > entries.length && (
              <Note tone="info">
                The server listed its newest {entries.length} of {total} entries. Verification reads the whole chain, so the
                verdict above covers entries that are not on this page.
              </Note>
            )}
            <FilterPills
              value={only}
              onChange={setOnly}
              options={[
                { id: 'all', label: <>all · {entries.length}</> },
                ...actionCounts.map(([a, n]) => ({ id: a, label: <>{a} · {n}</> })),
              ]}
            />
            {!shown.length ? (
              <Empty>No entry in this read carries the action “{only}”.</Empty>
            ) : (
              <ol className="tb-chain">
                {shown.map((e) => (
                  <li key={e.seq} className="tb-block">
                    <span className="tb-node" aria-hidden />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-500">#{e.seq}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ACTION_TONE[e.action] ?? 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                        {e.action}
                      </span>
                      {e.seq === headSeq && (
                        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white" title="This entry’s hash is the head hash the verifier reported">
                          chain head
                        </span>
                      )}
                      <span className="text-sm font-medium">{e.actor}</span>
                      <span className="text-[11px] text-slate-500">{e.pack} · {e.location}</span>
                      <Time iso={e.at} />
                    </div>
                    {e.proposal_id && <div className="mt-0.5 font-mono text-[11px] text-slate-500">{e.proposal_id}</div>}
                    <div className="mt-1 max-w-4xl text-[11px] leading-relaxed text-slate-600">{detailText(e.detail)}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">this <Hash value={e.hash} /></span>
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">prev <Hash value={e.prev_hash} /></span>
                    </div>
                    <div className="mt-1.5"><JsonBlock obj={e} label="raw entry JSON" /></div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}

        <p className="text-[11px] leading-relaxed text-slate-500">
          The ledger is append-only: nothing here edits or deletes a past entry. Change one and its hash stops matching the
          link its neighbours carry, so the chain breaks and verification fails — the Trust Center demonstrates exactly this
          on a copy, without touching these records. What a recomputed chain does not prove is that the file is the only
          version of itself; that takes the key or the published head hash named above.
        </p>
      </Panel>
    </div>
  );
}
