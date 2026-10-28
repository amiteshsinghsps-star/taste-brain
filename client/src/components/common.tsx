// Display primitives. They format what the engine returned; they never compute
// a score, a rank or a label the server did not send.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ModeMix, RuleStatus, TasteMode } from '@/lib/types';

/** True when the visitor asked the OS for less motion; animations stay off. */
function usePrefersReducedMotion(): boolean {
  const [still, setStill] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setStill(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return still;
}

const MODE_LABEL: Record<TasteMode, string> = { live: 'LIVE', cached: 'CACHED', replay: 'SAMPLE' };
const MODE_VARIANT: Record<TasteMode, 'success' | 'warning' | 'secondary'> = {
  live: 'success', cached: 'warning', replay: 'secondary',
};
const MODE_TITLE: Record<TasteMode, string> = {
  live: 'LIVE — read from Qloo on this run',
  cached: 'CACHED — served from a stored Qloo answer, the live call was not repeated',
  replay: 'OFFLINE SAMPLE — test data, not real Qloo results',
};

export function ModeBadge({ mode, className }: { mode: TasteMode; className?: string }) {
  return (
    <Badge variant={MODE_VARIANT[mode]} className={className} title={MODE_TITLE[mode]}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {MODE_LABEL[mode]}
    </Badge>
  );
}

// The run badge names the mode it asked for. A live run can still lean on the
// stored copy for most of its answers, so the per-step source count is stated next
// to it rather than left for the trace to reveal.
const MIX_PHRASE: Record<TasteMode, string> = {
  live: 'read from Qloo on this run',
  cached: 'served from the stored Qloo answer',
  replay: 'taken from offline sample data',
};

export function ModeMixLine({ mix, compact }: { mix?: ModeMix; compact?: boolean }) {
  if (!mix) return null;
  const parts = (['live', 'cached', 'replay'] as const).filter((m) => mix[m] > 0);
  const total = parts.reduce((n, m) => n + mix[m], 0);
  if (!total) return null;
  const mixed = parts.length > 1;
  if (compact) {
    return (
      <span
        className={`rounded px-1.5 py-0.5 font-semibold ${mixed ? 'bg-amber-100 text-amber-800' : mix.live === total ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
        title={parts.map((m) => `${mix[m]} step(s) ${MIX_PHRASE[m]}`).join('; ')}
      >
        {mix.live}/{total} fetched now
      </span>
    );
  }
  return (
    <p className={`text-xs ${mixed ? 'text-amber-800' : 'text-slate-500'}`}>
      {parts.map((m, i) => (
        <span key={m}>{i > 0 && <span className="mx-1.5 text-slate-300">·</span>}
          <strong className="font-semibold">{mix[m]}</strong> of {total} steps {MIX_PHRASE[m]}</span>
      ))}
      {mixed && <span className="ml-1.5">— the badge names what the run asked for, not every step</span>}
    </p>
  );
}

export function StatusPill({ status, title, children }: { status: RuleStatus; title?: string; children?: ReactNode }) {
  const variant = status === 'pass' ? 'success' : status === 'fail' ? 'destructive' : 'warning';
  return <Badge variant={variant} title={title}>{children ?? status}</Badge>;
}

export function Panel({
  title, description, mode, actions, children, className,
}: { title: ReactNode; description?: ReactNode; mode?: TasteMode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription className="mt-1 text-xs leading-relaxed">{description}</CardDescription>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode && <ModeBadge mode={mode} />}
          {actions}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300/80 bg-gradient-to-b from-white/80 to-slate-50/60 px-4 py-6 text-sm text-slate-600">
      {children}
    </div>
  );
}

const TONES = {
  info: 'border-slate-200 bg-slate-50 text-slate-700',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  bad: 'border-red-200 bg-red-50 text-red-800',
} as const;

export function Note({ tone = 'info', title, children }: { tone?: keyof typeof TONES; title?: ReactNode; children: ReactNode }) {
  return (
    <div className={`tb-note rounded-lg border px-3 py-2 text-xs leading-relaxed ${TONES[tone]}`}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1 last:border-0">
      <dt className="shrink-0 text-xs text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words text-right text-xs font-medium text-slate-800">{v}</dd>
    </div>
  );
}

export function Chips({ items, title }: { items: string[]; title?: string }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {title && <span className="text-[11px] uppercase tracking-wide text-slate-400">{title}</span>}
      {items.map((t, i) => <span key={`${t}-${i}`} className="tb-chip px-2 py-0.5 text-[11px] font-medium">{t}</span>)}
    </div>
  );
}

/* ── Presentation-only data views ── every value below is the engine's own;
   these components restate it as a tile, a bar or a strip and add nothing. */

/** One headline number with its label. Pass the engine's value verbatim. */
export function Stat({ value, label, hint }: { value: ReactNode; label: string; hint?: string }) {
  return (
    <div className="tb-stat" title={hint}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** A single proportional bar. `pct` is 0-100 and must come from the data. */
export function MeterBar({ pct, caption, hint, muted }: { pct: number; caption?: ReactNode; hint?: string; muted?: boolean }) {
  // A missing value is not a full bar: the CSS gives .tb-bar > i no width, so an
  // empty or NaN width paints 100%. Show an empty track and say the value is absent.
  const ok = Number.isFinite(pct);
  const w = ok ? Math.max(0, Math.min(100, pct)) : 0;
  return (
    <div className="space-y-0.5" title={ok ? hint : 'the engine gave no value here'}>
      <div className="tb-bar" data-muted={muted ? 'true' : undefined}><i style={{ width: `${w}%` }} /></div>
      {(caption || !ok) && (
        <div className="text-[10px] leading-tight text-slate-500">{ok ? caption : 'no value recorded'}</div>
      )}
    </div>
  );
}

/** The run's mode_mix as one proportional strip, with counts named in the legend. */
export function ModeMixBar({ mix }: { mix?: ModeMix }) {
  if (!mix) return null;
  const SEG: { m: TasteMode; color: string; words: string }[] = [
    { m: 'live', color: 'linear-gradient(90deg,#059669,#10b981)', words: 'read from Qloo on this run' },
    { m: 'cached', color: 'linear-gradient(90deg,#d97706,#f59e0b)', words: 'served from stored Qloo answers' },
    { m: 'replay', color: 'linear-gradient(90deg,#64748b,#94a3b8)', words: 'offline sample data' },
  ];
  const parts = SEG.map((s) => ({ ...s, n: mix[s.m] })).filter((s) => s.n > 0);
  const total = parts.reduce((n, s) => n + s.n, 0);
  if (!total) return null;
  return (
    <div className="space-y-1.5">
      <div className="tb-segbar">
        {parts.map((p) => (
          <span key={p.m} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} title={`${p.n} step(s) ${p.words}`} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
        {parts.map((p) => (
          <span key={p.m} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
            <strong className="font-semibold">{p.n}</strong> {p.words}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Tag frequency across the items already on screen. The count is a property of
 * the returned rows, so the bar length is a restatement, not a new claim.
 */
export function TagFrequency({ tags, of }: { tags: [string, number][]; of: number }) {
  if (!tags.length) return null;
  const max = tags[0][1] || 1;
  return (
    <div className="space-y-1.5">
      {tags.map(([name, n]) => (
        <div key={name} className="grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-2">
          <span className="truncate text-[11px] font-medium text-slate-700" title={name}>{name}</span>
          <MeterBar pct={(n / max) * 100} hint={`${n} of ${of} shown items carry this tag`} />
          <span className="text-[11px] tabular-nums text-slate-500">{n}/{of}</span>
        </div>
      ))}
      <p className="text-[10px] text-slate-400">Counted from the {of} items this run returned — appears on N items, bar scaled to the most common.</p>
    </div>
  );
}

/** Counts up to `value` for effect; the settled number is exactly what was passed in. */
export function CountUp({ value }: { value: number }) {
  const still = usePrefersReducedMotion();
  const [shown, setShown] = useState(still ? value : 0);
  const from = useRef(still ? value : 0);
  useEffect(() => {
    // Reduced motion is not an animation with duration 0 — the number is simply
    // the value, so nothing is scheduled and nothing calls setState here.
    if (still) { from.current = value; return; }
    const t0 = performance.now();
    const start = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 500);
      const v = Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3)));
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, still]);
  return <>{still ? value : shown}</>;
}

/** The arc length is the server's own passed/total pair; nothing is inferred here. */
export function ScoreRing({ passed, total, ok }: { passed: number; total: number; ok: boolean }) {
  const pct = total > 0 ? (Math.max(0, Math.min(passed, total)) / total) * 100 : 0;
  return (
    <div className="relative h-16 w-16 shrink-0" role="img" aria-label={`${passed} of ${total} checks passed`}>
      <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
        <circle className="tb-ring-track" cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.2" />
        <circle
          className="tb-ring-arc" data-st={ok ? 'pass' : 'fail'} cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.2"
          pathLength={100} strokeDasharray={`${pct} 100`}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-[10px] font-semibold leading-none">
        <b className="text-sm">{passed}<span className="text-slate-400">/{total}</span></b>
        <span className="text-[8px] uppercase tracking-wider text-slate-400">checks</span>
      </span>
    </div>
  );
}

/** The one-line verdict, readable at a glance: pass, fail, a caution, or nothing yet. */
export function VerdictBanner({ state, title, children }: { state: 'pass' | 'fail' | 'warn' | 'idle'; title: ReactNode; children?: ReactNode }) {
  const GLYPH = { pass: '✓', fail: '✕', warn: '!', idle: '—' } as const;
  return (
    <div className="tb-verdict" data-st={state}>
      <span className="text-lg leading-none font-bold" aria-hidden>{GLYPH[state]}</span>
      <div className="min-w-0">
        <div className="text-sm font-bold">{title}</div>
        {children && <div className="mt-0.5 text-[11px] leading-relaxed opacity-90">{children}</div>}
      </div>
    </div>
  );
}

/** A pill row for narrowing a list. The counts come from the rows themselves. */
export function FilterPills({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { id: string; label: ReactNode }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {options.map((o) => (
        <button key={o.id} className="tb-pill" data-on={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Shimmer placeholder while the pipeline is running. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-label="loading" role="status">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="tb-shimmer h-14 rounded-lg" style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}

/** Collapsible, copyable view of the engine's own JSON for one object. */
export function JsonBlock({ obj, label = 'raw JSON for this row' }: { obj: unknown; label?: string }) {
  const [open, setOpen] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(obj, null, 2)); } catch { /* clipboard blocked */ }
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <button className="tb-pill" data-on={open} onClick={() => setOpen((o) => !o)}>{open ? 'hide' : 'show'} {label}</button>
        {open && <button className="cursor-pointer text-[11px] text-slate-500 underline" onClick={copy}>copy</button>}
      </div>
      {open && (
        <pre className="tb-screen-enter mt-1.5 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[10px] leading-relaxed text-slate-700">
          {JSON.stringify(obj, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * Radar over the fields Qloo returned for the items shown. Each axis is scaled
 * against the largest value in the set, so it compares picks — it does not
 * claim an absolute scale.
 */
export function Radar({ axes, series }: { axes: string[]; series: { name: string; color: string; values: number[] }[] }) {
  const size = 250, c = size / 2, R = c - 46;
  const n = axes.length;
  if (n < 3 || !series.length) return null;
  const at = (i: number, r: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  };
  const poly = (vals: number[]) =>
    vals.map((v, i) => at(i, R * Math.max(0.02, Math.min(1, v))).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-56 w-56 shrink-0" role="img" aria-label="radar comparison">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={axes.map((_, i) => at(i, R * f).join(',')).join(' ')} fill="none" stroke="#94a3b8" strokeOpacity={0.35} strokeWidth={0.7} />
      ))}
      {axes.map((ax, i) => {
        const [x, y] = at(i, R);
        const [lx, ly] = at(i, R + 16);
        return (
          <g key={ax}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="#94a3b8" strokeOpacity={0.35} strokeWidth={0.7} />
            <text x={lx} y={ly} textAnchor={Math.abs(lx - c) < 12 ? 'middle' : lx > c ? 'start' : 'end'} dominantBaseline="middle" fontSize={8.5} fill="#64748b">{ax}</text>
          </g>
        );
      })}
      {series.map((s) => (
        <g key={s.name}>
          <polygon points={poly(s.values)} fill={s.color} fillOpacity={0.16} stroke={s.color} strokeWidth={1.6} className="tb-radar-in" />
          {s.values.map((v, i) => {
            const [x, y] = at(i, R * Math.max(0.02, Math.min(1, v)));
            return <circle key={i} cx={x} cy={y} r={2.2} fill={s.color} />;
          })}
        </g>
      ))}
    </svg>
  );
}

/** A hash, shortened for reading. The full value stays in the title attribute. */
export function Hash({ value }: { value: string }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700" title={value}>{value.slice(0, 16)}…</code>;
}

export function Time({ iso }: { iso: string }) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return <span className="text-[11px] text-slate-400">no time recorded</span>;
  return <span className="text-[11px] text-slate-400" title={iso}>{iso.replace('T', ' ').slice(0, 19)}Z</span>;
}

/**
 * Commit-time fixtures carry the Unix epoch as a sentinel: no request was made,
 * so there is no fetch time. Printing "1970-01-01" reads like an impossibly
 * stale live call, so say what actually happened instead.
 */
export function FetchedAt({ iso, mode }: { iso?: string | null; mode?: TasteMode }) {
  const sentinel = !iso || (Number.isFinite(Date.parse(iso)) && Date.parse(iso as string) < 86_400_000);
  if (sentinel) {
    return (
      <span className="text-slate-400" title={iso ?? 'absent'}>
        no fetch time — this row came from stored data{mode === 'replay' ? ' (offline sample)' : ''}
      </span>
    );
  }
  return <Time iso={iso as string} />;
}
