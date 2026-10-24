// Taste Brain — the shell. One run in memory, fourteen screens over it, and a
// header that always tells you which mode the data came in and what is left of
// the budget. Screens never hold state of their own beyond their inputs.

import { Component, useEffect, useState, type FC, type ReactNode } from 'react';
import { ModeBadge, ModeMixLine } from '@/components/common';
import { AppProvider } from '@/lib/state';
import { useApp } from '@/lib/app-context';
import type { TasteMode } from '@/lib/types';
import PlanScreen from '@/screens/PlanScreen';
import EvidenceScreen from '@/screens/EvidenceScreen';
import TraceScreen from '@/screens/TraceScreen';
import WhyNotScreen from '@/screens/WhyNotScreen';
import WhatIfScreen from '@/screens/WhatIfScreen';
import PartnersScreen from '@/screens/PartnersScreen';
import AblationScreen from '@/screens/AblationScreen';
import TrustScreen from '@/screens/TrustScreen';
import CoverageScreen from '@/screens/CoverageScreen';
import LedgerScreen from '@/screens/LedgerScreen';
import VerifyScreen from '@/screens/VerifyScreen';
import BreakItScreen from '@/screens/BreakItScreen';
import BudgetScreen from '@/screens/BudgetScreen';
import FinalsScreen from '@/screens/FinalsScreen';
import TasteLiftScreen from '@/screens/TasteLiftScreen';
import AboutScreen from '@/screens/AboutScreen';

/**
 * One screen's render error must not take the header, the nav and the other
 * fourteen screens down with it — and with the tab restored from the URL hash, a
 * reload would otherwise drop straight back into the same crash.
 */
class ScreenBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <div className="font-semibold">This screen threw and was stopped: {this.state.error.message}</div>
        <p className="mt-1 text-xs leading-relaxed">
          The rest of the app is intact — pick another tab. Nothing was written, approved or sent to Qloo by this failure.
        </p>
        <button className="mt-2 cursor-pointer rounded border border-red-300 bg-white px-2 py-1 text-xs" onClick={() => this.setState({ error: null })}>
          Retry this screen
        </button>
      </div>
    );
  }
}

const NAV: { group: string; items: [string, string, FC][] }[] = [
  { group: 'Decide', items: [['plan', 'Plan', PlanScreen], ['evidence', 'Evidence', EvidenceScreen], ['trace', 'Trace', TraceScreen]] },
  { group: 'Question', items: [['whynot', 'Why not?', WhyNotScreen], ['whatif', 'What if?', WhatIfScreen], ['partners', 'Partners', PartnersScreen]] },
  { group: 'Prove it', items: [['ablation', 'Ablation', AblationScreen], ['trust', 'Trust', TrustScreen], ['verify', 'Verify', VerifyScreen], ['breakit', 'Break it', BreakItScreen], ['coverage', 'Coverage', CoverageScreen], ['ledger', 'Ledger', LedgerScreen]] },
  { group: 'Operate', items: [['budget', 'Budget', BudgetScreen], ['finals', 'Finals', FinalsScreen], ['lift', 'Taste Lift', TasteLiftScreen], ['about', 'About', AboutScreen]] },
];

const MODE_HINT: Record<TasteMode, string> = {
  live: 'Ask Qloo now, inside the call budget. Falls back to Cached, then Replay, and says so.',
  cached: 'Use the private stored answer; the live call is not repeated.',
  replay: 'Synthetic fixtures only. Runs with no key and never claims to be live.',
};

function Shell() {
  const app = useApp();
  const [tab, setTab] = useState(() => (typeof window === 'undefined' ? 'plan' : window.location.hash.replace('#', '') || 'plan'));

  useEffect(() => { window.location.hash = tab; }, [tab]);

  // Back and Forward change the hash on their own. Following it keeps the URL and
  // the screen in agreement — otherwise a reload after pressing Back jumps to a
  // screen the operator is not looking at.
  useEffect(() => {
    const follow = () => setTab(window.location.hash.replace('#', '') || 'plan');
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  const Screen = NAV.flatMap((g) => g.items).find(([id]) => id === tab)?.[2] ?? PlanScreen;
  const info = app.modeInfo;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <div className="mr-auto">
            <h1 className="text-lg font-bold tracking-tight">Taste Brain</h1>
            <p className="text-xs text-slate-500">decision governance for taste-driven rooms — rules from the business, taste from Qloo, a trace for every call</p>
          </div>

          {app.proposal && (
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600">
              <span>active run</span>
              <code className="font-mono">{app.proposal.proposal_id}</code>
              <ModeBadge mode={app.proposal.mode} />
              <ModeMixLine mix={app.proposal.trace.mode_mix} compact />
              <span>{app.proposal.items.length} item(s) · {app.proposal.status}</span>
              {app.servedFrom === 'snapshot' && <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">FINALS MODE</span>}
              {app.servedFrom === 'restored' && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800" title="Re-served from the store — this room's newest stored run, nothing new was computed">restored from the store</span>}
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">request mode</span>
            {(['replay', 'cached', 'live'] as TasteMode[]).map((m) => (
              <button key={m} onClick={() => app.setMode(m)} className="cursor-pointer" title={MODE_HINT[m]}>
                <span className={app.mode === m ? '' : 'opacity-45'}><ModeBadge mode={m} /></span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span title="The key lives in the server environment and is never sent to this browser">qloo key: <strong>{info?.qloo_key ?? '—'}</strong></span>
            {info?.finals_mode && <span className="rounded bg-indigo-600 px-1.5 py-0.5 font-semibold text-white">FINALS MODE ON</span>}
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-2">
          {NAV.map((g) => (
            <div key={g.group} className="flex items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</span>
              {g.items.map(([id, label]) => (
                <button
                  key={id} onClick={() => setTab(id)}
                  className={`cursor-pointer rounded-md px-2.5 py-1 text-xs ${tab === id ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >{label}</button>
              ))}
            </div>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <ScreenBoundary key={tab}>
          <Screen />
        </ScreenBoundary>
      </main>

      <footer className="mx-auto max-w-7xl px-5 pb-8 text-[11px] leading-relaxed text-slate-500">
        Taste Brain · Qloo Agentic Hackathon. Live Qloo for taste, the venue’s own SOP for rules, a named person for the
        decision, and a hash-chained ledger for everything in between. Replay data is synthetic and labelled; nothing is
        presented as live that is not.
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
