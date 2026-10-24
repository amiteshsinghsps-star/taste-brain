import * as fs from 'fs';
import * as path from 'path';
import type { Rule } from '../types';

const DATA_DIR = path.join(__dirname, 'data');
const cache = new Map<string, PackFile>();

/**
 * A location is the room the decision is made for. Everything the venue owns
 * lives here as configuration, which is why adding a vertical is a file, not a
 * code change (PRD F0).
 */
export interface PackLocation {
  id: string;
  name: string;
  city: string;
  seeds: string[];
  catalog: string;
  /** e.g. "600 capacity club" — drives which band rules make sense. */
  capacity_tier?: string;
  /**
   * When true, Qloo results with no offer on file are ranked as candidates whose
   * terms still need entering, instead of being parked as unsupported. Real-artist
   * rooms set this; retail packs do not.
   */
  accept_unknown_offers?: boolean;
  /** Location-level rule thresholds (a what-if applied permanently). */
  rule_overrides?: Record<string, number>;
  /**
   * Which of the pack's rules this room actually enforces. Omitted means all of
   * them — an all-ages matinee room and a 21+ late room share the pack but not
   * the content policy.
   */
  rule_ids?: string[];
  /** Qloo popularity band used as an API filter (floats 0..1). */
  popularity_band?: { min?: number; max?: number };
  /** Entities never to propose, e.g. a previously problematic act. */
  exclude_entity_ids?: string[];
  exclude_tag_ids?: string[];
  /** Operator's own recent-play list for the no-repeat window. */
  recent_plays?: string[];
  /** Honest label for what is synthetic here. */
  data_provenance: string;
}

export interface CatalogOffer {
  offer_id: string;
  name: string;
  qloo_entity_id: string;
  fields: Record<string, number>;
  tags: string[];
}

/**
 * Everything that makes a vertical a vertical lives in this file: no code
 * change is needed to add one (PRD F0).
 */
export interface PackFile {
  pack: string;
  unit: string;
  display_name: string;
  description: string;
  goal_templates: string[];
  qloo: {
    target_types: string[];
    seed_types: string[];
    location_signal: 'city' | 'place' | 'none';
    max_calls_per_request?: number;
  };
  copy: { audience_label: string; offer_label: string };
  rules: Rule[];
  sop_documents: { id: string; title: string; lines: Record<string, string> }[];
  locations: PackLocation[];
  catalogs: Record<string, CatalogOffer[]>;
}

export function listPackIds(): string[] {
  return fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

export function loadPack(id: string): PackFile {
  const key = String(id ?? '');
  if (cache.has(key)) return cache.get(key) as PackFile;
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('unknown pack');
  const file = path.join(DATA_DIR, `${key}.json`);
  if (!fs.existsSync(file)) throw new Error(`unknown pack ${key}`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PackFile;
  cache.set(key, raw);
  return raw;
}

export function getLocations(id: string): PackLocation[] {
  return loadPack(id).locations;
}

/**
 * Measured, not declared: does this room have a committed Replay catalog? Rooms
 * whose candidates are real Qloo data have no fixture, so Replay returns nothing
 * for them and the UI has to say so instead of showing an empty table.
 */
export function hasReplayFixture(packId: string, locationId: string): boolean {
  return fs.existsSync(path.join(__dirname, '..', 'qloo', 'fixtures', `${packId}.${locationId}.recommend.json`));
}

export function getLocation(id: string, locationId: string): PackLocation {
  const loc = loadPack(id).locations.find((l) => l.id === locationId);
  if (!loc) throw new Error(`Unknown location ${locationId} for pack ${id}`);
  return loc;
}

export function getCatalog(id: string, catalogKey: string): CatalogOffer[] {
  return loadPack(id).catalogs[catalogKey] ?? [];
}

/**
 * Link a Qloo result to the organisation's own offer record. Matching is by
 * entity id first, then by exact name — never fuzzy, never guessed.
 */
export function findOffer(id: string, catalogKey: string, qlooEntityId: string, entityName?: string): CatalogOffer | undefined {
  const cat = getCatalog(id, catalogKey);
  const byId = cat.find((o) => o.qloo_entity_id && o.qloo_entity_id.toLowerCase() === qlooEntityId.toLowerCase());
  if (byId) return byId;
  if (entityName) {
    const cleanName = entityName.toLowerCase().trim();
    return cat.find((o) => o.name.toLowerCase().trim() === cleanName);
  }
  return undefined;
}

export function ruleById(pack: PackFile, ruleId: string): Rule | undefined {
  return pack.rules.find((r) => r.id === ruleId);
}

/** Human-readable field a rule needs, used when an approval is blocked. */
export function fieldForRule(rules: Rule[], ruleId: string): string {
  return rules.find((r) => r.id === ruleId)?.field ?? rules.find((r) => r.id === ruleId)?.band?.field ?? '';
}

export function sopSnippet(id: string, source: string): string | undefined {
  const [file, line] = String(source ?? '').split('#');
  const doc = loadPack(id).sop_documents.find((d) => d.id === file);
  if (!doc) return undefined;
  if (!line) return doc.title;
  return `${doc.title} ${line}: ${doc.lines[line] ?? ''}`.trim();
}
