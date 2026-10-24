// Display primitives. They format what the engine returned; they never compute
// a score, a rank or a label the server did not send.

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ModeMix, RuleStatus, TasteMode } from '@/lib/types';

const MODE_LABEL: Record<TasteMode, string> = { live: 'LIVE', cached: 'CACHED', replay: 'REPLAY' };
const MODE_VARIANT: Record<TasteMode, 'success' | 'warning' | 'secondary'> = {
  live: 'success', cached: 'warning', replay: 'secondary',
};
const MODE_TITLE: Record<TasteMode, string> = {
  live: 'LIVE — read from Qloo on this run',
  cached: 'CACHED — served from a stored Qloo answer, the live call was not repeated',
  replay: 'REPLAY — synthetic fixtures, no real Qloo data touched this run',
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
  replay: 'taken from synthetic fixtures',
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

export function StatusPill({ status, children }: { status: RuleStatus; children?: ReactNode }) {
  const variant = status === 'pass' ? 'success' : status === 'fail' ? 'destructive' : 'warning';
  return <Badge variant={variant}>{children ?? status}</Badge>;
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
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
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
    <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${TONES[tone]}`}>
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
      {items.map((t, i) => <span key={`${t}-${i}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{t}</span>)}
    </div>
  );
}

/** A hash, shortened for reading. The full value stays in the title attribute. */
export function Hash({ value }: { value: string }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700" title={value}>{value.slice(0, 16)}…</code>;
}

export function Time({ iso }: { iso: string }) {
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
        no fetch time — this row was not fetched{mode === 'replay' ? ' (replay fixture)' : ''}
      </span>
    );
  }
  return <Time iso={iso as string} />;
}
