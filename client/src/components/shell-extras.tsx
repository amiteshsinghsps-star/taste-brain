// Shell-level UI features: command palette, toasts, confetti, health polling,
// keyboard help. None of these compute engine data — they navigate and notify.
// The hooks that back them live in @/lib/shell-hooks and @/lib/toast-bus.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeToasts, type ToastItem, type Tone } from '@/lib/toast-bus';
import type { Health } from '@/lib/shell-hooks';

/* ── Toasts ─────────────────────────────────────────────────────────────── */

const TONE_CLS: Record<Tone, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  bad: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-indigo-200 bg-white text-slate-700',
};

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts((t) => {
    setList((l) => [...l.slice(-3), t]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 3400);
  }), []);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 print:hidden">
      {list.map((t) => (
        <div key={t.id} className={`tb-toast tb-note rounded-lg border px-3 py-2 text-xs font-medium shadow-lg ${TONE_CLS[t.tone]}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/* ── Health polling: server dot + quota bar ─────────────────────────────── */

export function ServerDot({ h }: { h: Health }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-600"
      title={h.ok ? `server up · ${h.latency_ms ?? '—'} ms round-trip · Qloo ${h.live ? 'LIVE' : 'off on host'}` : 'server not answering — is the API running on this host?'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${h.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {h.ok ? 'server' : 'down'}
    </span>
  );
}

export function QuotaBar({ h }: { h: Health }) {
  if (!h.ok || !h.visitor_hour) return null;
  const { used, limit } = h.visitor_hour;
  // A limit of zero means live is switched off on this host. used/limit would be
  // NaN and the strip would print "NaN%" — a figure the server never sent.
  const off = !Number.isFinite(limit) || limit <= 0;
  const pct = off ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] text-slate-500"
      title={off
        ? `this visitor's hourly live budget is ${limit}, so live runs are not permitted here`
        : `${used}/${limit} live runs this hour · day ${h.global_day?.used ?? 0}/${h.global_day?.limit ?? '—'}`}
    >
      quota
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200">
        <span
          className={`block h-full rounded-full transition-all ${off ? 'bg-slate-300' : pct > 75 ? 'bg-red-400' : pct > 45 ? 'bg-amber-400' : 'bg-emerald-400'}`}
          style={{ width: off ? '0%' : `${Math.max(4, pct)}%` }}
        />
      </span>
      {off ? 'live off' : `${used}/${limit}`}
    </span>
  );
}

/* ── Command palette (Ctrl+K) ───────────────────────────────────────────── */

export interface PaletteAction { id: string; label: string; hint: string; run: () => void }

export function CommandPalette({
  onClose, entries, go, actions = [],
}: {
  onClose: () => void;
  entries: { id: string; label: string; group: string }[];
  go: (id: string) => void;
  actions?: PaletteAction[];
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mounted only while the palette is up, so a fresh query and selection are the
  // initial state rather than a reset effect, and focusing is the only job here.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  type Row = { kind: 'screen'; id: string; label: string; group: string } | { kind: 'action'; id: string; label: string; hint: string; run: () => void };

  const rows: Row[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    const screens: Row[] = entries
      .filter((e) => !s || `${e.group} ${e.label}`.toLowerCase().includes(s))
      .map((e) => ({ kind: 'screen', ...e }));
    const acts: Row[] = actions
      .filter((a) => !s || `action ${a.label} ${a.hint}`.toLowerCase().includes(s))
      .map((a) => ({ kind: 'action', ...a }));
    return [...acts, ...screens];
  }, [q, entries, actions]);

  const pick = useCallback((r: Row) => {
    if (r.kind === 'action') { onClose(); r.run(); } else { go(r.id); onClose(); }
  }, [go, onClose]);

  // Filtering can shrink the list under the cursor; clamping during render beats
  // an effect that re-renders to fix the same number.
  const active = sel < rows.length ? sel : 0;

  const GROUP_ICON: Record<string, string> = { Decide: '🎯', Question: '❓', 'Prove it': '🔬', Operate: '🛠' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 pt-24 backdrop-blur-sm print:hidden" onMouseDown={onClose}>
      <div
        className="tb-screen-enter w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % Math.max(1, rows.length)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + rows.length) % Math.max(1, rows.length)); }
            if (e.key === 'Enter' && rows[active]) pick(rows[active]);
          }}
          placeholder="Jump to a screen or run an action… (type to filter)"
          className="w-full border-b border-slate-100 px-4 py-3 text-sm outline-none placeholder:text-slate-400"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {rows.length === 0 && <li className="px-4 py-3 text-xs text-slate-500">Nothing matches “{q}”.</li>}
          {rows.map((r, i) => (
            <li key={`${r.kind}:${r.id}`}>
              {i > 0 && rows[i - 1].kind !== r.kind && (
                <div className="px-4 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">{r.kind === 'action' ? '⚙ actions' : '› screens'}</div>
              )}
              {r.kind === 'action' ? (
                <button
                  onClick={() => pick(r)} onMouseEnter={() => setSel(i)}
                  className={`flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-left text-sm ${i === active ? 'tb-nav-active' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  ⚙ {r.label}
                  <span className={`tb-kbd ml-auto ${i === active ? 'opacity-90' : ''}`}>{r.hint}</span>
                </button>
              ) : (
                <>
                  {i > 0 && rows[i - 1].kind === 'screen' && (rows[i - 1] as Extract<Row, { kind: 'screen' }>).group !== r.group && (
                    <div className="px-4 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">{GROUP_ICON[r.group] ?? '›'} {r.group}</div>
                  )}
                  <button
                    onClick={() => pick(r)}
                    onMouseEnter={() => setSel(i)}
                    className={`flex w-full cursor-pointer items-baseline gap-2 px-4 py-1.5 text-left text-sm ${i === active ? 'tb-nav-active' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    {i === active && <span className="mr-0.5 text-xs" aria-hidden>{GROUP_ICON[r.group] ?? '›'}</span>}
                    {r.label}
                    {i !== active && <span className="tb-chip ml-auto px-1.5 py-0 text-[10px] opacity-70">{r.group}</span>}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">
          ↑↓ move · Enter run/go · Esc close
        </div>
      </div>
    </div>
  );
}

/* ── Keyboard help overlay ──────────────────────────────────────────────── */

const KEYS: [string, string][] = [
  ['Ctrl / Cmd + K', 'command palette — screens and actions'],
  ['Ctrl / Cmd + ↵', 'run the agent from anywhere'],
  ['Alt + 1 … 4', 'switch main tab group'],
  ['Alt + ← / →', 'previous / next screen'],
  ['Alt + T', 'cycle theme: light → dark → auto'],
  ['?', 'this help'],
  ['Esc', 'close overlays'],
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm print:hidden" onMouseDown={onClose}>
      <div className="tb-screen-enter w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="tb-brand-text text-base font-bold">Keyboard shortcuts</h2>
        <dl className="mt-3 space-y-1.5">
          {KEYS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 text-xs">
              <dt><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px]">{k}</kbd></dt>
              <dd className="text-slate-600">{v}</dd>
            </div>
          ))}
        </dl>
        <button onClick={onClose} className="tb-hero tb-no-print mt-4 w-full cursor-pointer">Got it</button>
      </div>
    </div>
  );
}
