import React, { useState } from 'react';
import {
  ArrowRight,
  GitBranch,
  History,
  RefreshCw,
  Route,
  Search,
  Users,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

interface InsightsPageProps {
  /** Entity name handed over from the graph explorer's "find path" action. */
  initialFrom?: string;
  initialTo?: string;
}

type InsightTab = 'path' | 'versions' | 'timeline' | 'digest' | 'handoffs';

const TABS: Array<{ id: InsightTab; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = [
  { id: 'path', label: 'Connection path', icon: Route, hint: 'Shortest directed chain between two entities' },
  { id: 'versions', label: 'Rule versions', icon: GitBranch, hint: 'Diff a rule against the version it superseded' },
  { id: 'timeline', label: 'Decision timeline', icon: History, hint: 'Every recorded decision about one subject' },
  { id: 'handoffs', label: 'Handoff board', icon: Users, hint: 'Work passed between agents in the graph' },
  { id: 'digest', label: 'Freshness digest', icon: RefreshCw, hint: 'What changed, went stale or awaits review' },
];

const Statement: React.FC<{ text: string }> = ({ text }) =>
  text ? (
    <p className="text-[11px] leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono">
      {text}
    </p>
  ) : null;

const DemoNote: React.FC = () => (
  <p className="text-[10px] text-slate-400">
    Read straight from this tenant's FalkorDB graph — no model call. Demo company nodes carry
    <span className="font-mono"> demoSeed="true"</span>.
  </p>
);

/* ------------------------------------------------------------------ path --- */

const ConnectionPathPanel: React.FC<{ initialFrom: string; initialTo: string }> = ({ initialFrom, initialTo }) => {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [hops, setHops] = useState(4);
  const [path, setPath] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!from.trim() || !to.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.connectionPath(from.trim(), to.trim(), hops);
      setPath(res.path);
    } catch (err: any) {
      setError(err.message || 'Path search failed');
      setPath(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="From entity, e.g. Maya Rao"
          className="flex-1 h-9 rounded-xl text-xs bg-slate-50"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <Input
          placeholder="To entity, e.g. Operations"
          className="flex-1 h-9 rounded-xl text-xs bg-slate-50"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <select
          value={hops}
          onChange={(e) => setHops(Number(e.target.value))}
          className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs px-2"
        >
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              ≤ {n} hops
            </option>
          ))}
        </select>
        <Button size="sm" onClick={run} disabled={busy || !from.trim() || !to.trim()} className="bg-indigo-600 text-white">
          <Search className="h-3.5 w-3.5 mr-1" /> {busy ? 'Searching…' : 'Find path'}
        </Button>
      </div>

      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

      {path && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {path.connected ? (
              <Badge variant="success" className="text-[10px]">{path.hops} hop path</Badge>
            ) : (
              <Badge variant="warning" className="text-[10px]">No path found</Badge>
            )}
            {path.direction && (
              <Badge variant="outline" className="text-[10px] font-mono">
                traversed {path.direction}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] font-mono">
              degree {path.degrees?.from ?? 0} → {path.degrees?.to ?? 0}
            </Badge>
            {(path.fromCandidates > 1 || path.toCandidates > 1) && (
              <Badge variant="secondary" className="text-[10px]">
                ambiguous: {path.fromCandidates}/{path.toCandidates} name matches, best-ranked used
              </Badge>
            )}
          </div>

          {path.connected && (
            <div className="flex flex-wrap items-center gap-2">
              {(path.nodes || []).map((n: any, i: number) => (
                <React.Fragment key={`${n.id}-${i}`}>
                  <div className="px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs shadow-2xs">
                    <div className="font-bold text-slate-900">{n.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{n.label}</div>
                  </div>
                  {i < (path.edges || []).length && (
                    <div className="flex items-center gap-1 text-indigo-600">
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-mono font-bold">{path.edges[i]}</span>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          <Statement text={path.statement} />
          <DemoNote />
        </div>
      )}
    </div>
  );
};

/* --------------------------------------------------------------- versions -- */

const RuleVersionsPanel: React.FC = () => {
  const [rules, setRules] = useState<any[] | null>(null);
  const [ruleId, setRuleId] = useState('');
  const [diff, setDiff] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRules = async () => {
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.listGraphRules();
      const list = res.rules || [];
      setRules(list);
      if (list.length && !ruleId) setRuleId(list[0].id);
      if (!list.length) setError('No rules in this tenant graph yet. Seed the demo company or extract a document first.');
    } catch (err: any) {
      setError(err.message || 'Could not load rules');
    } finally {
      setBusy(false);
    }
  };

  const loadDiff = async () => {
    if (!ruleId) return;
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.ruleVersions(ruleId);
      setDiff(res);
    } catch (err: any) {
      setError(err.message || 'Version diff failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {!rules && (
          <Button size="sm" variant="outline" onClick={loadRules} disabled={busy} className="text-xs bg-white">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-indigo-600" /> Load rules from the graph
          </Button>
        )}
        {rules && (
          <>
            <select
              value={ruleId}
              onChange={(e) => setRuleId(e.target.value)}
              className="h-9 flex-1 min-w-40 rounded-xl border border-slate-200 bg-slate-50 text-xs px-2"
            >
              {rules.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.ruleName} ({r.status})
                </option>
              ))}
            </select>
            <Button size="sm" onClick={loadDiff} disabled={busy || !ruleId} className="bg-indigo-600 text-white">
              <GitBranch className="h-3.5 w-3.5 mr-1" /> {busy ? 'Comparing…' : 'Compare versions'}
            </Button>
          </>
        )}
      </div>

      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

      {diff && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(diff.versions || []).map((v: any) => (
              <div
                key={v.id}
                className={`p-4 rounded-2xl border text-xs space-y-2 ${
                  v.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{v.ruleName || diff.ruleName}</span>
                  <Badge variant={v.status === 'ACTIVE' ? 'success' : 'secondary'} className="text-[10px]">{v.status}</Badge>
                </div>
                <div className="font-mono text-[10px] text-slate-500 break-all">{v.id}</div>
                <div className="space-y-1">
                  {Object.entries(v.params || {}).map(([k, val]) => (
                    <div key={k} className="flex justify-between font-mono text-[11px]">
                      <span className="text-slate-500">{k}</span>
                      <span className="font-bold text-slate-900">{String(val)}</span>
                    </div>
                  ))}
                </div>
                {v.supersedes?.length > 0 && (
                  <p className="text-[10px] text-slate-500 font-mono">SUPERSEDES {v.supersedes.join(', ')}</p>
                )}
                {v.fromSimulation && (
                  <p className="text-[10px] text-indigo-700">
                    from simulation {v.fromSimulation.id} · status {v.fromSimulation.status}
                  </p>
                )}
              </div>
            ))}
          </div>

          {(diff.diffs || []).map((d: any, i: number) => (
            <div key={i} className="border border-slate-200 rounded-2xl p-4 space-y-2 bg-white">
              <h5 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Changes {String(d.fromVersion) === String(d.toVersion) ? `${d.fromId} → ${d.toId}` : `v${d.fromVersion} → v${d.toVersion}`}
              </h5>
              {d.changed.map((c: any) => (
                <div key={c.key} className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-slate-500">{c.key}</span>
                  <span className="text-red-600 line-through">{String(c.before)}</span>
                  <ArrowRight className="h-3 w-3 text-slate-400" />
                  <span className="text-emerald-700 font-bold">{String(c.after)}</span>
                </div>
              ))}
              {d.added.map((a: any) => (
                <div key={a.key} className="text-xs font-mono text-emerald-700">+ {a.key} = {String(a.value)}</div>
              ))}
              {d.removed.map((r: any) => (
                <div key={r.key} className="text-xs font-mono text-red-600">− {r.key} = {String(r.value)}</div>
              ))}
              {d.unchanged.map((u: any) => (
                <div key={u.key} className="text-xs font-mono text-slate-400">= {u.key} = {String(u.value)}</div>
              ))}
              {!d.changed.length && !d.added.length && !d.removed.length && (
                <p className="text-xs text-slate-500">Parameters identical — the version changed for another reason.</p>
              )}
            </div>
          ))}

          <Statement text={diff.statement} />
          <DemoNote />
        </div>
      )}
    </div>
  );
};

/* ---------------------------------------------------------------- timeline - */

const TimelinePanel: React.FC = () => {
  const [subject, setSubject] = useState('BK-1042');
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!subject.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.decisionTimeline(subject.trim());
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Timeline failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Booking number, policy name, party…"
          className="flex-1 h-9 rounded-xl text-xs bg-slate-50"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <Button size="sm" onClick={run} disabled={busy || !subject.trim()} className="bg-indigo-600 text-white">
          <History className="h-3.5 w-3.5 mr-1" /> {busy ? 'Replaying…' : 'Replay timeline'}
        </Button>
      </div>

      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

      {data && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.matched || {}).map(([k, v]) => (
              <Badge key={k} variant="outline" className="text-[10px] font-mono">{k}: {String(v)}</Badge>
            ))}
          </div>

          {data.events?.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">Nothing recorded for “{data.subject}”. An empty timeline here is the graph saying it has no such event — not a query error.</p>
          ) : (
            <ol className="relative border-l border-slate-200 ml-2 space-y-4">
              {(data.events || []).map((e: any, i: number) => (
                <li key={i} className="ml-4">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-indigo-500 ring-2 ring-white" />
                  <div className="text-[10px] font-mono text-slate-400">
                    {e.at ? new Date(e.at).toLocaleString() : 'no timestamp on this node'}
                  </div>
                  <div className="text-xs font-bold text-slate-900">{e.title}</div>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Badge variant="secondary" className="text-[10px]">{e.kind}</Badge>
                    {e.actor && <span className="text-[11px] text-slate-600">by {e.actor}</span>}
                    {e.outcome && <Badge variant="warning" className="text-[10px]">{e.outcome}</Badge>}
                    {e.demoSeed === 'true' && <span className="text-[10px] text-slate-400 font-mono">demoSeed</span>}
                  </div>
                  {e.detail && <p className="text-[11px] text-slate-500 mt-0.5">{e.detail}</p>}
                </li>
              ))}
            </ol>
          )}

          <Statement text={data.statement} />
          <DemoNote />
        </div>
      )}
    </div>
  );
};

/* ---------------------------------------------------------------- handoffs - */

const HandoffPanel: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.handoffBoard();
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Handoff board failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button size="sm" variant="outline" onClick={load} disabled={busy} className="text-xs bg-white">
        <Users className="h-3.5 w-3.5 mr-1.5 text-indigo-600" /> {busy ? 'Loading…' : 'Load handoff edges'}
      </Button>

      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(data.agents || []).map((a: any) => (
              <div key={a.id} className="p-4 bg-white border border-slate-200 rounded-2xl text-xs space-y-1.5 shadow-2xs">
                <div className="font-bold text-slate-900">{a.name}</div>
                <div className="text-[10px] font-mono text-slate-400">{a.type}</div>
                <div className="flex gap-2 pt-1">
                  <Badge variant="secondary" className="text-[10px]">tasks {a.tasks}</Badge>
                  <Badge variant="secondary" className="text-[10px]">memory {a.memories}</Badge>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-[10px]">in {a.handedIn}</Badge>
                  <Badge variant="outline" className="text-[10px]">out {a.handedOut}</Badge>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h5 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Handed-off work</h5>
            {(data.handoffs || []).map((h: any, i: number) => (
              <div key={i} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-800">{h.fromName || 'graph'}</span>
                <ArrowRight className="h-3.5 w-3.5 text-indigo-500" />
                <span className="font-bold text-indigo-700">{h.toName}</span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-700">{h.title}</span>
                {h.status && <Badge variant="warning" className="text-[10px]">{h.status}</Badge>}
                {h.ruleName && <span className="text-[10px] font-mono text-slate-400">via {h.ruleName} v{h.ruleVersion}</span>}
                {!h.directAgentToAgent && (
                  <span className="text-[10px] text-slate-400">routed through a Task node</span>
                )}
              </div>
            ))}
            {(data.handoffs || []).length === 0 && (
              <p className="text-xs text-slate-500">No HANDED_OFF_TO edges in this tenant graph yet.</p>
            )}
          </div>

          <Statement text={data.statement} />
          <DemoNote />
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------- digest -- */

const DigestPanel: React.FC = () => {
  const [days, setDays] = useState(60);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.freshnessDigest(days);
      setData(res.digest);
    } catch (err: any) {
      setError(err.message || 'Digest failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-slate-600">Window</label>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-9 rounded-xl border border-slate-200 bg-slate-50 text-xs px-2"
        >
          {[7, 30, 60, 90].map((n) => (
            <option key={n} value={n}>last {n} days</option>
          ))}
        </select>
        <Button size="sm" onClick={load} disabled={busy} className="bg-indigo-600 text-white">
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> {busy ? 'Building…' : 'Build digest'}
        </Button>
      </div>

      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {Object.entries(data.counts || {}).map(([k, v]) => (
              <div key={k} className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-2xl">
                <div className="text-xl font-extrabold text-slate-900">{String(v)}</div>
                <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">{k}</div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {(data.events || []).map((e: any, i: number) => (
              <div key={i} className="p-4 bg-white border border-slate-200 rounded-2xl text-xs space-y-1 shadow-2xs">
                <div className="flex items-center gap-2">
                  <Badge variant={e.kind === 'RULE_STALE' ? 'destructive' : 'secondary'} className="text-[10px] font-mono">{e.kind}</Badge>
                  <span className="font-bold text-slate-900">{e.title}</span>
                </div>
                <p className="text-slate-600">{e.detail}</p>
                <div className="text-[10px] font-mono text-slate-400">
                  {e.at ? new Date(e.at).toLocaleString() : 'state, not timestamped'} · {e.subjectId}
                </div>
              </div>
            ))}
            {(data.events || []).length === 0 && (
              <p className="text-xs text-slate-500">Nothing superseded, stale or pending review — the graph reports zero, which is a real answer.</p>
            )}
          </div>

          <Statement text={data.statement} />
          <DemoNote />
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------- page -- */

export const InsightsPage: React.FC<InsightsPageProps> = ({ initialFrom = '', initialTo = '' }) => {
  const [tab, setTab] = useState<InsightTab>('path');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Route className="h-5 w-5 text-indigo-600" /> Graph Insights
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Five questions only a graph can answer, computed in Cypher over this tenant's FalkorDB.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.hint}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors ${
                active
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
        {tab === 'path' && <ConnectionPathPanel initialFrom={initialFrom} initialTo={initialTo} />}
        {tab === 'versions' && <RuleVersionsPanel />}
        {tab === 'timeline' && <TimelinePanel />}
        {tab === 'handoffs' && <HandoffPanel />}
        {tab === 'digest' && <DigestPanel />}
      </Card>
    </div>
  );
};
