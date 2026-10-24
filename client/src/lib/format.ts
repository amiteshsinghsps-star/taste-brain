// Display formatting only. These never compute a value — the number itself
// always comes from the API, and the engine's own words are shown unedited.

export function num(n: number | undefined | null, digits = 3): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return 'not returned';
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(digits);
}

export function pct(x: number | null | undefined): string {
  return x === null || x === undefined || !Number.isFinite(x) ? '—' : `${Math.round(x * 100)}%`;
}
