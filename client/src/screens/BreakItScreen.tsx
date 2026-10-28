// Break-it Challenge (W6). Six attack buttons, each one run by the engine
// against the defence that is meant to stop it. The verdict, the check name and
// the log entry all come from the server — this screen adds no scoring of its
// own and shows a red failure state if any defence lets an attack through.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, ModeBadge, Note, Panel, StatusPill, Time } from '@/components/common';
import { api } from '@/lib/api';
import type { AttackOutcome, BreakItReport } from '@/lib/types';

const ORDER = [
  'unsupported_item', 'entity_name_injection', 'policy_text_injection',
  'ledger_tamper', 'budget_exceeded', 'unverified_parameter',
];

function LogEntry({ entry }: { entry: Record<string, unknown> }) {
  return (
    <pre className="mt-1.5 overflow-x-auto rounded-md bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-100">
      {JSON.stringify(entry, null, 2)}
    </pre>
  );
}

function AttackCard({ a }: { a: AttackOutcome }) {
  return (
    <li className={`rounded-lg border px-3 py-2.5 ${a.blocked ? 'border-slate-200' : 'border-red-300 bg-red-50'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={a.blocked ? 'pass' : 'fail'}>{a.blocked ? 'blocked' : 'got through'}</StatusPill>
        <span className="font-mono text-[11px] text-slate-400">{a.id}</span>
      </div>
      <p className="mt-1 text-sm font-medium leading-snug text-slate-900">{a.name}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        <span className="font-medium text-slate-800">You tried:</span> {a.attempted}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        <span className="font-medium text-slate-800">Stopped by:</span> {a.defence.check}{' '}
        <span className="font-mono text-[11px] text-slate-400">{a.defence.where}</span>
      </p>
      <p className={`mt-1.5 text-sm leading-relaxed ${a.blocked ? 'text-slate-800' : 'font-medium text-red-900'}`}>{a.detail}</p>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[11px] text-slate-500">the log entry the engine wrote</summary>
        <LogEntry entry={a.log_entry} />
      </details>
    </li>
  );
}

export default function BreakItScreen() {
  const [results, setResults] = useState<Record<string, AttackOutcome>>({});
  const [board, setBoard] = useState<BreakItReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // StrictMode mounts, cleans up and mounts again, so the flag is re-armed on
  // every mount — a ref initialised once would stay false and drop every reply.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const fire = useCallback((id: string) => {
    setBusy(id);
    setError(null);
    api.breakIt(id)
      .then((r) => { if (mounted.current) setResults((prev) => ({ ...prev, [r.attack.id]: r.attack })); })
      .catch((e) => { if (mounted.current) setError(String(e)); })
      .finally(() => { if (mounted.current) setBusy(null); });
  }, []);

  const runAll = useCallback(() => {
    setBusy('all');
    setError(null);
    api.breakItAll()
      .then((r) => {
        if (!mounted.current) return;
        setBoard(r.report);
        setResults(Object.fromEntries(r.report.attacks.map((a) => [a.id, a])));
      })
      .catch((e) => { if (mounted.current) setError(String(e)); })
      .finally(() => { if (mounted.current) setBusy(null); });
  }, []);

  const tried = ORDER.filter((id) => results[id]);
  const blocked = tried.filter((id) => results[id].blocked).length;
  const leaked = tried.filter((id) => !results[id].blocked);

  return (
    <div className="space-y-5">
      {error && <Note tone="bad" title="The attack could not be run">{error}</Note>}

      <Panel
        title="Break-it Challenge (W6)"
        description="Press a button and the engine runs its real defences on the spot — not a recording of a past verdict. The data they act on is the synthetic Replay sample, so nothing here can touch a live run or spend the key. The scoreboard counts the attacks you have run this session."
        actions={(
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={runAll} disabled={busy !== null}>
              {busy === 'all' ? 'Running…' : 'Run all six'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setResults({}); setBoard(null); setError(null); }} disabled={busy !== null}>
              Clear
            </Button>
          </div>
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded px-2 py-1 text-sm ${leaked.length ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
            attacks blocked: {blocked} of {tried.length}
          </span>
          {tried.length === 0 && <span className="text-xs text-slate-500">Nothing run yet — the count stays at zero until you press something.</span>}
          {leaked.length > 0 && (
            <span className="text-xs font-medium text-red-800">
              {leaked.length} defence(s) let an attack through. That is a real failure, listed below.
            </span>
          )}
        </div>
        {board && (
          <div className="mt-3 grid gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <div className="flex flex-wrap items-center gap-2"><span><span className="font-medium text-slate-800">Sandbox:</span> {board.sandbox.basis}</span><ModeBadge mode={board.sandbox.mode} /></div>
            <div>
              <span className="font-medium text-slate-800">Ledger:</span> written {board.sandbox.real_ledger_written ? 'yes' : 'no'};
              {' '}stored chain {board.sandbox.real_ledger_still_intact === null ? 'has no entries to compare against yet' : board.sandbox.real_ledger_still_intact ? 'still verifies' : 'BROKEN — stop and look'}
            </div>
            <div>
              <span className="font-medium text-slate-800">Network:</span> {board.sandbox.network_calls_before} outbound calls before,{' '}
              {board.sandbox.network_calls_after} after — the difference is what these attacks cost.
            </div>
            <div className="flex items-center gap-1.5"><span className="font-medium text-slate-800">Reported at</span><Time iso={board.ran_at} /></div>
          </div>
        )}
        <Note tone="info" title="What this is not">
          These are the app&apos;s own deliberately-malformed inputs, run against the app&apos;s own checks. A block here proves the
          check fired; it is not a penetration test of the host, and it does not prove Qloo&apos;s data is correct.
        </Note>
      </Panel>

      <Panel title="The six attacks" description="Each button calls the real defence now. Nothing is pre-recorded; the rows it attacks are Replay data.">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ORDER.map((id) => (
            <li key={id}>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => fire(id)} disabled={busy !== null}>
                {busy === id ? 'Running…' : `Try: ${id.replace(/_/g, ' ')}`}
              </Button>
            </li>
          ))}
        </ul>
        {tried.length === 0 ? (
          <div className="mt-3"><Empty>No attack has been run in this session yet.</Empty></div>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {tried.map((id) => <AttackCard key={id} a={results[id]} />)}
          </ul>
        )}
      </Panel>

      {board && board.ok && (
        <Panel title="Verdict" description="Only shown after a full run of all six.">
          <Note tone="good" title={`All ${board.total} attacks blocked`}>
            Each refusal above names the check that produced it and the file it lives in. Recompute any of them with{' '}
            <span className="font-mono text-[11px]">npm run test</span> — the same assertions run in CI.
          </Note>
        </Panel>
      )}
      {board && !board.ok && (
        <Panel title="Verdict" description="Only shown after a full run of all six.">
          <Note tone="bad" title={`${board.blocked} of ${board.total} blocked — this build is not safe to demo`}>
            A defence failed for real. Do not paper over it: the failing attack is listed above with the check that should
            have stopped it.
          </Note>
        </Panel>
      )}
      {!board && tried.length > 0 && (
        <Panel title="Verdict" description="Not shown."><Empty>{`A full run of all six has not been done in this session — the verdict panel appears only for a complete run, so a partial set cannot be presented as a clean bill of health.`}</Empty></Panel>
      )}
    </div>
  );
}
