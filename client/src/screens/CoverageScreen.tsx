// Qloo Coverage Board (F49). An honest statement of which capabilities this app
// verified against the live API, which it probed and got an accepted-but-empty
// answer from, and which it does not use. Every number is the server's own —
// this screen never recounts, re-ranks or fills in a value that was not sent.

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { CapabilityRow, CoverageBoard } from '@/lib/types';
import { Chips, Empty, FilterPills, Note, Panel, Skeleton, Stat, Time } from '@/components/common';

const STATUS: Record<CapabilityRow['status'], { variant: 'success' | 'warning' | 'destructive'; spine: 'ok' | 'empty' | 'dead'; label: string }> = {
  verified: { variant: 'success', spine: 'ok', label: 'verified' },
  accepted_but_empty: { variant: 'warning', spine: 'empty', label: 'accepted but empty' },
  not_usable: { variant: 'destructive', spine: 'dead', label: 'not usable' },
};

export default function CoverageScreen() {
  const [board, setBoard] = useState<CoverageBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState('all');

  const load = () => {
    api.coverage().then((r) => { setBoard(r.board); setError(null); }).catch((e) => setError(String(e)));
  };
  useEffect(() => { load(); }, []);

  const rows = board?.rows ?? [];
  const shown = only === 'all' ? rows : rows.filter((r) => r.status === only);

  return (
    <div className="space-y-5">
      <Panel
        title="Qloo Coverage Board"
        description="Which Qloo capabilities this app actually verified against the live API. A 200 with zero rows is shown as accepted-but-empty, never as a feature."
        actions={<Button size="sm" variant="outline" onClick={load}>Reload</Button>}
      >
        {error && <Note tone="bad" title="Coverage fetch failed">{error}</Note>}
        {!board && !error && <Skeleton lines={4} />}

        {board && (
          <>
            <p className="text-[11px] text-slate-500">
              base URL <span className="font-medium text-slate-700">{board.base_url || 'not recorded'}</span>
              {' · '}verified <Time iso={board.verified_at} />
            </p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={board.counts.verified} label="verified" hint="counted from the verification record, not from the probe rows below" />
              <Stat value={board.counts.accepted_but_empty} label="accepted but empty" hint="the API answered 200 with zero rows" />
              <Stat value={board.counts.not_usable} label="not usable" hint="this app does not rely on it" />
              <Stat value={board.rows.length} label="capabilities recorded" />
            </div>

            <Note tone="info" title="Decision gate — the live smoke test that chose the vertical lead">
              <div><span className="font-semibold">Requirement:</span> {board.gate.requirement}</div>
              <div><span className="font-semibold">Result:</span> {board.gate.result}</div>
              <div>{board.gate.note}</div>
            </Note>

            {board.rows.length === 0 ? (
              <Empty>
                No capability rows are recorded on this host — there is no verification record to show. Run the
                gate on a machine holding the Qloo key to produce one.
              </Empty>
            ) : (
              <>
                <FilterPills
                  value={only}
                  onChange={setOnly}
                  options={[
                    { id: 'all', label: <>all · {board.rows.length}</> },
                    { id: 'verified', label: <>verified · {board.counts.verified}</> },
                    { id: 'accepted_but_empty', label: <>accepted but empty · {board.counts.accepted_but_empty}</> },
                    { id: 'not_usable', label: <>not usable · {board.counts.not_usable}</> },
                  ]}
                />
                <div className="mt-1 grid gap-2.5 lg:grid-cols-2">
                  {shown.map((row) => (
                    <article key={row.id} className="tb-arm tb-status" data-st={STATUS[row.status].spine}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-bold text-slate-800">{row.name}</h3>
                        <Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge>
                        <code className="ml-auto font-mono text-[11px] text-slate-500">{row.endpoint}</code>
                      </div>
                      <dl className="mt-2 grid gap-1.5 text-[11px] sm:grid-cols-2">
                        <div>
                          <dt className="text-slate-400">used by</dt>
                          <dd className="text-slate-700">{row.used_by}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-400">evidence</dt>
                          <dd className="text-slate-700">{row.evidence}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-slate-400">params</dt>
                          <dd><Chips items={row.params} /></dd>
                        </div>
                      </dl>
                      <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">live probe</div>
                        {/* print only what the probe actually returned — never a fake zero */}
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                          {row.http_status !== undefined && <span>HTTP <strong className="font-semibold tabular-nums text-slate-800">{row.http_status}</strong></span>}
                          {row.row_count !== undefined && <span>{row.row_count} row(s)</span>}
                          {row.probe_at && <span><Time iso={row.probe_at} /></span>}
                          {row.http_status === undefined && row.row_count === undefined && !row.probe_at && (
                            <span className="text-slate-400">not probed — this claim has no live row behind it on this host</span>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                {shown.length === 0 && (
                  <Empty>No capability row carries that standing — the counts above are the server’s own, so the filter cannot invent a row.</Empty>
                )}
              </>
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
