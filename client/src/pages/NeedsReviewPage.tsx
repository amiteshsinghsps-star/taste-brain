import React, { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, GitBranch, CheckCircle2, FileText, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

interface StaleItem {
  id: string;
  kind: 'Rule' | 'Policy' | string;
  name?: string;
  actionType?: string;
  version?: number | string;
  reason?: string;
  sourceDocumentId?: string;
  sourceDocumentTitle?: string;
}

interface ImpactSummary {
  policy?: { id?: string; name?: string; version?: number | string; status?: string };
  rules?: Array<{ id?: string; name?: string; status?: string }>;
  agents?: Array<{ id?: string; name?: string }>;
  governed?: Array<{ label?: string; name?: string; node?: { name?: string; id?: string } }>;
  owners?: Array<{ id?: string; name?: string }>;
  decisions?: Array<{ id?: string; summary?: string }>;
}

// Governed entries arrive wrapped ({ node, label }); everything else is flat.
const names = (arr?: any[]) =>
  (arr ?? []).map((x) => x?.name ?? x?.node?.name ?? x?.node?.id).filter(Boolean).slice(0, 6).join(', ');

export const NeedsReviewPage: React.FC = () => {
  const [items, setItems] = useState<StaleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [impact, setImpact] = useState<Record<string, ImpactSummary>>({});
  const [error, setError] = useState<string | null>(null);

  const fetchQueue = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await api.getStale();
      setItems(res.items || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load the review queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueue();
  }, []);

  const handleImpact = async (item: StaleItem) => {
    setBusyId(item.id);
    try {
      // Impact is computed from the policy node; for a rule, its implementing
      // policy is resolved server-side from the same id lookup.
      const res: any = await api.impactOfChange(item.id);
      setImpact((prev) => ({ ...prev, [item.id]: res.impact ?? {} }));
    } catch (err: any) {
      setImpact((prev) => ({ ...prev, [item.id]: { policy: { name: err?.message || 'Impact unavailable' } } }));
    } finally {
      setBusyId(null);
    }
  };

  const handleRevalidate = async (item: StaleItem) => {
    setBusyId(item.id);
    try {
      await api.revalidateStale(item.id);
      await fetchQueue();
    } catch (err: any) {
      alert(err?.message || 'Failed to revalidate item');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" /> Needs Review
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Rules and policies the graph flagged as stale — superseded sources, retired versions. Nothing here is auto-applied.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs px-3 py-1 bg-white border-slate-200 text-slate-700">
            Queue: {items.length}
          </Badge>
          <Button size="sm" variant="outline" onClick={fetchQueue} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Reload
          </Button>
        </div>
      </div>

      {error && (
        <Card className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">{error}</Card>
      )}

      {!items.length && !loading && (
        <Card className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Nothing is flagged stale right now. Load the demo company (or re-sync a source) to see the queue working.
        </Card>
      )}

      <div className="space-y-4">
        {items.map((item) => {
          const imp = impact[item.id];
          return (
            <Card key={`${item.kind}-${item.id}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={item.kind === 'Rule' ? 'default' : 'secondary'} className="text-[11px]">
                      {item.kind}
                    </Badge>
                    <h5 className="font-bold text-sm text-slate-900 truncate">{item.name || item.id}</h5>
                    {item.actionType && (
                      <Badge variant="outline" className="text-[10px] border-slate-200 text-slate-600">
                        {item.actionType}
                      </Badge>
                    )}
                    {item.version !== undefined && item.version !== null && (
                      <span className="text-[11px] text-slate-400">v{item.version}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{item.reason || 'Flagged by the freshness scanner.'}</p>
                  {item.sourceDocumentTitle && (
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> source: {item.sourceDocumentTitle}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => handleImpact(item)} disabled={busyId === item.id}>
                    <GitBranch className="h-3.5 w-3.5 mr-1.5" /> Impact
                  </Button>
                  <Button size="sm" onClick={() => handleRevalidate(item)} disabled={busyId === item.id} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Mark reviewed
                  </Button>
                </div>
              </div>

              {imp && (
                <div className="border-t border-slate-100 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <GitBranch className="h-3.5 w-3.5 text-indigo-500" /> Affected rules ({(imp.rules ?? []).length})
                    </p>
                    <p className="text-slate-500">{names(imp.rules) || 'None linked in the graph.'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-indigo-500" /> Agents &amp; systems
                    </p>
                    <p className="text-slate-500">
                      agents: {names(imp.agents) || 'none'} · systems/policies: {names(imp.governed) || 'none'}
                    </p>
                    {(imp.owners ?? []).length > 0 && <p className="text-slate-400">owners: {names(imp.owners)}</p>}
                    {(imp.decisions ?? []).length > 0 && (
                      <p className="text-slate-400">prior decisions referencing it: {(imp.decisions ?? []).length}</p>
                    )}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default NeedsReviewPage;
