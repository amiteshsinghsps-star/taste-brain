// Qloo Coverage Board (F49). An honest statement of which capabilities this app
// verified against the live API, which it probed and got an accepted-but-empty
// answer from, and which it does not use. Every number is the server's own —
// this screen never recounts, re-ranks or fills in a value that was not sent.

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { CapabilityRow, CoverageBoard } from '@/lib/types';
import { Chips, Empty, Note, Panel, Time } from '@/components/common';

const STATUS: Record<CapabilityRow['status'], { variant: 'success' | 'warning' | 'destructive'; label: string }> = {
  verified: { variant: 'success', label: 'verified' },
  accepted_but_empty: { variant: 'warning', label: 'accepted but empty' },
  not_usable: { variant: 'destructive', label: 'not usable' },
};

export default function CoverageScreen() {
  const [board, setBoard] = useState<CoverageBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.coverage().then((r) => { setBoard(r.board); setError(null); }).catch((e) => setError(String(e)));
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <Panel
        title="Qloo Coverage Board"
        description="Which Qloo capabilities this app actually verified against the live API. A 200 with zero rows is shown as accepted-but-empty, never as a feature."
        actions={<Button size="sm" variant="outline" onClick={load}>Reload</Button>}
      >
        {error && <Note tone="bad" title="Coverage fetch failed">{error}</Note>}
        {!board && !error && <p className="text-sm text-slate-500">Loading the verification record…</p>}

        {board && (
          <>
            <p className="text-[11px] text-slate-500">
              base URL <span className="font-medium text-slate-700">{board.base_url || 'not recorded'}</span>
              {' · '}verified <Time iso={board.verified_at} />
            </p>

            <Note tone="info" title="Decision gate — the live smoke test that chose the vertical lead">
              <div><span className="font-semibold">Requirement:</span> {board.gate.requirement}</div>
              <div><span className="font-semibold">Result:</span> {board.gate.result}</div>
              <div>{board.gate.note}</div>
            </Note>

            <div className="flex flex-wrap gap-2">
              <Badge variant="success">verified: {board.counts.verified}</Badge>
              <Badge variant="warning">accepted but empty: {board.counts.accepted_but_empty}</Badge>
              <Badge variant="destructive">not usable: {board.counts.not_usable}</Badge>
            </div>

            {board.rows.length === 0 ? (
              <Empty>
                No capability rows are recorded on this host — there is no verification record to show. Run the
                gate on a machine holding the Qloo key to produce one.
              </Empty>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="text-[11px] uppercase text-slate-500">
                    <th className="py-1 pr-2">capability</th>
                    <th className="py-1 pr-2">endpoint</th>
                    <th className="py-1 pr-2">status</th>
                    <th className="py-1 pr-2">used by</th>
                    <th className="py-1 pr-2">params</th>
                    <th className="py-1 pr-2">evidence</th>
                    <th className="py-1">live probe</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="py-2 pr-2 font-medium text-slate-800">{row.name}</td>
                      <td className="py-2 pr-2 font-mono text-[11px] text-slate-600">{row.endpoint}</td>
                      <td className="py-2 pr-2"><Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge></td>
                      <td className="py-2 pr-2 text-slate-600">{row.used_by}</td>
                      <td className="py-2 pr-2"><Chips items={row.params} /></td>
                      <td className="py-2 pr-2 text-slate-600">{row.evidence}</td>
                      <td className="py-2 text-slate-500">
                        {/* print only what the probe actually returned — never a fake zero */}
                        {row.http_status !== undefined && <div>HTTP {row.http_status}</div>}
                        {row.row_count !== undefined && <div>{row.row_count} row(s)</div>}
                        {row.probe_at && <div><Time iso={row.probe_at} /></div>}
                        {row.http_status === undefined && row.row_count === undefined && !row.probe_at && (
                          <span className="text-slate-400">not probed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Panel>

      {board && (board.field_notes.length > 0 || board.method) && (
        <Panel title="Field notes and method">
          {board.field_notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-slate-700">
              {board.field_notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
          {board.method && <p className="text-[11px] leading-relaxed text-slate-500">{board.method}</p>}
        </Panel>
      )}
    </div>
  );
}
