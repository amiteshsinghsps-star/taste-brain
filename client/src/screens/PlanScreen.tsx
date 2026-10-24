// Plan + proposal (F1-F3, F40, V1-V4, V6 entry point). This is the screen a
// judge lands on: pick a room, state a goal, run the fixed pipeline, read what
// Qloo returned and what the venue's own rules did to it.

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chips, Empty, FetchedAt, KV, ModeBadge, ModeMixLine, Note, Panel, StatusPill, num } from '@/components/common';
import { useApp } from '@/lib/state';
import type { NeedsTerm, ProposalItem } from '@/lib/types';

export default function PlanScreen() {
  const app = useApp();
  const { packs, pack, setPack, locations, location, setLocation, currentPack, currentLocation } = app;
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Panel
        title="1 · Room, goal and window"
        description="Same engine, different Vertical Pack. A pack is configuration — nothing here is code."
      >
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-500">Vertical pack</label>
          <div className="flex flex-wrap gap-2">
            {packs.map((p) => (
              <button
                key={p.pack} onClick={() => setPack(p.pack)}
                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-left ${pack === p.pack ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="text-sm font-semibold">{p.display_name}</div>
                <div className="text-[11px] text-slate-500">one unit = {p.unit}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-500">Room</label>
          <select value={location} onChange={(e) => setLocation(e.target.value)} className="w-full cursor-pointer rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}
          </select>
          {currentLocation && (
            <dl className="rounded-md bg-slate-50 px-2.5 py-1.5">
              <KV k="capacity tier" v={currentLocation.capacity_tier ?? 'not stated in the pack'} />
              <KV k="taste seeds" v={currentLocation.seeds.join(', ')} />
              <KV k="rules this room enforces" v={currentLocation.rule_ids?.join(', ') ?? 'all of the pack’s'} />
              <KV k="catalogue on file" v={`${currentLocation.catalog}`} />
              <KV k="committed replay fixture" v={currentLocation.replay_fixture === undefined ? 'not reported by the server' : currentLocation.replay_fixture ? 'yes — this room runs offline' : 'no — this room has no stored offline result set'} />
            </dl>
          )}
          {currentLocation?.replay_fixture === false && app.mode === 'replay' && (
            <Note tone="warn" title="Replay will return nothing for this room">
              Replay serves only what is committed in <code>server/src/qloo/fixtures</code>, and this room is not in there. Its candidates are real Qloo data, so run it in CACHED — from the stored copy on this server — rather than reading an empty list as &ldquo;Qloo had nothing&rdquo;.
            </Note>
          )}
          {currentLocation?.data_provenance && (
            <Note tone={/SYNTHETIC/i.test(currentLocation.data_provenance) ? 'warn' : 'info'} title="Data provenance for this room">
              {currentLocation.data_provenance}
            </Note>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-500">Goal</label>
          <Input value={app.goal} onChange={(e) => app.setGoal(e.target.value)} maxLength={256} />
          <div className="flex flex-wrap gap-1">
            {(currentPack?.goal_templates ?? []).map((g, i) => (
              <button
                key={i}
                onClick={() => app.setGoal(g.replace('{n}', '3').replace('{season}', 'autumn'))}
                className="cursor-pointer rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
              >{g}</button>
            ))}
          </div>
        </div>

        <RecentPlays />

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => app.run()} disabled={app.busy || !location}>
            {app.busy ? 'Running the pipeline…' : 'Run the agent'}
          </Button>
          <span className="text-[11px] text-slate-500">mode: {app.mode.toUpperCase()}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">{app.modeInfo?.quota_note}</p>
        {app.error && <Note tone="bad" title="The engine refused">{app.error}</Note>}
        {refusal && <Note tone="bad" title="Approval refused">{refusal}</Note>}
      </Panel>

      <div className="space-y-5">
        {app.proposal ? (
          <>
            {app.proposal.degrade_reason && (
              <Note tone="warn" title={`This run is labelled ${app.proposal.mode.toUpperCase()}`}>
                {app.proposal.degrade_reason}
              </Note>
            )}
            <Audience />
            <Items onRefused={setRefusal} />
            <Excluded />
          </>
        ) : (
          <Panel title="2 · What the agent proposes" description="Nothing is shown until a run exists. The engine has no default answer.">
            <Empty>
              Pick a room, check the goal and press <strong>Run the agent</strong>. Every item you then see is backed by a
              stored Qloo result or a rule your pack defines — and says which.
            </Empty>
          </Panel>
        )}
      </div>
    </div>
  );
}

function RecentPlays() {
  const { recentPlays, setRecentPlays } = useApp();
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    setRecentPlays([...new Set([...recentPlays, v])].slice(0, 40));
    setDraft('');
  };
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-500">No-repeat window (V4) — who has already played here</label>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={60} placeholder="act name from your own book" />
        <Button variant="outline" onClick={add}>Add</Button>
      </div>
      {recentPlays.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {recentPlays.map((n) => (
            <li key={n} className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
              {n}
              <button className="cursor-pointer text-slate-400 hover:text-red-600" onClick={() => setRecentPlays(recentPlays.filter((x) => x !== n))} title="remove">✕</button>
            </li>
          ))}
        </ul>
      ) : <p className="text-[11px] text-slate-500">Empty window: nothing is excluded on repeat. This list is yours, never Qloo’s.</p>}
    </div>
  );
}

function Audience() {
  const { proposal } = useApp();
  if (!proposal) return null;
  const tags = proposal.audience_tags;
  return (
    <Panel
      title="Audience portrait"
      description="Qloo's own description of the taste signal this room was matched against. Audience level only — never a person."
      mode={proposal.mode}
    >
      {tags.length ? (
        <>
          <Chips items={tags.map((t) => t.name)} title="taste tags" />
          {proposal.local_lift_note && <Note tone="info">{proposal.local_lift_note}</Note>}
        </>
      ) : (
        <Empty>Qloo returned no audience tags for this room on this run, so there is no portrait to show. Nothing is filled in.</Empty>
      )}
      {proposal.unresolved_seeds.length > 0 && (
        <Note tone="warn" title="A seed did not resolve cleanly">
          {proposal.unresolved_seeds.map((s, i) => (
            <div key={i}>“{s.input}” → {s.candidates.length ? `candidates ${s.candidates.join(', ')}` : 'no Qloo entity matched'}</div>
          ))}
        </Note>
      )}
      {proposal.relaxations.length > 0 && (
        <Note tone="warn" title="The result was empty, so the relax ladder ran">
          {proposal.relaxations.map((r, i) => <div key={i}>{r}</div>)}
        </Note>
      )}
      {proposal.allowlist_violations.length > 0 && (
        <Note tone="bad" title="Parameters refused before sending (allowlist)">
          {proposal.allowlist_violations.map((v, i) => <div key={i}>{v}</div>)}
        </Note>
      )}
    </Panel>
  );
}

function Items({ onRefused }: { onRefused: (m: string) => void }) {
  const { proposal, run, decide, approver, setApprover } = useApp();
  const [picked, setPicked] = useState<string[]>([]);
  const [terms, setTerms] = useState<Record<string, Record<string, number>>>({});
  const [busy, setBusy] = useState(false);
  const items = proposal?.items ?? [];
  const blocked = items.filter((i) => i.approval_blocked);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const act = async (outcome: 'approved' | 'rejected', ids?: string[]) => {
    setBusy(true); onRefused('');
    const err = await decide(outcome, ids, Object.keys(terms).length ? terms : undefined);
    setBusy(false);
    if (err) { onRefused(err); return; }
    setPicked([]); setTerms({});
  };

  return (
    <Panel
      title={`2 · Proposal — ${items.length} item${items.length === 1 ? '' : 's'}`}
      description="Order is Qloo's own. Fit is derived by Taste Brain from that order and is labelled as such on every card."
      mode={proposal?.mode}
      actions={<Button size="sm" variant="outline" onClick={() => run({ mode: 'live' })} disabled={busy}>Re-run live</Button>}
    >
      <ModeMixLine mix={proposal?.trace.mode_mix} />
      {!items.length ? (
        <Empty>Nothing qualified. The engine is showing an empty result because that is the honest result — see the refusals below and the flip points they name.</Empty>
      ) : items.map((it) => (        <ItemCard
          key={it.entity_id}
          item={it}
          picked={picked.includes(it.entity_id)}
          onPick={() => toggle(it.entity_id)}
          terms={terms[it.entity_id] ?? {}}
          onTerm={(field, value) => setTerms((t) => ({ ...t, [it.entity_id]: { ...(t[it.entity_id] ?? {}), [field]: value } }))}
        />
      ))}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Human decision (F7)</span>
          <span className="ml-auto text-[11px] text-slate-500">status: <strong>{proposal?.status}</strong></span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
          The agent never approves. A named person does, and the entry is linked into the ledger. {blocked.length} item(s) on this
          run are visible but blocked until a missing term is entered.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-500">approver</label>
          <Input value={approver} onChange={(e) => setApprover(e.target.value)} maxLength={80} placeholder="your name — required" className={`w-44 ${approver.trim() ? '' : 'border-amber-400'}`} />
          {!approver.trim() && <span className="text-[11px] text-amber-700">no approver named yet: Approve and Reject stay refused until you type one</span>}
          <Button size="sm" disabled={busy} onClick={() => act('approved', picked.length ? picked : undefined)}>
            {picked.length ? `Approve ${picked.length} selected` : 'Approve all'}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act('rejected', picked.length ? picked : undefined)}>Reject</Button>
          {picked.length > 0 && <button className="cursor-pointer text-[11px] text-slate-500 underline" onClick={() => setPicked([])}>clear selection</button>}
        </div>
      </div>
    </Panel>
  );
}

function ItemCard({ item, picked, onPick, terms, onTerm }: {
  item: ProposalItem;
  picked: boolean;
  onPick: () => void;
  terms: Record<string, number>;
  onTerm: (field: string, value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const lift = item.local_lift;
  return (
    <article className={`rounded-lg border p-3 ${item.approval_blocked ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={picked} onChange={onPick} className="h-3.5 w-3.5 cursor-pointer accent-indigo-600" aria-label={`select ${item.name}`} />
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700" title={`Qloo rank ${item.qloo_rank}`}>{item.rank}</span>
        <span className="font-semibold">{item.name}</span>
        <span className="text-[11px] text-slate-500">{item.type}</span>
        <ModeBadge mode={item.mode} />
        {item.rising && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-800" title="derived by Taste Brain from Qloo's trend vs default order">rising: {item.rising}</span>}
        {typeof lift === 'number' && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-800" title="derived by Taste Brain: rank with location minus rank without it">local lift {lift > 0 ? '+' : ''}{lift}</span>}
        <span className="ml-auto text-[11px] text-slate-500" title={item.evidence.fit_note}>fit {Math.round(item.fit * 100)} (derived)</span>
      </div>

      <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{item.explanation}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.rule_results.map((r) => (
          <span key={r.rule_id} title={`${r.reason} — ${r.source}`} className="contents">
            <StatusPill status={r.status}>{r.rule_id}: {r.status}</StatusPill>
          </span>
        ))}
      </div>

      {item.needs_terms.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-200 bg-white p-2">
          <div className="text-[11px] font-semibold text-amber-800">Term required before this can be approved — Taste Brain never guesses one</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {item.needs_terms.map((t: NeedsTerm) => (
              <div key={`${t.rule_id}:${t.field}`} className="flex items-center gap-1.5">
                <label className="text-[11px] text-slate-600">{t.enterable ? t.label : `${t.label} (a Qloo attribute, not yours to enter)`}</label>
                {t.enterable && (
                  <Input
                    type="number" min={0} value={terms[t.field] ?? ''}
                    onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) onTerm(t.field, v); }}
                    className="w-28"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500">
        <button className="cursor-pointer underline" onClick={() => setOpen((o) => !o)}>{open ? 'hide' : 'show'} the evidence card (F14)</button>
        <span>term entered above is stored against your room and written to the ledger when you approve — it is never attributed to Qloo</span>
      </div>
      {open && (
        <dl className="mt-1 rounded-md bg-slate-50 px-2.5 py-1.5">
          <KV k="endpoint" v={item.evidence.endpoint} />
          <KV k="workflow / variant" v={item.evidence.workflow} />
          <KV k="fetched at" v={<FetchedAt iso={item.evidence.fetched_at} mode={item.evidence.mode} />} />
          <KV k="qloo_rank" v={item.evidence.qloo_rank} />
          <KV k="popularity" v={num(item.evidence.popularity)} />
          <KV k="obscurity" v={num(item.evidence.obscurity, 1)} />
          <KV k="followers" v={num(item.evidence.followers, 0)} />
          <KV k="genres" v={item.evidence.primary_genres.join(', ') || 'not returned'} />
          <KV k="fit" v={item.evidence.fit_note} />
          <div className="mt-1"><Chips items={item.evidence.qloo_tags.map((t) => t.name)} title="Qloo tags" /></div>
          {item.evidence.explainability && <p className="mt-1 text-[11px] italic text-slate-600">“{item.evidence.explainability}” — Qloo's own words</p>}
        </dl>
      )}
    </article>
  );
}

function Excluded() {
  const { proposal } = useApp();
  const flips = useMemo(() => proposal?.flip_points ?? [], [proposal]);
  if (!proposal) return null;
  const { rejections, unsupported } = proposal;
  if (!rejections.length && !unsupported.length && !flips.length) return null;
  return (
    <Panel title="What was refused, and what would change it" description="F40 flip points are computed against the same rules that did the refusing — a threshold you could actually move.">
      {rejections.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-red-800">Rejected by the venue’s own rules ({rejections.length})</div>
          {rejections.map((r) => (
            <div key={`${r.entity_id}:${r.rule_id ?? r.check}`} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-900">
              <div className="font-semibold">{r.name} <span className="font-normal text-red-700">· check {r.check}{r.rule_id ? ` · ${r.rule_id}` : ''}</span></div>
              <div>{r.reason}</div>
            </div>
          ))}
        </div>
      )}
      {unsupported.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-amber-800">No record on file ({unsupported.length}) — not refused, just unprovable</div>
          {unsupported.map((u) => (
            <div key={u.offer_id} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
              <span className="font-semibold">{u.name}</span> — {u.reason}
            </div>
          ))}
        </div>
      )}
      {flips.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">Flip points — the exact distance to a different answer</div>
          <table className="w-full border-collapse text-left text-xs">
            <thead><tr className="text-[11px] uppercase text-slate-500"><th className="py-1 pr-2">item</th><th className="pr-2">rule</th><th className="pr-2">metric</th><th className="pr-2">observed</th><th className="pr-2">now</th><th className="pr-2">would need</th><th>note</th></tr></thead>
            <tbody>
              {flips.map((f) => (
                <tr key={`${f.entity_id}:${f.rule_id}`} className="border-t border-slate-100 align-top">
                  <td className="py-1 pr-2 font-medium">{f.name}</td>
                  <td className="pr-2">{f.rule_id}</td>
                  <td className="pr-2">{f.metric}</td>
                  <td className="pr-2">{f.observed.toLocaleString('en-US')}</td>
                  <td className="pr-2">{f.current_threshold.toLocaleString('en-US')}</td>
                  <td className="pr-2 font-semibold">{f.required_threshold.toLocaleString('en-US')}</td>
                  <td className="text-slate-600">{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Note tone="info">Moving a threshold is a what-if, not a decision: the change is written to the ledger with your name on it, and the item only becomes approvable when the rule actually passes.</Note>
        </div>
      )}
    </Panel>
  );
}
