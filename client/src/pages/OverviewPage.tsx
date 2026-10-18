import React, { useEffect, useState } from 'react';
import { Brain, History, Search, ArrowRight, ShieldCheck, Mail, Ship, CheckCircle2, AlertCircle, FileText, Cpu, Lock, Sparkles, Network, CheckSquare, Link2, HeartPulse } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlayCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface OverviewPageProps {
  user?: any;
  sources: any[];
  skills: any[];
  agents: any[];
  auditLogs: any[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  handleAskBrain: (e: React.FormEvent) => void;
  loading: boolean;
  brainResult: any;
  onNavigateTab?: (tab: string) => void;
  handleSeedDemo?: () => void;
  seeding?: boolean;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  user,
  sources,
  skills,
  agents,
  auditLogs,
  searchQuery,
  setSearchQuery,
  handleAskBrain,
  loading,
  brainResult,
  onNavigateTab,
  handleSeedDemo,
  seeding,
}) => {
  const exampleQueries = [
    'What is our denied-party screening rule for container bookings?',
    'What is our credit limit threshold for new corporate freight accounts?',
    'How do we handle customs clearance delays at Hamburg Port?',
  ];

  const quickLaunchItems = [
    { title: 'Freight & Customs', desc: 'Screen container bookings against denied parties', icon: Ship, tab: 'freight', bg: 'from-blue-50 to-indigo-50 border-blue-200/80 text-blue-700' },
    { title: 'Email Triage Desk', desc: 'RAG-grounded customer email auto-replies', icon: Mail, tab: 'email', bg: 'from-purple-50 to-indigo-50 border-purple-200/80 text-purple-700' },
    { title: 'Executable Skills', desc: 'Auto-extracted versioned SOP rule execution', icon: ShieldCheck, tab: 'skills', bg: 'from-emerald-50 to-teal-50 border-emerald-200/80 text-emerald-700' },
    { title: 'Knowledge Graph', desc: 'Multi-hop entity relations & SOP lineage', icon: Network, tab: 'graph', bg: 'from-cyan-50 to-blue-50 border-cyan-200/80 text-cyan-700' },
    { title: 'Task Approvals', desc: 'Human-in-the-loop Copilot action queue', icon: CheckSquare, tab: 'approvals', bg: 'from-amber-50 to-orange-50 border-amber-200/80 text-amber-700' },
    { title: 'Data Connectors', desc: 'Ingest Gmail, Drive, Databases, URLs, Files', icon: DatabaseIcon, tab: 'sources', bg: 'from-slate-50 to-indigo-50 border-slate-200/80 text-slate-700' },
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Greeting & Headline */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            Welcome back,{' '}
            <span className="px-2.5 py-0.5 rounded-lg bg-indigo-600 text-white font-semibold shadow-xs">
              {user?.name || (user?.email ? String(user.email).split('@')[0] : 'there')}
            </span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">Neutronz AI-OS and Company Brain operational status & real-time telemetry.</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {handleSeedDemo && (
            <Button
              type="button"
              onClick={handleSeedDemo}
              disabled={seeding}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-5 py-2.5 rounded-xl font-medium shadow-xs flex items-center gap-1.5"
            >
              <PlayCircle className="h-4 w-4" />
              {seeding ? 'Building graph…' : 'Load demo company'}
            </Button>
          )}
          <div className="flex items-center space-x-2 text-xs">
            <Badge variant="success" className="px-3 py-1 text-xs shadow-2xs">System Online</Badge>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500 font-mono text-[11px] flex items-center gap-1">
          </span>
          </div>
        </div>
      </div>


      {/* 4 Pastel Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => onNavigateTab?.('sources')}
          className="p-5 rounded-2xl bg-gradient-to-br from-indigo-50/80 via-indigo-50/40 to-white border border-indigo-100 shadow-2xs space-y-2 cursor-pointer hover:border-indigo-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-700">Data Sources</span>
            <DatabaseIcon className="h-4 w-4 text-indigo-500" />
          </div>
          <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{sources.length}</p>
          <p className="text-[11px] text-slate-500 font-medium">Gmail, Drive, Slack, Databases, Web URLs</p>
        </div>

        <div
          onClick={() => onNavigateTab?.('skills')}
          className="p-5 rounded-2xl bg-gradient-to-br from-emerald-50/80 via-emerald-50/40 to-white border border-emerald-100 shadow-2xs space-y-2 cursor-pointer hover:border-emerald-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-700">Executable SOP Skills</span>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{skills.length}</p>
          <p className="text-[11px] text-slate-500 font-medium">Versioned SOP rule enforcement</p>
        </div>

        <div
          onClick={() => onNavigateTab?.('agents')}
          className="p-5 rounded-2xl bg-gradient-to-br from-amber-50/80 via-amber-50/40 to-white border border-amber-100 shadow-2xs space-y-2 cursor-pointer hover:border-amber-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-700">Active AI Agents</span>
            <Brain className="h-4 w-4 text-amber-500" />
          </div>
          <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{agents.length}</p>
          <p className="text-[11px] text-slate-500 font-medium">Copilot & Autopilot steerable</p>
        </div>

        <div
          onClick={() => onNavigateTab?.('audit')}
          className="p-5 rounded-2xl bg-gradient-to-br from-purple-50/80 via-purple-50/40 to-white border border-purple-100 shadow-2xs space-y-2 cursor-pointer hover:border-purple-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-purple-700">Audit Actions</span>
            <History className="h-4 w-4 text-purple-500" />
          </div>
          <p className="text-3xl font-extrabold text-slate-900 tracking-tight">{auditLogs.length}</p>
          <p className="text-[11px] text-slate-500 font-medium">Retained append-only audit stream</p>
        </div>
      </div>

      {/* Quick Launch Control Modules */}
      <div className="space-y-3">
        <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-600" /> Operational Control Modules & Domain Cockpits
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {quickLaunchItems.map((item, idx) => {
            const IconComp = item.icon;
            return (
              <div
                key={idx}
                onClick={() => onNavigateTab?.(item.tab)}
                className={`p-4 rounded-2xl bg-gradient-to-br ${item.bg} border shadow-2xs cursor-pointer hover:scale-[1.02] transition-transform space-y-2 flex flex-col justify-between`}
              >
                <div className="space-y-1">
                  <div className="h-8 w-8 rounded-xl bg-white/80 border border-white flex items-center justify-center font-bold shadow-2xs">
                    <IconComp className="h-4 w-4" />
                  </div>
                  <p className="font-bold text-xs text-slate-900 tracking-tight">{item.title}</p>
                  <p className="text-[10px] text-slate-600 leading-tight">{item.desc}</p>
                </div>
                <div className="pt-2 flex items-center text-[10px] font-bold gap-1 text-indigo-700">
                  Open Cockpit <ArrowRight className="h-3 w-3" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Knowledge Health (W5) + Decision Ledger (W4) */}
      <TrustHealthSection />

      {/* 2 Main Columns: Ask Brain Search & Needs Attention / Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Ask Brain & Grounded QA (7 cols) */}
        <Card className="lg:col-span-7 rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs space-y-5">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold shrink-0">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 tracking-tight">Ask Company Brain</h3>
              <p className="text-xs text-slate-500">Search firm SOPs, Knowledge Graph relations, and multi-hop citations</p>
            </div>
          </div>

          <form onSubmit={handleAskBrain} className="flex items-center space-x-2 bg-slate-50 p-2.5 rounded-2xl border border-slate-200 focus-within:border-indigo-500 transition-colors">
            <Search className="h-4.5 w-4.5 text-slate-400 ml-2 shrink-0" />
            <input
              type="text"
              placeholder="Ask anything about firm SOPs, rules, procedures, or compliance guidelines..."
              className="flex-1 bg-transparent border-0 text-xs text-slate-900 focus:outline-none px-2 placeholder:text-slate-400"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button type="submit" disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-5 py-2 font-medium shrink-0 shadow-xs">
              {loading ? 'Searching...' : 'Ask Brain'}
            </Button>
          </form>

          {/* Quick Query Pill Shortcuts */}
          <div className="flex flex-wrap gap-2 pt-1">
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
                className="text-[11px] bg-slate-100/80 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 px-3 py-1 rounded-xl border border-slate-200/60 transition-colors text-left font-medium"
              >
                "{q}"
              </button>
            ))}
          </div>

          {brainResult ? (
            <div className="p-5 bg-indigo-50/50 border border-indigo-100 rounded-2xl text-xs space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-indigo-950 text-xs flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5 text-indigo-600" /> Grounded Response
                </span>
                <Badge variant="outline" className="text-[10px] bg-white text-indigo-700 font-mono">{brainResult.latencyMs}ms</Badge>
              </div>
              <p className="text-slate-800 leading-relaxed whitespace-pre-line">{brainResult.answer}</p>
              {brainResult.citations?.length > 0 && (
                <div className="pt-2 border-t border-indigo-100 space-y-1">
                  <span className="font-bold text-slate-900 text-[11px]">Verifiable Document Citations:</span>
                  {brainResult.citations.map((c: any, i: number) => (
                    <div key={i} className="text-indigo-600 hover:underline text-[11px] flex items-center gap-1">
                      <FileText className="h-3 w-3 text-indigo-500 shrink-0" /> [{i + 1}] {c.documentTitle} (Score: {c.relevanceScore})
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="p-6 bg-slate-50/60 rounded-2xl border border-dashed border-slate-200 text-center space-y-2">
              <p className="text-xs font-semibold text-slate-600">No active query run yet</p>
              <p className="text-[11px] text-slate-400">Type a question above or click a suggested query pill to search company knowledge.</p>
            </div>
          )}
        </Card>

        {/* Right Column: Needs Attention & Activity Trail (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Copilot Desks (navigation — no fabricated queue state) */}
          <Card className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <span>Copilot Desks</span>
              </h3>
              <Badge variant="secondary" className="text-[10px]">Human-in-the-loop</Badge>
            </div>

            <div className="space-y-2">
              <div
                onClick={() => onNavigateTab?.('freight')}
                className="p-3 bg-amber-50/60 hover:bg-amber-100/60 border border-amber-100 rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors"
              >
                <div>
                  <p className="font-bold text-slate-900">Freight / Customs Desk</p>
                  <p className="text-[11px] text-slate-500">Screen a booking against denied-party and credit rules</p>
                </div>
                <Ship className="h-4 w-4 text-amber-600 shrink-0" />
              </div>

              <div
                onClick={() => onNavigateTab?.('approvals')}
                className="p-3 bg-indigo-50/60 hover:bg-indigo-100/60 border border-indigo-100 rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors"
              >
                <div>
                  <p className="font-bold text-slate-900">Task Approvals</p>
                  <p className="text-[11px] text-slate-500">Review and approve actions agents staged for a human</p>
                </div>
                <CheckSquare className="h-4 w-4 text-indigo-600 shrink-0" />
              </div>
            </div>
          </Card>

          {/* Activity Trail Card */}
          <Card className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 flex items-center space-x-2">
                <History className="h-4 w-4 text-indigo-600" />
                <span>Recent Activity Trail</span>
              </h3>
              <button
                type="button"
                onClick={() => onNavigateTab?.('audit')}
                className="text-[11px] font-bold text-indigo-600 hover:underline"
              >
                View Audit Log
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto">
              {auditLogs.slice(0, 4).map((log) => (
                <div key={log.id} className="p-3 bg-slate-50 rounded-xl text-xs border border-slate-100 flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-slate-900">{log.action}</p>
                    <p className="text-slate-400 text-[10px]">{new Date(log.createdAt).toLocaleTimeString()}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">{log.agent?.name || 'System'}</Badge>
                </div>
              ))}
              {auditLogs.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No recent activity logged.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

function DatabaseIcon(props: any) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
    </svg>
  );
}

/** W5 Knowledge Health + W4 hash-chained Decision Ledger, side by side. */
const TrustHealthSection: React.FC = () => {
  const [health, setHealth] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.healthReport().then(setHealth).catch((e: any) => setError(e.message));
    api.listLedger(8).then(setLedger).catch(() => {});
  }, []);

  const scoreTone = (score: number): 'success' | 'warning' | 'destructive' =>
    score >= 80 ? 'success' : score >= 50 ? 'warning' : 'destructive';
  const severityTone = (s: string): 'destructive' | 'warning' | 'secondary' =>
    s === 'HIGH' ? 'destructive' : s === 'MEDIUM' ? 'warning' : 'secondary';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Knowledge Health Report */}
      <Card className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-indigo-600" /> Knowledge Health
          </h3>
          {health && (
            <Badge variant={scoreTone(health.score)} className="text-[11px]">
              Score {health.score}/100
            </Badge>
          )}
        </div>

        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

        {!health && !error && <p className="text-xs text-slate-400 py-4 text-center">Scanning the graph…</p>}

        {health && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(health.counts || {}).map(([sev, n]: any) => (
                <Badge key={sev} variant={severityTone(sev)} className="text-[10px]">{sev}: {n}</Badge>
              ))}
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {(health.findings || []).map((f: any, i: number) => (
                <div key={i} className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800">{f.subjectName}</span>
                    <Badge variant={severityTone(f.severity)} className="text-[10px] shrink-0">{f.severity}</Badge>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{f.kind}{f.detail ? ` — ${f.detail}` : ''}</p>
                </div>
              ))}
              {(health.findings || []).length === 0 && (
                <p className="text-xs text-emerald-700 font-medium py-2">No issues found — every policy is owned, sourced, and fresh.</p>
              )}
            </div>
          </>
        )}
      </Card>

      {/* Decision Ledger */}
      <Card className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <Link2 className="h-4 w-4 text-indigo-600" /> Decision Ledger
          </h3>
          {ledger?.chain && (
            <Badge variant={ledger.chain.ok ? 'success' : 'destructive'} className="text-[11px]">
              {ledger.chain.ok ? `Chain intact · ${ledger.chain.entries} entries` : `BROKEN at #${ledger.chain.brokenAt}`}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-slate-500">
          Every agent verdict and human approval is appended as a hash-chained entry (sha256 of the previous hash + body). Any tamper breaks the chain and is detected by re-verification.
        </p>

        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {(ledger?.entries || []).slice().reverse().map((e: any) => (
            <div key={e.seq} className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-slate-800 font-mono text-[11px]">#{e.seq} {e.kind}</p>
                <p className="text-[10px] text-slate-500 truncate">{e.actor} · {new Date(e.at).toLocaleString()}</p>
              </div>
              <span className="text-[10px] font-mono text-slate-400 shrink-0" title={e.hash}>{String(e.hash || '').slice(0, 10)}…</span>
            </div>
          ))}
          {ledger && (!ledger.entries || ledger.entries.length === 0) && (
            <p className="text-xs text-slate-400 py-2">No decisions recorded yet. Run a freight check or apply a rule change.</p>
          )}
        </div>
      </Card>
    </div>
  );
};
