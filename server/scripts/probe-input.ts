// Live-probe input. A real entity name is Qloo data and a probe against a
// made-up entity proves nothing about the API, so no tracked script carries a
// name: the operator supplies it, or it comes from the gitignored pack overlay.
//
// Resolution order:  --artists="A,B" / --places= / --brands=   then
//                    PROBE_ARTISTS / PROBE_PLACES / PROBE_BRANDS   then
//                    the seed names in server/.private-data/<pack>.overlay.json

import * as fs from 'fs';
import * as path from 'path';

export type ProbeType = 'artist' | 'place' | 'brand';

const OVERLAY_DIR = path.resolve(__dirname, '..', '.private-data');

function clean(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

function fromOverlay(pack: string, type: ProbeType): string[] {
  const file = path.join(OVERLAY_DIR, `${pack}.overlay.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const overlay = JSON.parse(fs.readFileSync(file, 'utf8')) as { seeds?: Record<string, string> };
    return clean(Object.entries(overlay.seeds ?? {})
      .filter(([id]) => id.startsWith(`qloo:${type}:`))
      .map(([, name]) => name));
  } catch {
    return [];
  }
}

/** Names to query Qloo with. Exits the process when the operator gave none. */
export function probeNames(type: ProbeType, pack = 'venues'): string[] {
  const flag = process.argv.slice(2).find((a) => a.startsWith(`--${type}s=`));
  const fromArg = flag ? clean(flag.slice(`--${type}s=`.length).split(',')) : [];
  const fromEnv = clean(String(process.env[`PROBE_${type.toUpperCase()}S`] ?? '').split(','));
  const names = fromArg.length ? fromArg : fromEnv.length ? fromEnv : fromOverlay(pack, type);
  if (!names.length) {
    console.error(`no ${type} names to probe with.`);
    console.error(`pass --${type}s="Name A,Name B", set PROBE_${type.toUpperCase()}S, or hold the private ${pack} overlay in server/.private-data/`);
    console.error('nothing is invented here — a made-up entity would only produce a made-up result');
    process.exit(1);
  }
  return names;
}
