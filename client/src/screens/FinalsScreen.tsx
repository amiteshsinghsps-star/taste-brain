// Finals Mode (PRD F48). On demo day the app must never depend on the network,
// so it re-serves captured runs. This screen lists the stored snapshots and, on
// request, replays one as the active proposal. No number here is computed client
// side; every figure is the server's stored value.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, ModeBadge, Note, Panel, Skeleton, Time } from '@/components/common';
import { num } from '@/lib/format';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import type { SnapshotRow, TasteMode } from '@/lib/types';

function count(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : num(n, 0);
}

export default function FinalsScreen() {
  const { proposal, adoptRun, setError, error } = useApp();
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [servingId, setServingId] = useState<string | null>(null);
  const servingRef = useRef<string | null>(null);
  const [served, setServed] = useState<string | null>(null);

  const load = useCallback(() => {
    api.snapshots()
      .then((r) => { setRows(r.snapshots); setError(null); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [setError]);

  useEffect(() => { load(); }, [load]);

  const reload = () => { setLoading(true); load(); };

  const serve = useCallback(async (row: SnapshotRow) => {
    // servingId lands a render later, so two clicks in one tick would otherwise
    // both start a run and the active proposal would end up whichever replied
    // last rather than the row that was clicked.
    if (servingRef.current) return;
    servingRef.current = row.proposal_id;
    setServingId(row.proposal_id); setServed(null); setError(null);
    try {
      const result = await api.createProposal({
        pack: row.pack,
        location: row.location,
        goal: 'Finals Mode: served from the stored run',
        mode: 'cached',
        snapshot_id: row.proposal_id,
      });
      adoptRun(result.proposal);
      setServed(result.served_from === 'snapshot'
        ? `Served ${row.proposal_id} from the stored run — served_from = snapshot. It is now the active proposal, and the pack and room selectors moved with it.`
        : `Served ${row.proposal_id}, but the engine did not mark it served_from = snapshot.`);
    } catch (e) {
      setError(String(e));
    } finally { servingRef.current = null; setServingId(null); }
  }, [adoptRun, setError]);

  return (
    <div className="space-y-5">
      <Panel
        title="Finals Mode — re-serve captured runs"
        description="On demo day the app never depends on the network. It serves runs captured earlier on this server."
      >
        <Note tone="info" title="What Finals Mode guarantees">
          <div>No Qloo call is made when a stored run is served.</div>
          <div>The rows from that run are shown exactly as they were stored.</div>
          <div>Every step keeps the mode it was captured in — nothing is upgraded to live.</div>
        </Note>
        <Note tone="warn" title="The honest limit">
          A stored run is a photograph of an earlier answer. It shows what Qloo said at that moment, not what it says now.
        </Note>
        {error && <Note tone="bad" title="The engine refused">{error}</Note>}
        {served && <Note tone="good" title="Served from the snapshot">{served}</Note>}
      </Panel>

      <Panel
        title="Stored runs"
        description="Runs captured on this server. Serving one makes it the active proposal without touching the network."
        actions={
          <div className="flex items-center gap-2">
            <span className="tb-pill">{rows.length} stored</span>
            <Button size="sm" variant="outline" onClick={reload} disabled={loading}>{loading ? 'Loading…' : 'Reload'}</Button>
          </div>
        }
      >
        {loading && <Skeleton lines={4} />}

        {!loading && !rows.length && (
          <Empty>
            There is no stored run on this server yet. Run a proposal once with the Qloo key present to capture one.
            Until then Finals Mode refuses with a clear message rather than inventing an answer.
          </Empty>
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="text-[11px] uppercase text-slate-500">
                  <th className="py-1.5 pr-2 pl-3">proposal_id</th>
                  <th className="py-1.5 pr-2">pack</th>
                  <th className="py-1.5 pr-2">location</th>
                  <th className="py-1.5 pr-2">mode</th>
                  <th className="py-1.5 pr-2">created_at</th>
                  <th className="py-1.5 pr-2">items</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const active = proposal?.proposal_id === row.proposal_id;
                  return (
                    <tr key={row.proposal_id} className={`border-t border-slate-100 align-top odd:bg-slate-50/60 ${active ? 'tb-row-active' : ''}`}>
                      <td className="py-1.5 pr-2 pl-3 font-mono text-[11px] text-slate-800">
                        {row.proposal_id}
                        {active && <span className="tb-flag">on screen now</span>}
                      </td>
                      <td className="py-1.5 pr-2">{row.pack}</td>
                      <td className="py-1.5 pr-2">{row.location}</td>
                      <td className="py-1.5 pr-2"><ModeBadge mode={row.mode as TasteMode} /></td>
                      <td className="py-1.5 pr-2"><Time iso={row.created_at} /></td>
                      <td className="py-1.5 pr-2 font-mono">{count(row.items)}</td>
                      <td className="py-1.5 text-right">
                        <Button size="sm" onClick={() => serve(row)} disabled={servingId !== null}>
                          {servingId === row.proposal_id ? 'Serving…' : 'Serve this stored run'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
