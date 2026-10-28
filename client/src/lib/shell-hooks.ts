// Shell-level hooks. They live outside the component modules so a file can
// export hooks without breaking React Fast Refresh.

import { useEffect, useRef, useState } from 'react';

export function useLocalStorage<T>(key: string, initial: T) {
  const [val, setVal] = useState<T>(() => {
    try { const s = window.localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; }
    catch { return initial; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage full or blocked */ }
  }, [key, val]);
  return [val, setVal] as const;
}

export interface Health {
  ok: boolean;
  latency_ms: number | null;
  visitor_hour: { used: number; limit: number } | null;
  global_day: { used: number; limit: number } | null;
  live: boolean;
}

export function useHealth(periodMs = 25_000): Health {
  const [h, setH] = useState<Health>({ ok: false, latency_ms: null, visitor_hour: null, global_day: null, live: false });
  useEffect(() => {
    let dead = false;
    const poll = async () => {
      const t0 = performance.now();
      try {
        const r = await fetch('/api/health');
        const b = await r.json();
        if (dead) return;
        setH({
          ok: r.ok,
          latency_ms: Math.round(performance.now() - t0),
          visitor_hour: b.quota?.visitor_hour ?? null,
          global_day: b.quota?.global_day ?? null,
          live: !!b.qloo_rest_active,
        });
      } catch {
        if (!dead) setH((p) => ({ ...p, ok: false, latency_ms: null }));
      }
    };
    poll();
    const id = setInterval(poll, periodMs);
    return () => { dead = true; clearInterval(id); };
  }, [periodMs]);
  return h;
}

/** Click-outside dismiss for header popovers. */
export function useClickOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', on);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', esc); };
  }, [open, onClose]);
  return ref;
}
