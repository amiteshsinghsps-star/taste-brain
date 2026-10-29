// Taste Brain — the shell. One run in memory, seventeen screens over it, and a
// header that always tells you which mode the data came in and what is left of
// the budget. Screens never hold state of their own beyond their inputs.

import { Component, useCallback, useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { ModeBadge, ModeMixLine } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppProvider } from '@/lib/state';
import { useApp } from '@/lib/app-context';
import type { TasteMode } from '@/lib/types';
import { CommandPalette, HelpModal, QuotaBar, ServerDot, ToastHost } from '@/components/shell-extras';
import { pushToast } from '@/lib/toast-bus';
import { useClickOutside, useHealth, useLocalStorage } from '@/lib/shell-hooks';
import PlanScreen from '@/screens/PlanScreen';
import EvidenceScreen from '@/screens/EvidenceScreen';
import TraceScreen from '@/screens/TraceScreen';
import WhyNotScreen from '@/screens/WhyNotScreen';
import WhatIfScreen from '@/screens/WhatIfScreen';
import PartnersScreen from '@/screens/PartnersScreen';
import AblationScreen from '@/screens/AblationScreen';
import TrustScreen from '@/screens/TrustScreen';
import BriefScreen from '@/screens/BriefScreen';
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
  { group: 'Decide', items: [['plan', 'Plan', PlanScreen], ['evidence', 'Evidence', EvidenceScreen], ['trace', 'Trace', TraceScreen], ['brief', 'Brief', BriefScreen]] },
  { group: 'Question', items: [['whynot', 'Why not?', WhyNotScreen], ['whatif', 'What if?', WhatIfScreen], ['partners', 'Partners', PartnersScreen]] },
  { group: 'Prove it', items: [['ablation', 'Ablation', AblationScreen], ['trust', 'Trust', TrustScreen], ['verify', 'Verify', VerifyScreen], ['breakit', 'Break it', BreakItScreen], ['coverage', 'Coverage', CoverageScreen], ['ledger', 'Ledger', LedgerScreen]] },
  { group: 'Operate', items: [['budget', 'Budget', BudgetScreen], ['finals', 'Finals', FinalsScreen], ['lift', 'Taste Lift', TasteLiftScreen], ['about', 'About', AboutScreen]] },
];

const MODE_HINT: Record<TasteMode, string> = {
  live: 'Ask Qloo now, within the call budget. Falls back to stored answers when needed.',
  cached: 'Use the stored Qloo answer — no new API call.',
  replay: 'Offline sample data, for testing only.',
};

const LIVE_OFF_HINT = 'Live is switched off on this host, so no visitor can spend the team key by accident. '
  + 'The key custodian turns it on in the host environment for a planned warm-up or the finals, then off again.';

const ACCENTS = ['indigo', 'violet', 'fuchsia', 'rose', 'amber', 'orange', 'emerald', 'teal', 'sky', 'slate'] as const;
const TAB_ICON: Record<string, string> = {
  plan: '🎯', evidence: '🔍', trace: '🧾', brief: '📝',
  whynot: '❓', whatif: '🔀', partners: '🤝',
  ablation: '🧪', trust: '🛡️', verify: '🔐', breakit: '💥', coverage: '🗺️', ledger: '📒',
  budget: '⏱️', finals: '🎬', lift: '📈', about: 'ℹ️',
  Decide: '🎯', Question: '❓', 'Prove it': '🔬', Operate: '🛠',
};

// One line per screen, saying what is on it. Every claim here is about the screen
// itself, not about a number the server has yet to return.
const SCREEN_BLURB: Record<string, string> = {
  plan: 'Where a run begins — inputs down the left, the proposal down the right.',
  evidence: 'Every item the agent put forward, and the rule that cleared or refused it.',
  trace: 'The ordered record of the run: seeds, Qloo reads, rule decisions, flip points.',
  brief: 'The one-page sheet a named human signs for this run.',
  whynot: 'What the rules removed, and the exact term that removed it.',
  whatif: 'The same seeds against a changed rule, side by side with the run you have.',
  partners: 'Entities Qloo ranks beside this audience, ordered by the tags they share.',
  ablation: 'The run with one stage switched off, set against the run with it.',
  trust: 'How the results are made checkable, and the claims the app will not make.',
  verify: 'Recompute a stored run from its own inputs and report every mismatch.',
  breakit: 'Hostile inputs aimed at the engine, and what it did with each one.',
  coverage: 'Which rules, seeds and modes the test suite actually exercises.',
  ledger: 'The append-only, hash-chained record of every decision act.',
  budget: 'The Qloo call budget and quota exactly as the server reports them.',
  finals: 'The locked-down finals path: stored snapshot in, decision out.',
  lift: 'Rule arms run against the same seeds and compared arm by arm.',
  about: 'What this is, who decides what, and where every number on screen came from.',
};
const ACCENT_STOPS: Record<(typeof ACCENTS)[number], [string, string]> = {
  indigo: ['#4f46e5', '#7c3aed'], violet: ['#7c3aed', '#4f46e5'], fuchsia: ['#c026d3', '#7c3aed'],
  rose: ['#e11d48', '#be185d'], amber: ['#d97706', '#ea580c'], orange: ['#ea580c', '#db2777'],
  emerald: ['#059669', '#0d9488'], teal: ['#0d9488', '#0891b2'], sky: ['#0284c7', '#4f46e5'], slate: ['#475569', '#334155'],
};
const DENSITIES = [['cozy', 'M'], ['compact', 'S'], ['comfortable', 'L']] as const;

function Shell() {
  const app = useApp();
  const [tab, setTab] = useState(() => (typeof window === 'undefined' ? 'plan' : window.location.hash.replace('#', '') || 'plan'));
  const health = useHealth();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [accent, setAccent] = useLocalStorage<typeof ACCENTS[number]>('tb.accent', 'indigo');
  const [density, setDensity] = useLocalStorage<typeof DENSITIES[number][0]>('tb.density', 'cozy');
  const [theme, setTheme] = useLocalStorage<'light' | 'dark' | 'system'>('tb.theme', 'light');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const settingsRef = useClickOutside<HTMLDivElement>(settingsOpen, () => setSettingsOpen(false));
  const quickRef = useClickOutside<HTMLDivElement>(quickOpen, () => setQuickOpen(false));

  useEffect(() => { window.location.hash = tab; }, [tab]);

  // Back and Forward change the hash on their own. Following it keeps the URL and
  // the screen in agreement — otherwise a reload after pressing Back jumps to a
  // screen the operator is not looking at.
  useEffect(() => {
    const follow = () => setTab(window.location.hash.replace('#', '') || 'plan');
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  // Appearance prefs live on <html> so root font-size and accent vars apply globally.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.accent = accent;
    el.classList.toggle('tb-compact', density === 'compact');
    el.classList.toggle('tb-comfortable', density === 'comfortable');
  }, [accent, density]);

  // Lights-out: explicit wins; 'system' follows the OS and keeps following it.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('tb-moon', theme === 'dark' || (theme === 'system' && mq.matches));
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // Toast when a run finishes. The busy flag dropping is the one honest signal
  // that the engine produced (or refused) a result.
  const prevBusy = useRef(false);
  useEffect(() => {
    if (prevBusy.current && !app.busy) {
      if (app.error) pushToast('The engine refused this run — see the Plan screen', 'bad');
      else if (app.proposal) pushToast(`Run ${app.proposal.mode.toUpperCase()}: ${app.proposal.items.length} item(s), ${app.proposal.rejections.length} rejection(s)`, 'ok');
    }
    prevBusy.current = app.busy;
  }, [app.busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTabs = NAV.flatMap((g) => g.items);
  const flatIds = allTabs.map(([id]) => id);
  const Screen = allTabs.find(([id]) => id === tab)?.[2] ?? PlanScreen;
  const activeGroup = NAV.find((g) => g.items.some(([id]) => id === tab)) ?? NAV[0];
  const info = app.modeInfo;

  const go = useCallback((id: string) => setTab(id), []);

  // The keyboard listener is re-bound per tab, so the two values it needs that
  // change on their own account (the run trigger, the theme setter) are read
  // through refs rather than by re-registering the listener on every state tick.
  const runRef = useRef(app.run);
  const setThemeRef = useRef(setTheme);
  useEffect(() => { runRef.current = app.run; setThemeRef.current = setTheme; });

  // Keyboard: Ctrl/Cmd+K palette, Alt+1..4 groups, Alt+arrows walk all screens,
  // ? opens help, Esc closes overlays. Typing in a field never triggers them.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      const typing = /^(input|textarea|select)$/i.test((e.target as HTMLElement)?.tagName ?? '');
      if (typing) { if (e.key === 'Escape') { setPalette(false); setHelp(false); } return; }
      if (e.key === '?') { e.preventDefault(); setHelp(true); return; }
      if (e.key === 'Escape') { setPalette(false); setHelp(false); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void runRef.current(); return; }
      if (e.altKey && (e.key === 't' || e.key === 'T')) { setThemeRef.current((t) => t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light'); return; }
      if (e.altKey && /^[1-4]$/.test(e.key)) { const g = NAV[Number(e.key) - 1]; if (g) setTab(g.items[0][0]); return; }
      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const i = flatIds.indexOf(tab);
        const ni = (i + (e.key === 'ArrowRight' ? 1 : flatIds.length - 1) + flatIds.length) % flatIds.length;
        setTab(flatIds[ni]);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [tab, flatIds]);

  const copyJson = async () => {
    if (!app.proposal) { pushToast('No active run to copy yet', 'info'); return; }
    try {
      await navigator.clipboard.writeText(JSON.stringify(app.proposal, null, 2));
      pushToast('Active run JSON copied to clipboard', 'ok');
    } catch { pushToast('Clipboard blocked by the browser', 'bad'); }
  };

  const labelOf = (id: string) => allTabs.find(([t]) => t === id)?.[1] ?? id;

  // Read-progress rule. Written straight to the node so a scroll never re-renders
  // the app; the height is re-measured when the screen changes underneath it.
  const progressRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    let frame = 0;
    const write = () => {
      frame = 0;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      el.style.setProperty('--tb-p', room > 0 ? String(Math.min(1, window.scrollY / room)) : '0');
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(write); };
    write();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [tab]);

  const cycleAccent = () => setAccent((a) => ACCENTS[(ACCENTS.indexOf(a) + 1) % ACCENTS.length] as typeof ACCENTS[number]);
  const paletteActions = [
    { id: 'act-run', label: 'Run the agent (Plan)', hint: 'Ctrl+↵', run: () => { setTab('plan'); void app.run(); } },
    { id: 'act-theme', label: 'Cycle theme: light → dark → auto', hint: 'Alt+T', run: () => setTheme((t) => t === 'light' ? 'dark' : t === 'dark' ? 'system' : 'light') },
    { id: 'act-accent', label: `Next accent palette (now: ${accent})`, hint: '⚙', run: cycleAccent },
    { id: 'act-copy', label: 'Copy the active run as JSON', hint: '⌘', run: () => void copyJson() },
    { id: 'act-print', label: 'Print this screen (evidence only)', hint: 'Ctrl+P', run: () => window.print() },
    { id: 'act-help', label: 'Keyboard shortcuts', hint: '?', run: () => setHelp(true) },
  ];

  return (
    <div className="min-h-screen text-slate-900">
      {app.busy && <div className="tb-beam-line fixed left-0 top-0 z-50 w-full print:hidden" aria-label="run in progress" />}
      <div ref={progressRef} className="tb-progress print:hidden" aria-hidden />

      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/70 shadow-[0_1px_20px_-8px_rgba(15,23,42,0.15)] backdrop-blur-xl print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <div className="mr-auto flex items-center gap-3">
            <div className="tb-orb" aria-hidden>TB</div>
            <div>
              <h1 className="tb-brand-text text-xl font-extrabold tracking-tight">Taste Brain</h1>
              <p className="text-[11px] text-slate-500">decision governance for taste-driven rooms — rules from the business, taste from Qloo, a trace for every call</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ServerDot h={health} />
            <QuotaBar h={health} />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-500">request mode</span>
            <div className="flex items-center gap-1 rounded-full border border-slate-200/80 bg-slate-100/80 p-1">
              {(['cached', 'live'] as TasteMode[]).map((m) => {
                const off = m === 'live' && info !== null && !info.qloo_rest_active;
                return (
                  <button
                    key={m} disabled={off} onClick={() => app.setMode(m)}
                    className={off ? 'cursor-not-allowed' : 'cursor-pointer'}
                    title={off ? LIVE_OFF_HINT : MODE_HINT[m]}
                  >
                    <span className={app.mode === m && !off ? '' : 'opacity-45'}><ModeBadge mode={m} /></span>
                  </button>
                );
              })}
            </div>
            {info !== null && !info.qloo_rest_active && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600" title={LIVE_OFF_HINT}>live off on this host</span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span title="The key lives in the server environment and is never sent to this browser">qloo key: <strong className={info?.qloo_key === 'set' ? 'text-emerald-600' : ''}>{info?.qloo_key ?? '—'}</strong></span>
            {info?.finals_mode && <span className="rounded bg-indigo-600 px-1.5 py-0.5 font-semibold text-white">FINALS MODE ON</span>}
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl flex-col gap-2 px-5 pb-3">
          {/* Level 1: the four big tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {NAV.map((g, gi) => {
              const on = activeGroup.group === g.group;
              return (
                <button
                  key={g.group}
                  onClick={() => setTab(g.items[0][0])}
                  title={`${g.items.map(([, l]) => l).join(' · ')} (Alt+${gi + 1})`}
                  className={`tb-tab cursor-pointer text-sm ${on ? 'tb-tab-on' : 'text-slate-600 bg-white/70 border border-slate-200/80 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md'}`}
                >
                  <span className="mr-1.5" aria-hidden>{TAB_ICON[g.group]}</span>{g.group}
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${on ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>{g.items.length}</span>
                </button>
              );
            })}

            <div className="ml-auto flex items-center gap-2">
              <div className="relative" ref={quickRef}>
                <button onClick={() => setQuickOpen((v) => !v)} title="run the agent from any screen"
                  className="cursor-pointer rounded-full border border-slate-200/80 bg-white/70 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-100">⚡ quick run</button>
                {quickOpen && (
                  <div className="tb-screen-enter absolute right-0 top-9 z-40 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
                    <div className="mb-2 text-xs font-bold text-slate-700">Quick run</div>
                    <label className="text-[10px] font-medium text-slate-500">pack</label>
                    <select value={app.pack} onChange={(e) => app.setPack(e.target.value)} className="mb-1.5 w-full cursor-pointer rounded-lg border border-slate-300 px-2 py-1 pr-7 text-xs">
                      {app.packs.map((p) => <option key={p.pack} value={p.pack}>{p.display_name}</option>)}
                    </select>
                    <label className="text-[10px] font-medium text-slate-500">room</label>
                    <select value={app.location} onChange={(e) => app.setLocation(e.target.value)} className="mb-1.5 w-full cursor-pointer rounded-lg border border-slate-300 px-2 py-1 pr-7 text-xs">
                      {app.locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}
                    </select>
                    <label className="text-[10px] font-medium text-slate-500">goal</label>
                    <Input value={app.goal} onChange={(e) => app.setGoal(e.target.value)} maxLength={256} className="mb-2 text-xs" />
                    <Button
                      className="tb-hero w-full cursor-pointer" size="sm"
                      disabled={app.busy || !app.location || !app.goal.trim()}
                      onClick={() => { setQuickOpen(false); setTab('plan'); void app.run(); }}
                    >{app.busy ? 'running…' : 'Run the agent'}</Button>
                    <p className="mt-1.5 text-[10px] text-slate-400">Uses the same engine and budget as the Plan screen; opens results there.</p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')}
                title={`theme: ${theme} — click to cycle light / dark / system`}
                className="cursor-pointer rounded-full border border-slate-200/80 bg-white/70 px-2 py-1 text-[11px] hover:bg-slate-100"
              >{theme === 'system' ? '☾ auto' : theme === 'dark' ? '☾' : '☀'}</button>

              <div className="relative" ref={settingsRef}>
                <button onClick={() => setSettingsOpen((v) => !v)} title="display settings"
                  className={`cursor-pointer rounded-full border border-slate-200/80 px-2 py-1 text-[11px] ${settingsOpen ? 'tb-nav-active' : 'bg-white/70 hover:bg-slate-100'}`}>⚙</button>
                {settingsOpen && (
                  <div className="tb-screen-enter absolute right-0 top-9 z-40 w-72 rounded-2xl border border-slate-200 bg-white p-3 text-xs shadow-2xl">
                    <div className="mb-2 font-bold text-slate-700">Display settings</div>
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">theme</div>
                    <div className="mb-2 flex gap-1">
                      {(['light', 'dark', 'system'] as const).map((t) => (
                        <button key={t} onClick={() => setTheme(t)}
                          className={`cursor-pointer flex-1 rounded-lg border px-2 py-1 ${theme === t ? 'tb-nav-active border-transparent' : 'border-slate-200 hover:bg-slate-50'}`}>{t}</button>
                      ))}
                    </div>
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">accent palette</div>
                    <div className="mb-2 grid grid-cols-5 gap-2">
                      {ACCENTS.map((a) => (
                        <button key={a} onClick={() => setAccent(a)} aria-label={`accent ${a}`} title={a} data-on={accent === a}
                          className="tb-swatch"
                          style={{ background: `linear-gradient(135deg, ${ACCENT_STOPS[a][0]}, ${ACCENT_STOPS[a][1]})` }} />
                      ))}
                    </div>
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">text size</div>
                    <div className="mb-2 flex gap-1">
                      {DENSITIES.map(([d, l]) => (
                        <button key={d} onClick={() => setDensity(d)}
                          className={`cursor-pointer flex-1 rounded-lg border px-2 py-1 ${density === d ? 'tb-nav-active border-transparent' : 'border-slate-200 hover:bg-slate-50'}`}>{l === 'M' ? 'medium' : l === 'S' ? 'small' : 'large'}</button>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">Saved on this device only.</p>
                  </div>
                )}
              </div>

              <button onClick={() => setPalette(true)} title="command palette (Ctrl+K)"
                className="cursor-pointer rounded-full border border-slate-200/80 bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-100">⌘K</button>
              <button onClick={() => setHelp(true)} title="keyboard shortcuts (?)"
                className="cursor-pointer rounded-full border border-slate-200/80 bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-100">?</button>
            </div>
          </div>
        </nav>

        {/* The run that is on screen gets its own strip, not a pill squeezed
            between the header's other instruments. */}
        {app.proposal && (
          <div className="tb-run print:hidden">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-5 py-1.5 text-[11px] text-slate-600">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span>active run</span>
              <code className="font-mono">{app.proposal.proposal_id}</code>
              <ModeBadge mode={app.proposal.mode} />
              <ModeMixLine mix={app.proposal.trace.mode_mix} compact />
              <span>{app.proposal.items.length} item(s) · {app.proposal.status}</span>
              <button onClick={copyJson} className="cursor-pointer rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200" title="Copy the full run as JSON">copy JSON</button>
              {app.servedFrom === 'snapshot' && <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-700">FINALS MODE</span>}
              {app.servedFrom === 'restored' && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800" title="Re-served from the store — this room's newest stored run, nothing new was computed">restored from the store</span>}
            </div>
          </div>
        )}
      </header>

      {/* The page band: what this screen is, and the way to its neighbours. */}
      <div className="mx-auto max-w-7xl px-5 pt-5 print:hidden">
        <div className="tb-band" key={tab}>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="tb-band-eyebrow">
                <span aria-hidden>{TAB_ICON[activeGroup.group]}</span>
                {activeGroup.group}
                <span className="tb-band-sep">·</span>
                screen {flatIds.indexOf(tab) + 1} of {flatIds.length}
              </div>
              <h2 className="tb-band-title">{labelOf(tab)}</h2>
              <p className="tb-band-sub">{SCREEN_BLURB[tab]}</p>
            </div>
            <div className="tb-seg" role="group" aria-label={`${activeGroup.group} screens`}>
              {activeGroup.items.map(([id, label]) => (
                <button key={id} aria-current={tab === id ? 'page' : undefined} data-on={tab === id} onClick={() => setTab(id)} title={SCREEN_BLURB[id]}>
                  <span className="mr-1" aria-hidden>{TAB_ICON[id]}</span>{label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <main className="tb-screen-enter mx-auto max-w-7xl px-5 pb-8 pt-4" key={tab}>
        <ScreenBoundary key={tab}>
          <Screen />
        </ScreenBoundary>
      </main>

      <footer className="mx-auto max-w-7xl px-5 pb-8 text-[11px] leading-relaxed text-slate-500">
        <div className="flex flex-wrap items-center gap-x-3 border-t border-slate-200/70 pt-4">
          <span>Taste Brain · Qloo Agentic Hackathon. Qloo supplies the taste data, the venue’s own rules enforce the decisions,
          and every approve or refuse is recorded in a tamper-evident ledger.</span>
        </div>
      </footer>

      {palette && (
        <CommandPalette onClose={() => setPalette(false)} go={go} actions={paletteActions}
          entries={NAV.flatMap((g) => g.items.map(([id, label]) => ({ id, label, group: g.group })))} />
      )}
      <HelpModal open={help} onClose={() => setHelp(false)} />
      <ToastHost />
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
