// The identity overlay: how live mode reaches real Qloo entities while the
// committed packs stay fictional.
//
// Every tracked pack file names fictional companies, fictional rooms and
// symbolic `qloo:brand:*` ids. The real entity ids and the real names to ask
// Qloo for live in ONE gitignored file per pack (`<PACK_OVERLAY_DIR>/<pack>.overlay.json`)
// held by the key custodian, or in `PACK_OVERLAY_B64` on a host that cannot
// upload files. Nothing this module reads is ever logged or returned: the
// contents are Qloo data, and a pack overlay is the same class of secret as the
// API key that reads it.

import * as fs from 'fs';
import * as path from 'path';
import { env } from '../config/env';
import type { CatalogOffer, PackFile } from './loader';

export interface PackOverlay {
  /** committed seed id -> the real-world name to resolve through /search */
  seeds?: Record<string, string>;
  /** catalog key -> identity patches, matched to a committed row by offer_id */
  catalogs?: Record<string, { offer_id: string; name: string; qloo_entity_id: string }[]>;
}

const OVERLAY_DIR = path.resolve(__dirname, '..', '..', env.PACK_OVERLAY_DIR);
const cache = new Map<string, PackOverlay | null>();

const COMBINING_MARKS = /[̀-ͯ]/g;

function bundleFromEnv(): Record<string, PackOverlay> | null {
  const raw = env.PACK_OVERLAY_B64;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, PackOverlay> : null;
  } catch {
    console.warn(`pack overlay bundle is not readable base64 JSON (env PACK_OVERLAY_B64, ${raw.length} chars)`);
    return null;
  }
}

/** The overlay for one pack, or null when this host has none. */
export function overlayFor(packId: string): PackOverlay | null {
  if (env.PACK_OVERLAY_DISABLE) return null;
  if (cache.has(packId)) return cache.get(packId) as PackOverlay | null;
  let overlay: PackOverlay | null = null;
  const file = path.join(OVERLAY_DIR, `${packId}.overlay.json`);
  try {
    if (fs.existsSync(file)) {
      overlay = JSON.parse(fs.readFileSync(file, 'utf8')) as PackOverlay;
    } else {
      overlay = bundleFromEnv()?.[packId] ?? null;
    }
  } catch {
    console.warn(`pack overlay for "${packId}" is not readable JSON — running with the committed fictional identities`);
    overlay = null;
  }
  cache.set(packId, overlay);
  return overlay;
}

/** "present" or "absent" — a status word only, never the contents. */
export function overlayStatus(packId: string): 'present' | 'absent' {
  return overlayFor(packId) ? 'present' : 'absent';
}

/** Keep the committed id's `qloo:<type>:` prefix and swap only the slug. */
function swapSeedName(committedId: string, realName: string): string {
  const prefix = committedId.slice(0, committedId.lastIndexOf(':') + 1);
  const slug = realName.toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${prefix}${slug}`;
}

/**
 * Re-attach real identities to a freshly parsed pack. Returns a new object —
 * the committed pack is never mutated, so no real name can leak back into it.
 */
export function applyOverlay(pack: PackFile, overlay: PackOverlay | null): PackFile {
  if (!overlay) return pack;
  const seeds = overlay.seeds ?? {};
  const catalogs = overlay.catalogs ?? {};

  const locations = pack.locations.map((loc) => ({
    ...loc,
    seeds: loc.seeds.map((s) => (seeds[s] ? swapSeedName(s, seeds[s]) : s)),
  }));

  const patched: Record<string, CatalogOffer[]> = {};
  for (const [key, rows] of Object.entries(pack.catalogs)) {
    const patches = catalogs[key] ?? [];
    patched[key] = rows.map((row) => {
      const p = patches.find((x) => x.offer_id === row.offer_id);
      return p ? { ...row, name: p.name, qloo_entity_id: p.qloo_entity_id } : row;
    });
  }

  return { ...pack, locations, catalogs: patched };
}
