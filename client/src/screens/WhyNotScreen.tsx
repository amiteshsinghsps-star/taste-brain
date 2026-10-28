// Why-not (F12). An operator asks about a name that is not on the list, and the
// engine answers from the stored run: it either names the rule that refused it,
// the term that is missing, or says plainly that Qloo never returned it.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, Note, Panel, Skeleton, VerdictBanner } from '@/components/common';
import { NEEDS_RUN, useApp } from '@/lib/app-context';
import { api } from '@/lib/api';
import type { WhyNotAnswer } from '@/lib/types';

// The banner colour is the answer's own standing, not a judgement of the name:
// idle means the run simply has nothing to say about it.
const VERDICT_STATE: Record<WhyNotAnswer['verdict'], 'pass' | 'fail' | 'warn' | 'idle'> = {
  in_proposal: 'pass',
  rule_rejected: 'fail',
  awaiting_term: 'warn',
  filtered_before_query: 'warn',
  not_returned_by_qloo: 'idle',
  exists_but_not_returned: 'idle',
  unknown_entity: 'idle',
};

export default function WhyNotScreen() {
  const { proposal } = useApp();
  const [query, setQuery] = useState('');
  const [checkEntity, setCheckEntity] = useState(false);
  // An answer belongs to the run it was read out of, so switching rooms retires
  // it instead of leaving the previous run's verdict under the new run's name.
  const [asked, setAsked] = useState<{ id: string; answer: WhyNotAnswer; used: boolean; declined: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!proposal) return <div className="space-y-5"><Panel title="Why is X not on the list?"><Empty>{NEEDS_RUN}</Empty></Panel></div>;
  const answer = asked && asked.id === proposal.proposal_id ? asked.answer : null;
  const liveState = asked && asked.id === proposal.proposal_id
    ? { used: asked.used, declined: asked.declined }
    : null;
  // Suggestions are names this very run already carries — refused offers and
  // audited rejections. Nothing is invented here, and asking costs nothing.
  const suggestions = [
    ...proposal.unsupported.map((u) => u.name),
    ...proposal.rejections.map((r) => r.name),
  ].filter((n, i, all) => n.trim() !== '' && all.indexOf(n) === i).slice(0, 6);

  const ask = async () => {
    setBusy(true); setError(null); setAsked(null);
    try {
      const r = await api.whyNot({ pack: proposal.pack, location: proposal.location, query: query.trim(), proposal_id: proposal.proposal_id, check_entity: checkEntity });
      setAsked({ id: proposal.proposal_id, answer: r.answer, used: r.live_check_used, declined: r.live_check_declined === true });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <Panel
        title="Why is this act not on the list?"
        description="The answer is read out of the run that was just made — the same stored rows, the same rules. It never guesses at a reason."
        mode={proposal.mode}
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1">
            <label className="text-xs font-medium text-slate-500">Name to look for</label>
            <Input
              value={query}
              maxLength={80}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && query.trim() && !busy) void ask(); }}
              placeholder="an act, a brand, a dish"
            />
          </div>
          <Button onClick={ask} disabled={busy || !query.trim()}>{busy ? 'Checking…' : 'Ask the run'}</Button>
        </div>

        {suggestions.length > 0 && !answer && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span>this run already left out</span>
            {suggestions.map((n) => (
              <button key={n} className="tb-pill" data-on="false" onClick={() => setQuery(n)} title={`ask about ${n}`}>{n}</button>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2 text-[11px] text-slate-600">
          <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={checkEntity} onChange={(e) => setCheckEntity(e.target.checked)} />
          Also ask Qloo whether it knows this name at all — one /search call, only if you tick this, and only when a key is available.
        </label>
        {error && <Note tone="bad" title="Refused">{error}</Note>}

        {answer && (
          <div className="space-y-2.5">
            <VerdictBanner state={VERDICT_STATE[answer.verdict]} title={`${answer.verdict.replace(/_/g, ' ')} — ${answer.headline}`}>
              <span>Proven from: {answer.proven_from}</span>
            </VerdictBanner>

            <div className="tb-arm space-y-1.5">
              {answer.detail.map((d, i) => (
                <div key={i} className="flex gap-2 text-xs leading-relaxed text-slate-700">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" aria-hidden />
                  <span className="min-w-0">{d}</span>
                </div>
              ))}
              {(answer.entity_id || answer.qloo_rank !== null) && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  {answer.entity_id && <span>entity id <code className="font-mono text-slate-700">{answer.entity_id}</code></span>}
                  {answer.qloo_rank !== null && <span>Qloo rank <strong className="font-semibold tabular-nums text-slate-700">{answer.qloo_rank}</strong></span>}
                  {answer.failing_rule && <span>failing rule <code className="font-mono text-slate-700">{answer.failing_rule}</code></span>}
                </div>
              )}
            </div>

            {answer.flip && (
              <div className="tb-arm" data-st="baseline">
                <div className="text-sm font-bold text-slate-800">Flip point — what would put it on the list</div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  <code className="font-mono">{answer.flip.rule_id}</code> · metric <code className="font-mono">{answer.flip.metric}</code>
                </p>
                <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">the rule is set at</div>
                    <div className="text-lg font-bold tabular-nums text-slate-800">{answer.flip.current_threshold.toLocaleString('en-US')}</div>
                  </div>
                  <span className="text-lg text-slate-400" aria-hidden>→</span>
                  <div className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">it would need</div>
                    <div className="text-lg font-bold tabular-nums text-indigo-700">{answer.flip.required_threshold.toLocaleString('en-US')}</div>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{answer.flip.note}</p>
              </div>
            )}

            {liveState?.used && <Note tone="warn">A live /search call was made for this check: it is counted against the run budget and written to the Qloo call log.</Note>}
            {liveState?.declined && <Note tone="warn">You asked for a live /search check and it was not made: {proposal.mode} mode on this host, or the run budget, left no way to call Qloo. The verdict above is read from the stored rows only — no live lookup supports it.</Note>}
          </div>
        )}

        {busy && <Skeleton lines={3} />}
        {!answer && !busy && (
          <Empty>Type a name. The engine will say which of its own steps left it out — or that Qloo never returned it, which is a different answer and is labelled as such.</Empty>
        )}

        <div className="text-[11px] leading-relaxed text-slate-500">
          Try an act the venue’s guarantee ceiling refused, or one from the already-played list: this screen quotes the exact
          reason. A name Qloo has never heard of gets an honest “not returned” — never a made-up excuse.
        </div>
      </Panel>
    </div>
  );
}
