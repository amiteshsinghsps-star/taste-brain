import React, { useMemo, useState } from 'react';
import {
  Download,
  Filter,
  Lightbulb,
  Route,
  Search,
  Share2,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api, downloadGraphExport } from '@/lib/api';

interface KnowledgeGraphPageProps {
  graphData: any;
  loadAllData: () => void;
  /** Jump to Graph Insights with both endpoints pre-filled for the path finder. */
  onPathRequest?: (from: string, to: string) => void;
}

export const KnowledgeGraphPage: React.FC<KnowledgeGraphPageProps> = ({ graphData, loadAllData, onPathRequest }) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedRelType, setSelectedRelType] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [explain, setExplain] = useState<any>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);

  const nodes: any[] = graphData.nodes || [];
  const links: any[] = graphData.links || [];

  // Edges arrive as ids only (source/target/relationType); names live on the nodes.
  const nameOf = useMemo(() => {
    const map = new Map<string, { name: string; label: string }>();
    nodes.forEach((n: any) => map.set(String(n.id), { name: n.name || n.id, label: n.label || 'Node' }));
    return (id: any) => map.get(String(id)) || { name: String(id), label: '?' };
  }, [nodes]);

  const relationTypes = useMemo(
    () => ['ALL', ...Array.from(new Set(links.map((l: any) => l.relationType).filter(Boolean))).sort()],
    [links]
  );

  const filteredLinks = links.filter((link: any) => {
    const q = filterQuery.toLowerCase();
    const matchesSearch =
      !q ||
      nameOf(link.source).name.toLowerCase().includes(q) ||
      nameOf(link.target).name.toLowerCase().includes(q) ||
      String(link.relationType || '').toLowerCase().includes(q);
    return matchesSearch && (selectedRelType === 'ALL' || link.relationType === selectedRelType);
  });

  const filteredNodes = nodes.filter((n: any) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return String(n.name || '').toLowerCase().includes(q) || String(n.label || '').toLowerCase().includes(q) || String(n.id).toLowerCase().includes(q);
  });

  const handleReExtract = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.extractGraph();
      loadAllData();
    } catch (err: any) {
      setError(err.message || 'Extraction failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExplain = async (id: string) => {
    setExplainBusy(true);
    setError(null);
    try {
      const res: any = await api.explainNode(id);
      setExplain(res.explanation);
    } catch (err: any) {
      setError(err.message || 'Could not explain this node');
    } finally {
      setExplainBusy(false);
    }
  };

  const handleExport = async (format: 'json' | 'graphml' | 'csv' | 'nodes') => {
    setExportBusy(format);
    setError(null);
    try {
      const { blob, filename } = await downloadGraphExport(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || 'Export failed');
    } finally {
      setExportBusy(null);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight">Knowledge Graph Explorer</h3>
          <p className="text-xs text-slate-500 mt-0.5">Every entity and typed relation this tenant's FalkorDB currently holds</p>
        </div>
        <Button size="sm" onClick={handleReExtract} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-4 py-2 font-medium shadow-xs">
          <Share2 className="h-4 w-4 mr-1.5" /> {loading ? 'Extracting Graph...' : 'Re-extract Knowledge Graph'}
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-700 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="underline">Dismiss</button>
        </div>
      )}

      <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-indigo-50/80 border border-indigo-100 rounded-2xl shadow-2xs">
            <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block">Total Entities</span>
            <p className="text-3xl font-extrabold text-slate-900 mt-1 tracking-tight">{nodes.length}</p>
          </div>
          <div className="p-4 bg-emerald-50/80 border border-emerald-100 rounded-2xl shadow-2xs">
            <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">Relation Edges</span>
            <p className="text-3xl font-extrabold text-slate-900 mt-1 tracking-tight">{links.length}</p>
          </div>
          <div className="p-4 bg-purple-50/80 border border-purple-100 rounded-2xl shadow-2xs">
            <span className="text-[11px] font-bold text-purple-700 uppercase tracking-wider block">Relation Types</span>
            <p className="text-3xl font-extrabold text-slate-900 mt-1 tracking-tight">{relationTypes.length - 1}</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <div className="relative flex-1 w-full">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-3" />
            <Input
              placeholder="Search entities, SOP rules, or relations..."
              className="pl-9 h-10 rounded-xl text-xs bg-slate-50 border-slate-200"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0">
            <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0 mr-1" />
            {relationTypes.slice(0, 8).map((type) => (
              <button
                key={type}
                onClick={() => setSelectedRelType(type)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors shrink-0 ${
                  selectedRelType === type
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mr-1">Export</span>
          {([
            ['json', 'JSON'],
            ['graphml', 'GraphML'],
            ['csv', 'edges CSV'],
            ['nodes', 'nodes CSV'],
          ] as const).map(([fmt, label]) => (
            <Button
              key={fmt}
              size="sm"
              variant="outline"
              disabled={exportBusy !== null}
              onClick={() => handleExport(fmt)}
              className="text-xs bg-white"
            >
              <Download className="h-3.5 w-3.5 mr-1.5 text-indigo-600" />
              {exportBusy === fmt ? 'Building…' : label}
            </Button>
          ))}
          <p className="text-[10px] text-slate-400 w-full sm:w-auto sm:ml-2">
            Serialized from the graph itself, including the <span className="font-mono">demoSeed</span> marker on synthetic nodes.
          </p>
        </div>

        <div className="border border-slate-200/90 rounded-2xl p-5 bg-slate-50/40 space-y-3">
          <h4 className="font-bold text-xs text-slate-900 uppercase tracking-wider">Typed Relations ({filteredLinks.length})</h4>
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {filteredLinks.map((link: any, i: number) => {
              const s = nameOf(link.source);
              const t = nameOf(link.target);
              return (
                <div
                  key={`${link.source}-${link.relationType}-${link.target}-${i}`}
                  className="p-4 bg-white border border-slate-200/90 rounded-2xl text-xs flex flex-wrap items-center gap-2 shadow-2xs hover:border-indigo-300 transition-colors"
                >
                  <button onClick={() => handleExplain(link.source)} className="font-bold text-slate-900 hover:text-indigo-700 hover:underline text-left">
                    {s.name}
                  </button>
                  <span className="text-[10px] text-slate-400 font-mono">{s.label}</span>
                  <Badge variant="outline" className="font-mono text-[10px] bg-slate-50 border-slate-200 text-indigo-700 px-3 py-1">
                    {link.relationType}
                  </Badge>
                  <button onClick={() => handleExplain(link.target)} className="font-bold text-indigo-600 hover:underline text-left">
                    {t.name}
                  </button>
                  <span className="text-[10px] text-slate-400 font-mono">{t.label}</span>
                  <span className="flex-1" />
                  {onPathRequest && (
                    <button
                      onClick={() => onPathRequest(s.name, t.name)}
                      className="text-[10px] font-semibold text-slate-400 hover:text-indigo-600 flex items-center gap-1"
                      title="Load these two entities into the path finder"
                    >
                      <Route className="h-3 w-3" /> path
                    </button>
                  )}
                </div>
              );
            })}

            {filteredLinks.length === 0 && (
              <div className="text-center text-xs text-slate-400 font-medium py-10">
                No matching relations found. Try adjusting your search query or relation filter.
              </div>
            )}
          </div>
        </div>

        <div className="border border-slate-200/90 rounded-2xl p-5 bg-slate-50/40 space-y-3">
          <h4 className="font-bold text-xs text-slate-900 uppercase tracking-wider">Entities ({filteredNodes.length})</h4>
          <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto pr-1">
            {filteredNodes.slice(0, 300).map((n: any) => (
              <button
                key={n.id}
                onClick={() => handleExplain(n.id)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] hover:border-indigo-300 hover:text-indigo-700 transition-colors"
                title="Explain this node"
              >
                <span className="font-mono text-slate-400 mr-1">{n.label}</span>
                <span className="font-semibold">{n.name || n.id}</span>
              </button>
            ))}
            {filteredNodes.length > 300 && (
              <span className="text-[11px] text-slate-400 self-center">showing first 300 of {filteredNodes.length}</span>
            )}
          </div>
        </div>
      </Card>

      {explainBusy && <p className="text-xs text-slate-400">Explaining…</p>}

      {explain && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-xl border border-slate-200 my-8">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                  Node explanation
                </span>
                <h3 className="text-sm font-bold text-slate-900 mt-1 flex items-center gap-1.5">
                  <Lightbulb className="h-4 w-4 text-indigo-600" /> {explain.node.name}
                  <span className="font-mono text-[10px] text-slate-400 font-normal">{explain.node.label}</span>
                </h3>
              </div>
              <button onClick={() => setExplain(null)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {Object.entries(explain.node.properties || {})
                .filter(([k]) => k !== 'id')
                .slice(0, 12)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1">
                    <span className="text-slate-500 font-mono">{k}</span>
                    <span className="text-slate-900 font-semibold truncate max-w-[60%]" title={String(v)}>{String(v)}</span>
                  </div>
                ))}
            </div>

            <Section title={`Directly connected (${explain.neighbours.length})`}>
              {explain.neighbours.map((n: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
                  <span className="font-mono text-slate-400 w-10">{n.direction === 'out' ? '-->' : '<--'}</span>
                  <Badge variant="outline" className="text-[10px] font-mono">{n.relation}</Badge>
                  <button onClick={() => handleExplain(n.node.id)} className="font-semibold text-indigo-700 hover:underline text-left truncate">
                    {n.node.name}
                  </button>
                  <span className="text-[10px] text-slate-400 font-mono">{n.node.label}</span>
                </div>
              ))}
              {!explain.neighbours.length && <Empty>Zero edges on this node.</Empty>}
            </Section>

            {explain.owningSop?.length > 0 && (
              <Section title="Governing policy & implementing rules">
                {explain.owningSop.map((p: any, i: number) => (
                  <div key={i} className="text-[11px] py-1 space-y-1">
                    <div className="font-bold text-slate-900">{p.policyName} <span className="font-mono text-slate-400">{p.status || ''}</span></div>
                    {p.rules.map((r: any) => (
                      <div key={r.id} className="ml-3 text-slate-600">
                        rule · {r.ruleName} v{r.version} · {r.status}
                      </div>
                    ))}
                  </div>
                ))}
              </Section>
            )}

            {explain.provenance?.length > 0 && (
              <Section title={`Source text in the graph (${explain.provenance.length} chunk(s))`}>
                {explain.provenance.slice(0, 4).map((c: any, i: number) => (
                  <div key={i} className="text-[11px] py-1 space-y-0.5">
                    <div className="font-mono text-[10px] text-slate-400">{c.documentTitle} · {c.chunkId}</div>
                    <p className="text-slate-600 leading-snug line-clamp-3">{c.text}</p>
                  </div>
                ))}
              </Section>
            )}

            {explain.decisions?.length > 0 && (
              <Section title={`Decisions referencing this (${explain.decisions.length})`}>
                {explain.decisions.slice(0, 6).map((d: any) => (
                  <div key={d.id} className="text-[11px] py-0.5 flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{d.outcome || 'DECISION'}</Badge>
                    <span className="text-slate-700">{d.summary}</span>
                    {d.decidedBy && <span className="text-slate-400">· {d.decidedBy}</span>}
                  </div>
                ))}
              </Section>
            )}

            <div className="flex items-center gap-3 text-[11px] pt-2 border-t border-slate-100">
              <span className="text-slate-500">Reader feedback on cited answers:</span>
              <Badge variant="success" className="text-[10px]">👍 {explain.feedback.up}</Badge>
              <Badge variant="destructive" className="text-[10px]">👎 {explain.feedback.down}</Badge>
            </div>

            <div className="flex justify-end pt-1">
              <Button size="sm" variant="ghost" onClick={() => setExplain(null)} className="text-xs">Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-1">
    <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{title}</h4>
    <div className="max-h-44 overflow-y-auto">{children}</div>
  </div>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="text-[11px] text-slate-400">{children}</p>;
