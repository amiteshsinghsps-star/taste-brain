// The toast bus: anything can shout, ToastHost renders. Kept out of the
// component module so both files export one kind of thing.

export type Tone = 'ok' | 'bad' | 'info';
export interface ToastItem { id: number; msg: string; tone: Tone }

const listeners = new Set<(t: ToastItem) => void>();
let toastSeq = 1;

export function pushToast(msg: string, tone: Tone = 'info') {
  const t = { id: toastSeq++, msg, tone };
  listeners.forEach((f) => f(t));
}

export function subscribeToasts(fn: (t: ToastItem) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
