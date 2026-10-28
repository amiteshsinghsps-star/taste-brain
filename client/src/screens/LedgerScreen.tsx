// Decision ledger (F15). The append-only, hash-chained record of every
// proposed / decided / term / rule event. The screen shows the server's own
// chain-verification result and its own note; it adds no numbers of its own.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, Hash, Note, Panel, Time } from '@/components/common';
import { api } from '@/lib/api';
import type { LedgerEntry } from '@/lib/types';

interface VerifyResult {
  ok: boolean; length: number; head_hash: string | null;
  first_broken_seq: number | null; reason: string | null; note: string;
}

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

  const load = useCallback(() => {
    Promise.all([api.ledger(), api.verify()])
      .then(([l, v]) => { setEntries(l.entries); setTotal(typeof l.total === 'number' ? l.total : null); setVerify(v); setError(null); })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Set by the click rather than by the effect — on mount the panel has nothing
  // to wait for, and writing the flag there costs a second render.
  const reload = () => { setBusy(true); load(); };

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
      </Panel>

      <Panel
        title="Entries"
        description="Written order, oldest first on the page, so each row's prev_hash is the row above it and the chain can be followed by eye."
      >
        {!entries ? (
          <Empty>{busy ? 'Reading the ledger…' : 'The ledger has not loaded.'}</Empty>
        ) : entries.length === 0 ? (
          <Empty>
            The ledger is empty because nothing has been proposed yet. The first proposal decided on this server writes the
            first entry here.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            {total !== null && total > entries.length && (
              <p className="mb-1.5 text-[11px] text-slate-500">
                The server returns its newest {entries.length} entries; this ledger holds {total} in all.
              </p>
            )}
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-1 pr-3">seq</th>
                  <th className="py-1 pr-3">time</th>
                  <th className="py-1 pr-3">action</th>
                  <th className="py-1 pr-3">proposal</th>
                  <th className="py-1 pr-3">pack / location</th>
                  <th className="py-1 pr-3">actor</th>
                  <th className="py-1 pr-3">hash · prev</th>
                  <th className="py-1">detail</th>
                </tr>
              </thead>
              <tbody>
                {[...entries].reverse().map((e) => (
                  <tr key={e.seq} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-3 font-mono text-slate-500">{e.seq}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap"><Time iso={e.at} /></td>
                    <td className="py-1.5 pr-3 font-medium">{e.action}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-600">{e.proposal_id || '—'}</td>
                    <td className="py-1.5 pr-3">{e.pack} · {e.location}</td>
                    <td className="py-1.5 pr-3">{e.actor}</td>
                    <td className="py-1.5 pr-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1"><span className="text-[10px] text-slate-400">this</span><Hash value={e.hash} /></span>
                        <span className="flex items-center gap-1"><span className="text-[10px] text-slate-400">prev</span><Hash value={e.prev_hash} /></span>
                      </div>
                    </td>
                    <td className="py-1.5 text-[11px] leading-relaxed text-slate-600">{detailText(e.detail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-slate-500">
          The ledger is append-only: nothing here can be edited or deleted. Change any past entry and its hash stops matching
          the link its neighbours carry, so the chain breaks and verification fails — the Trust Center demonstrates exactly
          this on a copy, without touching these records.
        </p>
      </Panel>
    </div>
  );
}
