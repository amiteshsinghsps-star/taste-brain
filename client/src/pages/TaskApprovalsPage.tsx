import React, { useState, useEffect } from 'react';
import { ClipboardCheck, CheckCircle2, Shield, FileText, Send, Clock, Scale, History, Network } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

interface TaskApprovalsPageProps {
  loadAllData: () => void;
}

export const TaskApprovalsPage: React.FC<TaskApprovalsPageProps> = ({ loadAllData }) => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchStagedTasks = async () => {
    setLoading(true);
    try {
      const res: any = await api.listTasks();
      setTasks(res.tasks || []);
    } catch (err: any) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStagedTasks();
  }, []);

  const handleApproveTask = async (taskId: string) => {
    try {
      await api.approveTask(taskId);
      fetchStagedTasks();
      loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to approve task');
    }
  };

  const stagedTasks = tasks.filter((t) => t.status === 'STAGED_FOR_APPROVAL');
  const completedTasks = tasks.filter((t) => t.status === 'COMPLETED');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-indigo-600" /> Task Approvals & Copilot Control
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Review, inspect, and approve AI agent actions held in Copilot mode</p>
        </div>

        <Badge variant="outline" className="text-xs px-3 py-1 bg-white border-slate-200 text-slate-700">
          Pending Approvals: {stagedTasks.length}
        </Badge>
      </div>

      {/* Main Approvals Section */}
      <div className="space-y-4">
        <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-500" /> Staged Tasks Awaiting Human Approval ({stagedTasks.length})
        </h4>

        <div className="space-y-4">
          {stagedTasks.map((t) => (
            <Card key={t.id} className="rounded-2xl border border-amber-200/80 bg-white p-6 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-3">
                  <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold shrink-0">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <h5 className="font-bold text-sm text-slate-900">{t.agent?.name || 'Copilot Agent'}</h5>
                    <p className="text-[11px] text-slate-500 font-mono">Task ID: {t.id} · {t.taskType}</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Badge variant="warning" className="text-[11px]">
                    STAGED_FOR_APPROVAL
                  </Badge>
                  <Button size="sm" onClick={() => handleApproveTask(t.id)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-1.5 rounded-xl font-medium shadow-xs">
                    <Send className="h-3.5 w-3.5 mr-1.5" /> Approve & Execute Task
                  </Button>
                </div>
              </div>

              {/* Task Payload & Generated Output preview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-indigo-600" /> Staged Response Reply:
                  </span>
                  <p className="whitespace-pre-line text-slate-700 leading-relaxed">{t.outputResult?.draftReply || 'N/A'}</p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1.5">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Generated Declaration JSON:
                  </span>
                  <pre className="bg-white p-3 rounded-lg border border-slate-200 font-mono text-[11px] text-slate-800 overflow-x-auto max-h-40">
                    {JSON.stringify(t.outputResult?.declarationDraft || t.inputPayload, null, 2)}
                  </pre>
                </div>
              </div>
              {/* Decision evidence: graph verdict, why, and what happened last time */}
              {(t.outputResult?.verdict || t.outputResult?.evaluations?.length || t.outputResult?.precedents?.length) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Scale className="h-4 w-4 text-indigo-600" /> Engine verdict (graph rules, not the LLM)
                    </span>
                    <Badge variant={t.outputResult?.verdict === 'FLAGGED' ? 'destructive' : 'outline'} className="text-[11px]">
                      {t.outputResult?.verdict || 'n/a'}
                    </Badge>
                    <ul className="space-y-1 text-slate-600">
                      {(t.outputResult?.evaluations ?? []).map((e: any, i: number) => (
                        <li key={i} className="leading-snug">
                          <span className="font-medium text-slate-800">{e.ruleName}</span> → {e.verdict}
                          {typeof e.margin === 'number' && e.margin !== 0 ? ` (margin ${e.margin})` : ''}
                          {e.reasons?.[0] ? <span className="text-slate-500"> — {e.reasons[0]}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <History className="h-4 w-4 text-indigo-600" /> Precedents in this graph
                    </span>
                    {(t.outputResult?.precedents ?? []).length === 0 && (
                      <p className="text-slate-500 leading-snug">
                        No prior decision in the graph matches this booking, shipper or rule. This is a first — the absence is the finding.
                      </p>
                    )}
                    <ul className="space-y-2">
                      {(t.outputResult?.precedents ?? []).map((p: any) => (
                        <li key={p.id} className="leading-snug">
                          <p className="text-slate-700">{p.summary}</p>
                          <p className="text-[11px] text-slate-500">
                            {p.outcome} · {p.decidedBy || 'unknown person'} · {p.at ? new Date(p.at).toLocaleDateString() : 'undated'}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Network className="h-4 w-4 text-indigo-600" /> Decision trace
                    </span>
                    <p className="text-slate-600">
                      {(t.outputResult?.trace?.nodes?.length ?? 0)} graph nodes · {(t.outputResult?.trace?.edges?.length ?? 0)} hops ·{' '}
                      {(t.outputResult?.citations?.length ?? 0)} cited chunks
                    </p>
                    <p className="text-[11px] text-slate-500 font-mono break-all">traceId: {t.outputResult?.trace?.traceId || 'none'}</p>
                    <ul className="space-y-1 text-slate-600">
                      {(t.outputResult?.citations ?? []).slice(0, 3).map((c: any, i: number) => (
                        <li key={i} className="leading-snug">
                          <span className="font-medium text-slate-800">{c.documentTitle || c.title || 'source'}</span>
                          {c.snippet ? <span className="text-slate-500"> — {String(c.snippet).slice(0, 90)}…</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </Card>
          ))}

          {stagedTasks.length === 0 && (
            <div className="text-center text-xs text-slate-400 font-medium py-14 bg-white border border-slate-200/90 rounded-2xl">
              No tasks currently staged for approval. Run a Freight Desk or Email Desk workflow in Copilot mode to stage a task for approval.
            </div>
          )}
        </div>

        {/* Recently Approved / Completed Tasks */}
        {completedTasks.length > 0 && (
          <div className="pt-6 space-y-3">
            <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Executed & Approved Task History ({completedTasks.length})
            </h4>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {completedTasks.map((t) => (
                <div key={t.id} className="p-4 bg-white border border-slate-200/80 rounded-2xl text-xs flex items-center justify-between shadow-2xs">
                  <div className="space-y-0.5">
                    <p className="font-bold text-slate-900">{t.agent?.name || 'Agent'} — {t.taskType}</p>
                    <p className="text-[11px] text-slate-500 font-mono">Executed at {new Date(t.updatedAt || t.createdAt).toLocaleString()}</p>
                  </div>
                  <Badge variant="success" className="text-[11px]">
                    COMPLETED
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
