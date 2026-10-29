// Plan + proposal (F1-F3, F40, V1-V4, V6 entry point). This is the screen a
// judge lands on: pick a room, state a goal, run the fixed pipeline, read what
// Qloo returned and what the venue's own rules did to it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Chips, CountUp, Empty, FetchedAt, JsonBlock, KV, MeterBar, ModeBadge, ModeMixLine, Note, Panel, Radar, Skeleton, Stat, StatusPill, TagFrequency, VerdictBanner } from '@/components/common';
import { num } from '@/lib/format';
import { useApp } from '@/lib/app-context';
import type { NeedsTerm, ProposalItem } from '@/lib/types';

export default function PlanScreen() {
  const app = useApp();
  const { packs, pack, setPack, locations, location, setLocation, currentPack, currentLocation } = app;
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <Panel
        title="1 · Choose room, goal and options"
        description="Pick a vertical pack, a room and a goal, then run the agent."
      >
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-500">Vertical pack</label>
          <div className="flex flex-wrap gap-2">
            {packs.map((p) => (
              <button
                key={p.pack} onClick={() => setPack(p.pack)}
                className={`cursor-pointer rounded-xl border px-3 py-2 text-left transition-all ${pack === p.pack ? 'tb-nav-active border-transparent text-white shadow-md' : 'border-slate-200 bg-white/80 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md'}`}
              >
                <div className="text-sm font-semibold">{p.display_name}</div>
                <div className={`text-[11px] ${pack === p.pack ? 'text-white' : 'text-slate-500'}`}>one unit = {p.unit}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-500">Room</label>
          <select value={location} onChange={(e) => setLocation(e.target.value)} className="w-full cursor-pointer rounded-lg border border-slate-300 bg-white/80 px-2.5 py-1.5 pr-8 text-sm shadow-sm transition-colors hover:border-indigo-300 focus:border-indigo-400 focus:outline-none focus:ring-3 focus:ring-indigo-500/15">
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}
          </select>
          {currentLocation && (
            <dl className="rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2 shadow-sm">
              <KV k="capacity tier" v={currentLocation.capacity_tier ?? 'not stated in the pack'} />
              <KV k="taste seeds" v={currentLocation.seeds.join(', ')} />
              <KV k="rules this room enforces" v={currentLocation.rule_ids?.join(', ') ?? 'all of the pack’s'} />
              <KV k="catalogue on file" v={`${currentLocation.catalog}`} />
            </dl>
          )}
          {currentLocation?.data_provenance && (
            <Note tone="info" title="Where this room’s data came from">
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
                className="tb-chip cursor-pointer px-2.5 py-1 text-[11px] font-medium transition-transform hover:-translate-y-px"
              >{g}</button>
            ))}
          </div>
        </div>

        <RecentPlays />

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => app.run()} disabled={app.busy || !location} className="tb-hero">
            {app.busy ? 'Running the pipeline…' : 'Run the agent'}
          </Button>
          <span className="text-[11px] text-slate-500">mode: {app.mode.toUpperCase()}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">{app.modeInfo?.quota_note}</p>
        {app.error && <Note tone="bad" title="The engine refused">{app.error}</Note>}
        {refusal && <Note tone="bad" title="Approval refused">{refusal}</Note>}
      </Panel>

      <div className="space-y-5">
        {app.busy && !app.proposal ? (
          <Panel title="2 · What the agent proposes" description="The pipeline is running — seeds, audience, candidates, rules, auditor."><Skeleton lines={5} /></Panel>
        ) : app.proposal ? (
          <>
            {app.proposal.degrade_reason && (
              <Note tone="warn" title={`This run is labelled ${app.proposal.mode.toUpperCase()}`}>
                {app.proposal.degrade_reason}
              </Note>
            )}
            <Audience />
            {/* A different run is a different set of rows. Selections, comparison
                marks and typed-in offer terms all name entity ids from the run they
                were made on, so the whole list is remounted when the run changes —
                otherwise Approve sends the previous room's ids to the endpoint. */}
            <Items key={app.proposal.proposal_id} onRefused={setRefusal} />
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
      <label className="text-xs font-medium text-slate-500">Already played here — exclude these</label>
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

const SORTS = [
  ['qloo', 'Qloo order', (a: ProposalItem, b: ProposalItem) => a.rank - b.rank],
  ['fit', 'Fit (derived)', (a: ProposalItem, b: ProposalItem) => b.fit - a.fit],
  ['pop', 'Popularity', (a: ProposalItem, b: ProposalItem) => (b.popularity ?? -1) - (a.popularity ?? -1)],
  ['fol', 'Followers', (a: ProposalItem, b: ProposalItem) => (b.followers ?? -1) - (a.followers ?? -1)],
  ['obsc', 'Obscurity', (a: ProposalItem, b: ProposalItem) => (b.obscurity ?? -1) - (a.obscurity ?? -1)],
  ['name', 'Name', (a: ProposalItem, b: ProposalItem) => a.name.localeCompare(b.name)],
] as const;
type SortId = (typeof SORTS)[number][0];

function Items({ onRefused }: { onRefused: (m: string) => void }) {
  const { proposal, run, decide, approver, setApprover, modeInfo, busy: running } = useApp();
  const [picked, setPicked] = useState<string[]>([]);
  const [cmp, setCmp] = useState<string[]>([]);
  const [terms, setTerms] = useState<Record<string, Record<string, number>>>({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortId>('qloo');
  const [only, setOnly] = useState<'all' | 'ok' | 'blocked'>('all');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [detail, setDetail] = useState<ProposalItem | null>(null);
  const cmpRef = useRef<HTMLDialogElement>(null);
  const items = useMemo(() => proposal?.items ?? [], [proposal]);
  const blocked = items.filter((i) => i.approval_blocked);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleCmp = (id: string) => setCmp((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 3 ? [...c.slice(1), id] : [...c, id]));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sortFn = SORTS.find((s) => s[0] === sort)![2];
    return items
      .filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.type.toLowerCase().includes(needle) || i.tags.some((t) => t.toLowerCase().includes(needle)))
      .filter((i) => only === 'all' || (only === 'ok' ? !i.approval_blocked : i.approval_blocked))
      .slice()
      .sort(sortFn);
  }, [items, q, sort, only]);

  const tagFreq = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of items) for (const t of i.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [items]);

  const cmpItems = useMemo(
    () => items.filter((i) => cmp.includes(i.entity_id)).sort((a, b) => cmp.indexOf(a.entity_id) - cmp.indexOf(b.entity_id)),
    [items, cmp],
  );
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  const RADAR_COLORS = ['#4f46e5', '#059669', '#d97706'];
  const radarSeries = cmpItems.map((i, k) => ({
    name: i.name,
    color: RADAR_COLORS[k % RADAR_COLORS.length],
    values: [
      i.fit / Math.max(0.001, ...cmpItems.map((x) => x.fit)),
      (Math.min(...cmpItems.map((x) => x.qloo_rank)) - 1) / Math.max(1, i.qloo_rank - 1),
      (i.popularity ?? 0) / Math.max(1, ...cmpItems.map((x) => x.popularity ?? 0)),
      (i.obscurity ?? 0) / Math.max(0.001, ...cmpItems.map((x) => x.obscurity ?? 0)),
      (i.followers ?? 0) / Math.max(1, ...cmpItems.map((x) => x.followers ?? 0)),
    ],
  }));

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
      actions={modeInfo?.qloo_rest_active
        ? <Button size="sm" variant="outline" onClick={() => run({ mode: 'live' })} disabled={busy || running}>Re-run live</Button>
        : <span className="text-[11px] text-slate-500" title="Live Qloo is switched off on this host, so a visitor cannot spend the team key with one click.">live re-run off on this host</span>}
    >
      <ModeMixLine mix={proposal?.trace.mode_mix} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={<CountUp value={items.length} />} label="suggested" hint="items that passed every rule this run" />
        <Stat value={<CountUp value={items.length - blocked.length} />} label="ready to approve" hint="not waiting on a missing term" />
        <Stat value={<CountUp value={blocked.length} />} label="waiting on a term" hint="visible but blocked until you enter the missing number" />
        <Stat value={<CountUp value={proposal?.rejections.length ?? 0} />} label="refused by rules" hint="see the refusal list below — each names its rule" />
      </div>

      {!items.length ? (
        <Empty>Nothing qualified. The engine is showing an empty result because that is the honest result — see the refusals below and the flip points they name.</Empty>
      ) : (
        <>
          {tagFreq.length > 0 && (
            <details className="rounded-xl border border-slate-200/80 bg-white/60 px-3 py-2" open>
              <summary className="cursor-pointer text-xs font-semibold text-slate-700">What these picks have in common — taste tags across this run</summary>
              <div className="mt-2"><TagFrequency tags={tagFreq} of={items.length} /></div>
            </details>
          )}

          <div className="tb-sticky flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 backdrop-blur">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter by name, type or tag…" className="h-8 w-48 text-xs" />
            <div className="flex flex-wrap items-center gap-1.5">
              {(['all', 'ok', 'blocked'] as const).map((o) => (
                <button key={o} className="tb-pill" data-on={only === o} onClick={() => setOnly(o)}>
                  {o === 'all' ? `all · ${items.length}` : o === 'ok' ? `ready · ${items.length - blocked.length}` : `waiting on term · ${blocked.length}`}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
              {(['cards', 'table'] as const).map((v) => (
                <button key={v} className="tb-pill" data-on={view === v} onClick={() => setView(v)} title={v === 'cards' ? 'rich cards' : 'compact sortable table'}>
                  {v === 'cards' ? '▤ cards' : '☰ table'}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">sort by
              <select value={sort} onChange={(e) => setSort(e.target.value as SortId)} className="cursor-pointer rounded-lg border border-slate-300 bg-white/80 px-2 py-1 pr-7 text-xs">
                {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
          </div>

          {!shown.length && <Empty>No shown item matches “{q}”{only !== 'all' ? ' in this filter' : ''}. The run itself is unchanged.</Empty>}
          {view === 'table' ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200/80">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/70 text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-1.5">#</th><th className="px-2 py-1.5">name</th><th className="px-2 py-1.5">fit</th>
                    <th className="px-2 py-1.5">qloo rank</th><th className="px-2 py-1.5">popularity</th><th className="px-2 py-1.5">followers</th>
                    <th className="px-2 py-1.5">rules</th><th className="px-2 py-1.5">mode</th><th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((it) => (
                    <tr key={it.entity_id} className="border-t border-slate-100 transition-colors hover:bg-indigo-50/40">
                      <td className="px-2 py-1.5 font-bold text-slate-400">{it.rank}</td>
                      <td className="px-2 py-1.5">
                        <button className="cursor-pointer font-semibold text-left hover:underline" onClick={() => setDetail(it)} title="open the detail drawer">{it.name}</button>
                        <div className="text-[10px] text-slate-400">{it.type}{it.approval_blocked ? ' · waiting on a term' : ''}</div>
                      </td>
                      <td className="w-24 px-2 py-1.5"><MeterBar pct={Math.round(it.fit * 100)} hint={it.evidence.fit_note} /></td>
                      <td className="px-2 py-1.5 tabular-nums">{it.qloo_rank}</td>
                      <td className="px-2 py-1.5 tabular-nums">{num(it.popularity)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{num(it.followers, 0)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{it.rule_results.filter((r) => r.status === 'pass').length}/{it.rule_results.length}</td>
                      <td className="px-2 py-1.5"><ModeBadge mode={it.mode} /></td>
                      <td className="px-2 py-1.5 text-right">
                        <button className="tb-pill" data-on={cmp.includes(it.entity_id)} onClick={() => toggleCmp(it.entity_id)}>⇄</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-2.5 2xl:grid-cols-2">
              {shown.map((it) => (
                <ItemCard
                  key={it.entity_id}
                  item={it}
                  picked={picked.includes(it.entity_id)}
                  onPick={() => toggle(it.entity_id)}
                  comparing={cmp.includes(it.entity_id)}
                  onCompare={() => toggleCmp(it.entity_id)}
                  onDetail={() => setDetail(it)}
                  terms={terms[it.entity_id] ?? {}}
                  onTerm={(field, value) => setTerms((t) => ({ ...t, [it.entity_id]: { ...(t[it.entity_id] ?? {}), [field]: value } }))}
                />
              ))}
            </div>
          )}

          {detail && (
            <>
              <div className="tb-overlay print:hidden" onClick={() => setDetail(null)} />
              <aside className="tb-drawer p-4 print:hidden" aria-label={`detail for ${detail.name}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold leading-tight">{detail.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>rank {detail.rank}</span><ModeBadge mode={detail.mode} />{detail.rising ? <span>rising: {detail.rising}</span> : null}
                    </div>
                  </div>
                  <button className="tb-pill" onClick={() => setDetail(null)}>close ✕</button>
                </div>
                <div className="mt-3"><MeterBar pct={Math.round(detail.fit * 100)} caption={`fit ${Math.round(detail.fit * 100)} — derived by Taste Brain from Qloo order`} hint={detail.evidence.fit_note} /></div>
                <p className="mt-3 text-sm leading-relaxed text-slate-700">{detail.explanation}</p>
                <div className="mt-3"><Chips items={detail.tags} title="tags" /></div>
                <dl className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5">
                  <KV k="qloo rank" v={detail.qloo_rank} />
                  <KV k="popularity" v={num(detail.popularity)} />
                  <KV k="obscurity" v={num(detail.obscurity, 1)} />
                  <KV k="followers" v={num(detail.followers, 0)} />
                  <KV k="local lift" v={typeof detail.local_lift === 'number' ? `${detail.local_lift > 0 ? '+' : ''}${detail.local_lift}` : 'not computed'} />
                  <KV k="endpoint" v={<code className="font-mono text-[11px]">{detail.evidence.endpoint}</code>} />
                  <KV k="workflow" v={detail.evidence.workflow} />
                  <KV k="fetched at" v={<FetchedAt iso={detail.evidence.fetched_at} mode={detail.evidence.mode} />} />
                </dl>
                <div className="mt-3 space-y-1">
                  <div className="text-xs font-semibold text-slate-700">Rule checks</div>
                  {detail.rule_results.map((r) => (
                    <div key={r.rule_id} className="flex items-start gap-2 text-[11px]" title={`${r.reason} — ${r.source}`}>
                      <StatusPill status={r.status}>{r.rule_id}</StatusPill>
                      <span className="min-w-0 text-slate-600">{r.reason}</span>
                    </div>
                  ))}
                </div>
                {detail.evidence.explainability && (
                  <Note tone="info" title="Qloo’s own words">“{detail.evidence.explainability}”</Note>
                )}
                {detail.needs_terms.length > 0 && (
                  <Note tone="warn" title="Term required before approval">{detail.needs_terms.map((t) => t.label).join(' · ')}</Note>
                )}
                <div className="mt-3"><JsonBlock obj={detail} /></div>
              </aside>
            </>
          )}

          {cmpItems.length >= 2 && (
            <div className="tb-tray print:hidden">
              <span className="text-[11px] font-semibold text-slate-600">{cmpItems.map((i) => i.name).join(' · ')}</span>
              <button className="tb-pill" data-on="true" onClick={() => cmpRef.current?.showModal()}>Compare side by side</button>
              <button className="cursor-pointer text-[11px] text-slate-400 underline" onClick={() => setCmp([])}>clear</button>
            </div>
          )}

          {cmpItems.length >= 2 && (
            <dialog
              ref={cmpRef}
              className="tb-dialog h-fit max-h-[85vh] w-[min(96vw,980px)] overflow-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl"
              onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur">
                <div className="text-sm font-bold">Side by side — every value below is this run’s own data</div>
                <button className="tb-pill" onClick={() => cmpRef.current?.close()}>close ✕</button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-4 border-b border-slate-100 px-4 py-3">
                <Radar axes={['fit', 'qloo rank', 'popularity', 'obscurity', 'followers']} series={radarSeries} />
                <div className="space-y-1 text-[11px]">
                  {radarSeries.map((s) => (
                    <div key={s.name} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden /><span className="font-medium text-slate-700">{s.name}</span></div>
                  ))}
                  <p className="max-w-56 text-[10px] leading-relaxed text-slate-400">Each axis is scaled to the best value among the compared picks (Qloo rank inverted — 1st place scores full). A comparison shape, not an absolute score.</p>
                </div>
              </div>
              <div className="grid gap-3 p-4" style={{ gridTemplateColumns: `repeat(${cmpItems.length}, minmax(0, 1fr))` }}>
                {cmpItems.map((i) => (
                  <div key={i.entity_id} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="text-sm font-bold leading-tight">{i.name}</div>
                    <div className="text-[11px] text-slate-500">{i.type} · <ModeBadge mode={i.mode} className="ml-1 inline-flex align-middle" /></div>
                    <MeterBar pct={Math.round(i.fit * 100)} caption={`fit ${Math.round(i.fit * 100)} — derived by Taste Brain from Qloo order`} />
                    <KV k="qloo rank" v={i.qloo_rank} />
                    <KV k="popularity" v={num(i.popularity)} />
                    <KV k="obscurity" v={num(i.obscurity, 1)} />
                    <KV k="followers" v={num(i.followers, 0)} />
                    <KV k="local lift" v={typeof i.local_lift === 'number' ? `${i.local_lift > 0 ? '+' : ''}${i.local_lift}` : 'not computed'} />
                    <KV k="rules" v={`${i.rule_results.filter((r) => r.status === 'pass').length}/${i.rule_results.length} pass`} />
                    <div><Chips items={i.tags.slice(0, 8)} title="tags" /></div>
                    {i.evidence.explainability && <p className="text-[11px] italic leading-relaxed text-slate-600">“{i.evidence.explainability}” — Qloo's own words</p>}
                  </div>
                ))}
              </div>
            </dialog>
          )}
        </>
      )}

      <div className="tb-arm space-y-2">
        <VerdictBanner
          state={proposal?.status === 'approved' ? 'pass' : proposal?.status === 'rejected' ? 'fail' : 'idle'}
          title={proposal?.status === 'approved'
            ? 'Approved — a named person signed this run off'
            : proposal?.status === 'rejected'
              ? 'Refused — a named person turned this run down'
              : 'Waiting on a named human'}
        >
          The agent never approves. A person does, and that decision is linked into the ledger. {blocked.length} item(s) on
          this run are visible but blocked until a missing term is entered.
        </VerdictBanner>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-500">approver</label>
          <Input value={approver} onChange={(e) => setApprover(e.target.value)} maxLength={80} placeholder="your name — required" className={`w-44 ${approver.trim() ? '' : 'border-amber-400'}`} />
          {!approver.trim() && <span className="text-[11px] text-amber-700">no approver named yet: Approve and Reject stay refused until you type one</span>}
          <Button size="sm" disabled={busy || running} onClick={() => act('approved', picked.length ? picked : undefined)}>
            {picked.length ? `Approve ${picked.length} selected` : 'Approve all'}
          </Button>
          <Button size="sm" variant="outline" disabled={busy || running} onClick={() => act('rejected', picked.length ? picked : undefined)}>Reject</Button>
          {picked.length > 0 && <button className="cursor-pointer text-[11px] text-slate-500 underline" onClick={() => setPicked([])}>clear selection</button>}
        </div>
      </div>
    </Panel>
  );
}

function ItemCard({ item, picked, onPick, comparing, onCompare, onDetail, terms, onTerm }: {
  item: ProposalItem;
  picked: boolean;
  onPick: () => void;
  comparing: boolean;
  onCompare: () => void;
  onDetail: () => void;
  terms: Record<string, number>;
  onTerm: (field: string, value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const lift = item.local_lift;
  return (
    <article className={`tb-arm tb-status ${comparing ? 'ring-2 ring-indigo-300' : ''}`} data-st={item.approval_blocked ? 'empty' : 'ok'}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={picked} onChange={onPick} className="h-3.5 w-3.5 cursor-pointer accent-indigo-600" aria-label={`select ${item.name}`} />
        <button
          onClick={onCompare} title={comparing ? 'remove from compare' : 'compare with another pick (up to 3)'} aria-label={`compare ${item.name}`}
          className={`cursor-pointer rounded px-1 text-[10px] font-bold ${comparing ? 'tb-nav-active' : 'border border-slate-200 text-slate-400 hover:border-indigo-300 hover:text-indigo-600'}`}
        >⇄</button>
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${item.rank === 1 ? 'tb-medal tb-medal-gold' : item.rank === 2 ? 'tb-medal tb-medal-silver' : item.rank === 3 ? 'tb-medal tb-medal-bronze' : 'tb-medal'}`} title={`Qloo rank ${item.qloo_rank}`}>{item.rank}</span>
        <button className="cursor-pointer text-left font-semibold hover:underline" onClick={onDetail} title="open the detail drawer">{item.name}</button>
        <span className="text-[11px] text-slate-500">{item.type}</span>
        <ModeBadge mode={item.mode} />
        {item.rising && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-800" title="derived by Taste Brain from Qloo's trend vs default order">rising: {item.rising}</span>}
        {typeof lift === 'number' && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-800" title="derived by Taste Brain: rank with location minus rank without it">local lift {lift > 0 ? '+' : ''}{lift}</span>}
        <span className="ml-auto w-28 shrink-0 text-right text-[11px] text-slate-500" title={item.evidence.fit_note}>fit {Math.round(item.fit * 100)} (derived)</span>
      </div>
      <div className="mt-1.5"><MeterBar pct={Math.round(item.fit * 100)} hint={item.evidence.fit_note} /></div>

      <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{item.explanation}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.rule_results.map((r) => (
          <StatusPill key={r.rule_id} status={r.status} title={`${r.reason} — ${r.source}`}>{r.rule_id}: {r.status}</StatusPill>
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        {item.rule_results.length} rule check(s) on this item — hover a chip for the reason and the rule’s source
      </p>

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
        <button className="cursor-pointer underline" onClick={() => setOpen((o) => !o)}>{open ? 'hide' : 'show'} the evidence card</button>
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
    <Panel title="What was refused, and what would change it" description="Each flip point shows the exact threshold that would turn a refusal into a pass.">
      {rejections.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-red-800">Rejected by the venue’s own rules ({rejections.length})</div>
          {rejections.map((r) => (
            <div key={`${r.entity_id}:${r.rule_id ?? r.check}`} className="tb-arm tb-status" data-st="dead">
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-semibold text-slate-800">{r.name}</span>
                <span className="text-[11px] text-red-700">check {r.check}{r.rule_id ? ` · ${r.rule_id}` : ''}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{r.reason}</p>
            </div>
          ))}
        </div>
      )}
      {unsupported.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-amber-800">No record on file ({unsupported.length}) — not refused, just unprovable</div>
          {unsupported.map((u) => (
            <div key={u.offer_id} className="tb-arm tb-status" data-st="empty">
              <span className="text-xs font-semibold text-slate-800">{u.name}</span>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{u.reason}</p>
            </div>
          ))}
        </div>
      )}
      {flips.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">Flip points — the exact distance to a different answer</div>
          <div className="grid gap-2.5 lg:grid-cols-2">
            {flips.map((f) => (
              <div key={`${f.entity_id}:${f.rule_id}`} className="tb-arm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-bold text-slate-800">{f.name}</span>
                  <code className="font-mono text-[11px] text-slate-500">{f.rule_id}</code>
                  <span className="ml-auto text-[11px] text-slate-400">{f.metric}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">observed</div>
                    <div className="font-semibold tabular-nums text-slate-700">{f.observed.toLocaleString('en-US')}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">rule is set at</div>
                    <div className="font-semibold tabular-nums text-slate-700">{f.current_threshold.toLocaleString('en-US')}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">would need</div>
                    <div className="font-semibold tabular-nums text-indigo-700">{f.required_threshold.toLocaleString('en-US')}</div>
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{f.note}</p>
              </div>
            ))}
          </div>
          <Note tone="info">Moving a threshold is a what-if, not a decision: the change is written to the ledger with your name on it, and the item only becomes approvable when the rule actually passes.</Note>
        </div>
      )}
    </Panel>
  );
}
