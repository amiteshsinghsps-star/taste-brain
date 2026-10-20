import React, { useEffect, useState } from 'react';
import { Brain, Search, ExternalLink, Sparkles, HelpCircle, FileText, Copy, Check, GitBranch, Database, Scale, ThumbsUp, ThumbsDown, Pin, PinOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

interface AskBrainPageProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  handleAskBrain: (e: React.FormEvent) => void;
  loading: boolean;
  brainResult: any;
}

export const AskBrainPage: React.FC<AskBrainPageProps> = ({
  searchQuery,
  setSearchQuery,
  handleAskBrain,
  loading,
  brainResult,
}) => {
  const [copied, setCopied] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<any>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [compare, setCompare] = useState<any>(null);
  const [comparing, setComparing] = useState(false);
  const [feedbackState, setFeedbackState] = useState<'UP' | 'DOWN' | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<any[]>([]);
  const [pinBusy, setPinBusy] = useState(false);

  const loadSaved = async () => {
    try {
      const res: any = await api.listSavedQueries();
      setSaved(res.items || []);
    } catch {
      setSaved([]);
    }
  };

  useEffect(() => {
    loadSaved();
  }, []);

  const sendFeedback = async (verdict: 'UP' | 'DOWN') => {
    if (!brainResult) return;
    setFeedbackBusy(true);
    setFeedbackNote(null);
    try {
      const res: any = await api.recordFeedback({
        question: searchQuery,
        verdict,
        traceId: brainResult.trace?.traceId,
        chunkIds: (brainResult.citations || []).map((c: any) => c.chunkId).filter(Boolean),
        answerSnippet: String(brainResult.answer || '').slice(0, 300),
      });
      setFeedbackState(verdict);
      const linked = res.feedback?.linkedChunks?.length ?? 0;
      setFeedbackNote(
        verdict === 'DOWN'
          ? `Recorded. ${linked} cited chunk(s) linked — a thumbs-down on a source becomes a Knowledge Health finding on that exact chunk.`
          : `Recorded against ${linked} cited chunk(s).`
      );
    } catch (err: any) {
      setFeedbackNote(err.message || 'Feedback failed');
    } finally {
      setFeedbackBusy(false);
    }
  };

  const togglePin = async () => {
    const question = searchQuery;
    if (!question.trim()) return;
    setPinBusy(true);
    try {
      const existing = saved.find((s) => s.question === question);
      if (existing) {
        await api.deleteSavedQuery(existing.id);
      } else {
        await api.saveQuery({
          question,
          snippet: String(brainResult?.answer || '').slice(0, 200),
          traceId: brainResult?.trace?.traceId,
        });
      }
      await loadSaved();
    } finally {
      setPinBusy(false);
    }
  };

  const pinnedQuestion = saved.some((s) => s.question === searchQuery);

  const runCompare = async () => {
    if (!searchQuery) return;
    setComparing(true);
    setCompare(null);
    try {
      const res: any = await api.compareAnswer(searchQuery);
      setCompare(res);
    } catch (err: any) {
      setCompare({ error: err.message || 'Compare failed' });
    } finally {
      setComparing(false);
    }
  };

  const exampleQueries = [
    'What is our denied-party screening rule for container bookings?',
    'What is our credit limit threshold for new corporate freight accounts?',
    'How do we handle customs clearance delays at Hamburg Port?',
    'What are the mandatory invoice approval rules for accounts payable?',
  ];

  const handleCopyAnswer = () => {
    if (brainResult?.answer) {
      navigator.clipboard.writeText(brainResult.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const renderFormattedAnswer = (text: string) => {
    if (!text) return null;
    const lines = text.split('\n');
    return lines.map((line, lIdx) => {
      const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      return (
        <p key={lIdx} className="mb-2 leading-relaxed text-sm text-slate-800">
          {parts.map((part, pIdx) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={pIdx} className="font-bold text-slate-950">{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith('`') && part.endsWith('`')) {
              return (
                <code key={pIdx} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 font-mono text-[12px] rounded border border-indigo-100/80">
                  {part.slice(1, -1)}
                </code>
              );
            }
            return part;
          })}
        </p>
      );
    });
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Hero Header */}
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-2">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold shadow-xs">
            <Sparkles className="h-4 w-4" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Ask Company Brain</h1>
        </div>
        <p className="text-xs text-slate-500">
          Search firm SOPs, ingested documents, and Knowledge Graph multi-hop paths with verifiable citations.
        </p>
      </div>

      {/* Main Search Card */}
      <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-5">
        <form onSubmit={handleAskBrain} className="flex items-center space-x-3 bg-slate-50 p-2.5 rounded-2xl border border-slate-200 focus-within:border-indigo-500 transition-colors">
          <Search className="h-5 w-5 text-slate-400 ml-2 shrink-0" />
          <input
            type="text"
            placeholder="Ask anything about firm SOPs, rules, procedures, or compliance guidelines..."
            className="flex-1 bg-transparent border-0 text-sm text-slate-900 focus:outline-none px-2 placeholder:text-slate-400"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-6 py-2.5 font-medium shrink-0 shadow-xs">
            {loading ? 'Querying RAG...' : 'Search Brain'}
          </Button>
        </form>

        {/* Suggested Queries */}
        <div className="space-y-2 pt-1">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <HelpCircle className="h-3 w-3" /> Suggested SOP Queries
          </span>
          <div className="flex flex-wrap gap-2">
            {exampleQueries.map((q, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setSearchQuery(q);
                  setTimeout(() => {
                    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
                    handleAskBrain(fakeEvent);
                  }, 50);
                }}
                className="text-xs bg-slate-100/80 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 px-3 py-1.5 rounded-xl border border-slate-200/60 transition-colors text-left font-medium"
              >
                "{q}"
              </button>
            ))}
          </div>
        </div>

        {/* Pinned brain queries for this tenant */}
        {saved.length > 0 && (
          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Pin className="h-3 w-3" /> Pinned queries ({saved.length})
            </span>
            <div className="flex flex-wrap gap-2">
              {saved.map((s: any) => (
                <span
                  key={s.id}
                  className="text-xs bg-white hover:bg-indigo-50 text-slate-700 pl-3 pr-1.5 py-1 rounded-xl border border-slate-200/80 flex items-center gap-1 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery(s.question);
                      setTimeout(() => handleAskBrain({ preventDefault: () => {} } as React.FormEvent), 50);
                    }}
                    className="font-medium"
                    title={s.traceId ? `trace ${s.traceId}` : undefined}
                  >
                    {s.question}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.deleteSavedQuery(s.id);
                      loadSaved();
                    }}
                    className="text-slate-300 hover:text-red-600"
                    title="Unpin"
                  >
                    <PinOff className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Grounded Response Output */}
        {brainResult && (
          <div className="space-y-6 pt-4 border-t border-slate-100">
            <div className="p-6 bg-indigo-50/40 border border-indigo-100 rounded-2xl space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Brain className="h-4 w-4 text-indigo-600" /> Grounded RAG Answer
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] bg-white text-indigo-700 font-mono">
                    Latency: {brainResult.latencyMs}ms
                  </Badge>
                  <button
                    type="button"
                    onClick={handleCopyAnswer}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-700 transition-colors flex items-center gap-1"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-indigo-600" />}
                    {copied ? 'Copied' : 'Copy Answer'}
                  </button>
                </div>
              </div>

              {renderFormattedAnswer(brainResult.answer)}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] font-semibold text-slate-500">Useful?</span>
                <button
                  type="button"
                  onClick={() => sendFeedback('UP')}
                  disabled={feedbackBusy}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 disabled:opacity-50 ${
                    feedbackState === 'UP'
                      ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-emerald-50'
                  }`}
                >
                  <ThumbsUp className="h-3 w-3" /> Yes
                </button>
                <button
                  type="button"
                  onClick={() => sendFeedback('DOWN')}
                  disabled={feedbackBusy}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 disabled:opacity-50 ${
                    feedbackState === 'DOWN'
                      ? 'bg-red-100 border-red-300 text-red-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-red-50'
                  }`}
                >
                  <ThumbsDown className="h-3 w-3" /> No
                </button>
                <button
                  type="button"
                  onClick={togglePin}
                  disabled={pinBusy}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 disabled:opacity-50 ${
                    pinnedQuestion
                      ? 'bg-indigo-100 border-indigo-300 text-indigo-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-indigo-50'
                  }`}
                >
                  {pinnedQuestion ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                  {pinnedQuestion ? 'Unpin' : 'Pin this query'}
                </button>
                {feedbackBusy && <span className="text-[11px] text-slate-400">Saving…</span>}
                {feedbackNote && <span className="text-[11px] text-slate-500">{feedbackNote}</span>}
              </div>
              <p className="text-[10px] text-slate-400">
                Rating writes a Feedback node in this tenant's graph and links it to the cited chunks with an ABOUT edge —
                a thumbs-down with no matching upvote shows up as a Knowledge Health finding.
              </p>
            </div>

            {/* Decision Trace ("Why?" — graph path provenance) */}
            {brainResult.trace && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowTrace((s) => !s)}
                    className="font-bold text-sm text-slate-900 flex items-center gap-2 hover:text-indigo-700 transition-colors"
                  >
                    <GitBranch className={`h-4 w-4 ${showTrace ? 'text-indigo-600' : 'text-slate-500'}`} />
                    <span>{showTrace ? 'Hide' : 'Why?'} — Decision Trace ({brainResult.trace.nodes.length} nodes / {brainResult.trace.edges.length} edges)</span>
                  </button>
                  {brainResult.freshness && (
                    <Badge variant="outline" className="text-[10px] bg-white">
                      <Database className="h-3 w-3 mr-1 text-emerald-600" />
                      {brainResult.graphName || 'tenant graph'} · superseded used: {String(brainResult.freshness.usedSuperseded)}
                    </Badge>
                  )}
                </div>

                {showTrace && (
                  <div className="p-4 bg-slate-900 rounded-2xl space-y-3 shadow-lg">
                    {Array.isArray(brainResult.traceSentences) && brainResult.traceSentences.length > 0 ? (
                      <ol className="space-y-1.5 list-decimal list-inside">
                        {brainResult.traceSentences.slice(0, 12).map((s: string, i: number) => (
                          <li key={i} className="text-xs text-emerald-200 font-mono leading-relaxed">{s}</li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-xs text-slate-400">Trace path: {brainResult.trace.nodes.map((n: any) => `${n.label}:${n.name}`).slice(0, 8).join(' → ')}</p>
                    )}
                    {brainResult.trace.cypher && (
                      <details>
                        <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-200">Show query</summary>
                        <pre className="mt-2 p-3 bg-black/40 rounded-xl text-[10px] text-cyan-300 overflow-x-auto font-mono whitespace-pre-wrap">{brainResult.trace.cypher}</pre>
                      </details>
                    )}
                    <p className="text-[10px] text-slate-500">Decision Trace ≠ proof of correctness — it is the exact graph path and source chunks used for this answer.</p>
                  </div>
                )}
              </div>
            )}

            {/* Citations Grid */}
            {brainResult.citations && brainResult.citations.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                  <FileText className="h-4 w-4 text-indigo-600" />
                  <span>Verifiable Document Citations ({brainResult.citations.length})</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {brainResult.citations.map((c: any, idx: number) => (
                    <div
                      key={idx}
                      onClick={() => setSelectedCitation(c)}
                      className="p-4 bg-white border border-slate-200/90 hover:border-indigo-300 rounded-2xl shadow-xs space-y-2 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-indigo-600 text-xs flex items-center truncate">
                          <ExternalLink className="h-3 w-3 mr-1.5 shrink-0" /> [{idx + 1}] {c.documentTitle}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">Score {c.relevanceScore}</Badge>
                      </div>
                      <p className="text-xs text-slate-600 italic leading-snug line-clamp-3">"{c.snippet}"</p>
                      <span className="text-[10px] font-mono text-slate-400">chunk {c.chunkId}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Graph-vs-RAG comparison (W2) */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={comparing || !searchQuery}
                  onClick={runCompare}
                  className="text-xs border-slate-200 text-slate-700 bg-white"
                >
                  <Scale className="h-3.5 w-3.5 mr-1.5 text-indigo-600" />
                  {comparing ? 'Running both systems...' : 'Compare with plain RAG'}
                </Button>
                <p className="text-[10px] text-slate-400">
                  Same chunks, same LLM, same temperature — the only difference is the graph (entity linking, expansion, currency filter).
                </p>
              </div>

              {compare?.error && <p className="text-xs text-red-600 font-medium">{compare.error}</p>}

              {compare && !compare.error && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-white border border-slate-200/90 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-slate-700">Plain RAG (top-5 similar chunks)</span>
                      <Badge variant="secondary" className="text-[10px]">{compare.baseline.latencyMs}ms · {compare.baseline.citations?.length || 0} citations</Badge>
                    </div>
                    <div className="text-xs text-slate-600 leading-relaxed max-h-56 overflow-y-auto whitespace-pre-line">{compare.baseline.answer}</div>
                  </div>
                  <div className="p-4 bg-indigo-50/40 border border-indigo-200 rounded-2xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-indigo-800 flex items-center gap-1">
                        <Brain className="h-3.5 w-3.5" /> Neutronz graph-first
                      </span>
                      <Badge variant="outline" className="text-[10px] bg-white">{compare.neutronz.latencyMs}ms · {compare.neutronz.citations?.length || 0} citations</Badge>
                    </div>
                    <div className="text-xs text-slate-700 leading-relaxed max-h-56 overflow-y-auto whitespace-pre-line">{compare.neutronz.answer}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Citation Details Inspection Modal */}
      {selectedCitation && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md uppercase tracking-wider">Document Citation Inspection</span>
                <h3 className="text-sm font-bold text-slate-900 mt-1 flex items-center gap-1.5">
                  <ExternalLink className="h-4 w-4 text-indigo-600" /> {selectedCitation.documentTitle}
                </h3>
              </div>
              <Badge variant="secondary" className="text-[10px]">Score {selectedCitation.relevanceScore}</Badge>
            </div>

            <div className="space-y-2 text-xs">
              <span className="font-bold text-slate-700">Full Retrieved Vector Snippet Chunk:</span>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 leading-relaxed font-mono text-[11px] whitespace-pre-line max-h-60 overflow-y-auto">
                {selectedCitation.snippet}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <Button size="sm" variant="ghost" onClick={() => setSelectedCitation(null)} className="text-xs">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
