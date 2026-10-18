import React, { useState, useEffect } from 'react';
import { Brain, Search, Plus, RefreshCw, Bot, Building2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { api } from '@/lib/api';

interface MemoryHit {
  kind: string;
  id: string;
  text: string;
  at?: string;
  confidence?: number | string;
}

interface MemoryStats {
  episodes: number;
  facts: number;
  procedures: number;
  conversations: number;
}

// Agent memory lives in the same per-tenant FalkorDB graph as everything else:
// Episode / Fact / Procedure / Conversation+Turn nodes carrying a scope of
// `agent:<id>` (private to one agent) or `tenant` (shared). This page is the
// read/write surface for that Track-02 store.
export const MemoryPage: React.FC = () => {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MemoryHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [draft, setDraft] = useState({ summary: '', outcome: 'COMPLETED' });

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const [s, a] = await Promise.all([api.memoryStats(), api.listAgents()]);
      setStats((s as any) ?? null);
      setAgents(((a as any)?.agents ?? []) as any[]);
    } catch (err: any) {
      setError(err.message || 'Memory stats unavailable');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const recall = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.recallMemory(query, agentId || undefined);
      setHits(res.memories ?? []);
    } catch (err: any) {
      setError(err.message || 'Recall failed');
    } finally {
      setBusy(false);
    }
  };

  const writeEpisode = async () => {
    if (!draft.summary.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res: any = await api.writeEpisode({
        summary: draft.summary,
        outcome: draft.outcome,
        agentId: agentId || undefined,
        shared: !agentId,
      });
      setNotice(`Episode ${res.episodeId} written${agentId ? ` scoped to agent ${agentId}` : ' to the tenant scope'}.`);
      setDraft({ summary: '', outcome: 'COMPLETED' });
      load();
    } catch (err: any) {
      setError(err.message || 'Episode write failed');
    } finally {
      setBusy(false);
    }
  };

  const counters: Array<[string, number | undefined]> = [
    ['Episodes', stats?.episodes],
    ['Facts', stats?.facts],
    ['Procedures', stats?.procedures],
    ['Conversations', stats?.conversations],
  ];

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Brain className="h-4 w-4 text-indigo-600" /> Agent memory, in the tenant graph
            </h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">
              Episode, Fact, Procedure and Conversation+Turn nodes carry a <span className="font-mono">scope</span> of
              <span className="font-mono"> agent:&lt;id&gt;</span> (private to one agent) or <span className="font-mono">tenant</span>
              (shared). Recall is Cypher over the same graph the answers come from — nothing is stored in a separate vector service.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={busy}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {counters.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
              <div className="text-lg font-bold text-slate-800">{value === undefined ? '—' : value}</div>
            </div>
          ))}
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-700">{notice}</div>}

      <Card className="p-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Recall</h3>
        <div className="mt-3 flex flex-col gap-3 md:flex-row">
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs"
          >
            <option value="">Tenant scope (shared across agents)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.type ?? 'agent'})
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && recall()}
            placeholder="credit, denied party, Hamburg…"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs"
          />
          <Button size="sm" onClick={recall} disabled={busy || !query.trim()}>
            <Search className="mr-1.5 h-3.5 w-3.5" /> Recall
          </Button>
        </div>

        {hits && (
          <div className="mt-4 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{hits.length} memory record(s) matched</div>
            {hits.length === 0 && (
              <p className="text-xs text-slate-400">
                Nothing recalled. In this graph an empty recall is a real answer, not an error — the agent has no stored memory
                of that subject yet.
              </p>
            )}
            {hits.map((h) => (
              <div key={h.id} className="rounded-lg border border-slate-200 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {h.kind}
                  </Badge>
                  {h.confidence !== undefined && h.confidence !== null && (
                    <span className="text-[10px] text-slate-400">confidence {String(h.confidence)}</span>
                  )}
                  {h.at && <span className="ml-auto text-[10px] text-slate-400">{String(h.at).slice(0, 10)}</span>}
                </div>
                <p className="mt-1.5 text-xs text-slate-700">{h.text}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">Write an episode</h3>
        <p className="mt-1 text-[11px] text-slate-500">
          What an agent learned, as a graph node. Pick an agent to keep it private to that agent; leave it on tenant scope to share it.
        </p>
        <div className="mt-3 space-y-3">
          <textarea
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            rows={2}
            placeholder="Screened BK-1042: shipper on the demo watchlist, staged for a human instead of shipped."
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
          />
          <div className="flex flex-col gap-3 md:flex-row">
            <select
              value={draft.outcome}
              onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              {['COMPLETED', 'FLAGGED', 'REJECTED', 'STAGED_FOR_APPROVAL'].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={writeEpisode} disabled={busy || !draft.summary.trim()}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Save episode
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <Bot className="h-3.5 w-3.5" /> agent scope = private memory
          </span>
          <span className="flex items-center gap-1">
            <Building2 className="h-3.5 w-3.5" /> tenant scope = shared memory
          </span>
        </div>
      </Card>
    </div>
  );
};

export default MemoryPage;
