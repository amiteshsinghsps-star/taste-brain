// Why-not (F12). An operator asks about a name that is not on the list, and the
// engine answers from the stored run: it either names the rule that refused it,
// the term that is missing, or says plainly that Qloo never returned it.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, Note, Panel } from '@/components/common';
import { NEEDS_RUN, useApp } from '@/lib/app-context';
import { api } from '@/lib/api';
import type { WhyNotAnswer } from '@/lib/types';

const VERDICT_TONE: Record<WhyNotAnswer['verdict'], 'good' | 'warn' | 'bad' | 'info'> = {
  in_proposal: 'good',
  rule_rejected: 'bad',
  awaiting_term: 'warn',
  filtered_before_query: 'warn',
  not_returned_by_qloo: 'info',
  exists_but_not_returned: 'info',
  unknown_entity: 'info',
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
            <Input value={query} maxLength={80} onChange={(e) => setQuery(e.target.value)} placeholder="an act, a brand, a dish" />
          </div>
          <Button onClick={ask} disabled={busy || !query.trim()}>{busy ? 'Checking…' : 'Ask the run'}</Button>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-slate-600">
          <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={checkEntity} onChange={(e) => setCheckEntity(e.target.checked)} />
          Also ask Qloo whether it knows this name at all — one /search call, only if you tick this, and only when a key is available.
        </label>
        {error && <Note tone="bad" title="Refused">{error}</Note>}

        {answer && (
          <div className="space-y-2">
            <Note tone={VERDICT_TONE[answer.verdict]} title={`${answer.verdict.replace(/_/g, ' ')} — ${answer.headline}`}>
              {answer.detail.map((d, i) => <div key={i}>{d}</div>)}
              <div className="text-[11px] opacity-80">Proven from: {answer.proven_from}</div>
              {answer.entity_id && <div className="text-[11px]">entity id: <code className="font-mono">{answer.entity_id}</code>{answer.qloo_rank ? ` · Qloo rank ${answer.qloo_rank}` : ''}</div>}
            </Note>
            {answer.flip && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                <div className="font-semibold">Flip point — what would put it on the list</div>
                <div>{answer.flip.rule_id} · {answer.flip.metric}: the rule is set at {answer.flip.current_threshold.toLocaleString('en-US')}; it would need {answer.flip.required_threshold.toLocaleString('en-US')}.</div>
                <div className="mt-1 text-indigo-800">{answer.flip.note}</div>
              </div>
            )}
            {liveState?.used && <Note tone="warn">A live /search call was made for this check: it is counted against the run budget and written to the Qloo call log.</Note>}
            {liveState?.declined && <Note tone="warn">You asked for a live /search check and it was not made: {proposal.mode} mode on this host, or the run budget, left no way to call Qloo. The verdict above is read from the stored rows only — no live lookup supports it.</Note>}
          </div>
        )}

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
