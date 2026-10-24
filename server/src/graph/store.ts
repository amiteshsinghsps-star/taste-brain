// Single SQLite store for the whole engine: graph nodes/edges, proposals,
// decision ledger, run snapshots, operator-entered terms and quota counters.
// node:sqlite is used so there is no external database and no native build.

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { env } from '../config/env';
import type { LedgerEntry, RunSnapshot } from '../types';

export type NodeKind =
  | 'Tenant' | 'Pack' | 'Location' | 'Audience' | 'QlooEntity' | 'QlooTag'
  | 'Offer' | 'Rule' | 'SOPDocument' | 'Proposal' | 'Decision' | 'Person';

export type EdgeRel =
  | 'HAS_AUDIENCE' | 'AFFINITY' | 'DESCRIBED_BY' | 'MATCHES' | 'DEFINED_IN'
  | 'CONSTRAINS' | 'SUPPORTED_BY' | 'CHECKED_AGAINST' | 'RESULTS_FROM'
  | 'APPROVED_BY' | 'PARTNER_OF';

export interface GraphEdge { src: string; rel: EdgeRel; dst: string; data?: Record<string, unknown>; }

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(env.GRAPH_DB);
  _db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS nodes (
      kind TEXT NOT NULL, id TEXT PRIMARY KEY, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS edges (
      src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, data TEXT,
      PRIMARY KEY (src, rel, dst)
    );
    CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src);
    CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst);
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, pack TEXT, location TEXT, goal TEXT, mode TEXT,
      created_at TEXT, status TEXT, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL,
      proposal_id TEXT NOT NULL, pack TEXT, location TEXT, actor TEXT,
      detail TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      proposal_id TEXT PRIMARY KEY, created_at TEXT, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS offer_terms (
      pack TEXT NOT NULL, location TEXT NOT NULL, entity_id TEXT NOT NULL,
      field TEXT NOT NULL, value REAL NOT NULL, entered_at TEXT NOT NULL,
      PRIMARY KEY (pack, location, entity_id, field)
    );
    CREATE TABLE IF NOT EXISTS quota (
      key TEXT PRIMARY KEY, value INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  return _db;
}

export const graph = {
  // ── graph nodes / edges ────────────────────────────────────────────────────
  upsertNode(kind: NodeKind, id: string, data: Record<string, unknown>) {
    db().prepare('INSERT INTO nodes(kind,id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, kind=excluded.kind')
      .run(kind, id, JSON.stringify(data));
  },
  getNode<T = Record<string, unknown>>(id: string): T | null {
    const row = db().prepare('SELECT data FROM nodes WHERE id=?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  },
  byKind<T = Record<string, unknown>>(kind: NodeKind): (T & { id: string })[] {
    const rows = db().prepare('SELECT id,data FROM nodes WHERE kind=?').all(kind) as { id: string; data: string }[];
    return rows.map((r) => ({ id: r.id, ...(JSON.parse(r.data) as T) }));
  },
  addEdge(src: string, rel: EdgeRel, dst: string, data?: Record<string, unknown>) {
    db().prepare('INSERT INTO edges(src,rel,dst,data) VALUES(?,?,?,?) ON CONFLICT(src,rel,dst) DO UPDATE SET data=excluded.data')
      .run(src, rel, dst, data ? JSON.stringify(data) : null);
  },
  outEdges<T = Record<string, unknown>>(src: string, rel?: EdgeRel): { dst: string; rel: EdgeRel; data?: T }[] {
    const sql = rel ? 'SELECT rel,dst,data FROM edges WHERE src=? AND rel=?' : 'SELECT rel,dst,data FROM edges WHERE src=?';
    const rows = (rel ? db().prepare(sql).all(src, rel) : db().prepare(sql).all(src)) as { rel: EdgeRel; dst: string; data: string | null }[];
    return rows.map((r) => ({ dst: r.dst, rel: r.rel, data: r.data ? (JSON.parse(r.data) as T) : undefined }));
  },
  inEdges(src: string, rel?: EdgeRel): string[] {
    const sql = rel ? 'SELECT src FROM edges WHERE dst=? AND rel=?' : 'SELECT src FROM edges WHERE dst=?';
    const rows = (rel ? db().prepare(sql).all(src, rel) : db().prepare(sql).all(src)) as { src: string }[];
    return rows.map((r) => r.src);
  },

  // ── proposals ──────────────────────────────────────────────────────────────
  saveProposal(p: { id: string; pack: string; location: string; goal: string; mode: string; created_at: string; status: string; payload: unknown }) {
    db().prepare(`INSERT INTO proposals(id,pack,location,goal,mode,created_at,status,payload) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload`)
      .run(p.id, p.pack, p.location, p.goal, p.mode, p.created_at, p.status, JSON.stringify(p.payload));
  },
  getProposal<T = unknown>(id: string): T | null {
    const row = db().prepare('SELECT payload FROM proposals WHERE id=?').get(id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as T) : null;
  },
  setProposalStatus(id: string, status: string) {
    db().prepare('UPDATE proposals SET status=? WHERE id=?').run(status, id);
  },
  listProposals(): { id: string; pack: string; location: string; goal: string; mode: string; created_at: string; status: string }[] {
    return db().prepare('SELECT id,pack,location,goal,mode,created_at,status FROM proposals ORDER BY created_at DESC LIMIT 100').all() as any;
  },

  // ── run snapshots (replay, ablation, Finals Mode) ──────────────────────────
  saveSnapshot(s: RunSnapshot) {
    db().prepare('INSERT INTO snapshots(proposal_id,created_at,payload) VALUES(?,?,?) ON CONFLICT(proposal_id) DO UPDATE SET payload=excluded.payload')
      .run(s.proposal_id, s.created_at, JSON.stringify(s));
  },
  getSnapshot(id: string): RunSnapshot | null {
    const row = db().prepare('SELECT payload FROM snapshots WHERE proposal_id=?').get(id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as RunSnapshot) : null;
  },
  latestSnapshotFor(pack: string, location: string): RunSnapshot | null {
    const rows = db().prepare('SELECT payload FROM snapshots ORDER BY created_at DESC LIMIT 200').all() as { payload: string }[];
    for (const r of rows) {
      const s = JSON.parse(r.payload) as RunSnapshot;
      if (s.pack === pack && s.location === location) return s;
    }
    return null;
  },
  listSnapshots(): { proposal_id: string; pack: string; location: string; mode: string; created_at: string; items: number }[] {
    const rows = db().prepare('SELECT payload FROM snapshots ORDER BY created_at DESC LIMIT 100').all() as { payload: string }[];
    return rows.map((r) => {
      const s = JSON.parse(r.payload) as RunSnapshot;
      return { proposal_id: s.proposal_id, pack: s.pack, location: s.location, mode: s.mode, created_at: s.created_at, items: s.item_ids.length };
    });
  },

  // ── operator-entered offer terms (never guessed, always attributed) ────────
  setOfferTerm(pack: string, location: string, entityId: string, field: string, value: number) {
    db().prepare(`INSERT INTO offer_terms(pack,location,entity_id,field,value,entered_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(pack,location,entity_id,field) DO UPDATE SET value=excluded.value, entered_at=excluded.entered_at`)
      .run(pack, location, entityId, field, value, new Date().toISOString());
  },
  getOfferTerms(pack: string, location: string, entityId: string): Record<string, number> {
    const rows = db().prepare('SELECT field,value FROM offer_terms WHERE pack=? AND location=? AND entity_id=?')
      .all(pack, location, entityId) as { field: string; value: number }[];
    return Object.fromEntries(rows.map((r) => [r.field, r.value]));
  },
  listAllOfferTerms(): { pack: string; location: string; entity_id: string; field: string; value: number }[] {
    return db().prepare('SELECT pack,location,entity_id,field,value FROM offer_terms').all() as any;
  },

  // ── decision ledger (hash chain) ───────────────────────────────────────────
  appendLedger(e: Omit<LedgerEntry, 'seq' | 'hash' | 'prev_hash'>): LedgerEntry {
    const last = db().prepare('SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1').get() as { hash: string } | undefined;
    const prev_hash = last?.hash ?? '0'.repeat(64);
    const hash = ledgerHash({ ...e, prev_hash });
    const info = db().prepare(`INSERT INTO ledger(at,action,proposal_id,pack,location,actor,detail,prev_hash,hash)
      VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(e.at, e.action, e.proposal_id, e.pack, e.location, e.actor, JSON.stringify(e.detail), prev_hash, hash);
    return { ...e, prev_hash, seq: Number(info.lastInsertRowid), hash };
  },
  readLedger(limit = 200): LedgerEntry[] {
    const rows = db().prepare('SELECT * FROM ledger ORDER BY seq ASC LIMIT ?').all(limit) as any[];
    return rows.map((r) => ({
      seq: r.seq, at: r.at, action: r.action, proposal_id: r.proposal_id, pack: r.pack,
      location: r.location, actor: r.actor, detail: JSON.parse(r.detail), prev_hash: r.prev_hash, hash: r.hash,
    }));
  },
  headHash(): string | null {
    const row = db().prepare('SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1').get() as { hash: string } | undefined;
    return row?.hash ?? null;
  },

  // ── quota counters ─────────────────────────────────────────────────────────
  bumpCounter(key: string, by = 1): number {
    const now = new Date().toISOString();
    db().prepare(`INSERT INTO quota(key,value,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=value+? , updated_at=excluded.updated_at`)
      .run(key, by, now, by);
    const row = db().prepare('SELECT value FROM quota WHERE key=?').get(key) as { value: number } | undefined;
    return row?.value ?? by;
  },
  getCounter(key: string): number {
    const row = db().prepare('SELECT value FROM quota WHERE key=?').get(key) as { value: number } | undefined;
    return row?.value ?? 0;
  },
  setCounter(key: string, value: number) {
    db().prepare('INSERT INTO quota(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
      .run(key, value, new Date().toISOString());
  },
};

/** Canonical JSON so the same entry always hashes to the same value. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as any)[k])}`).join(',') + '}';
}

export type LedgerHashInput = Pick<LedgerEntry, 'at' | 'action' | 'proposal_id' | 'pack' | 'location' | 'actor' | 'detail' | 'prev_hash'>;

export function ledgerHash(e: LedgerHashInput): string {
  return createHash('sha256').update(canonicalJson({
    at: e.at, action: e.action, proposal_id: e.proposal_id, pack: e.pack,
    location: e.location, actor: e.actor, detail: e.detail, prev_hash: e.prev_hash,
  })).digest('hex');
}

/** Walk the chain and report the first broken link, if any. */
export function verifyLedger(entries: LedgerEntry[]): {
  ok: boolean; length: number; head_hash: string | null;
  first_broken_seq: number | null; reason: string | null;
} {
  let prev = '0'.repeat(64);
  for (const e of entries) {
    if (e.prev_hash !== prev) {
      return { ok: false, length: entries.length, head_hash: entries.at(-1)?.hash ?? null, first_broken_seq: e.seq, reason: `entry ${e.seq} points at ${e.prev_hash.slice(0, 12)}… but the previous entry hashes to ${prev.slice(0, 12)}…` };
    }
    const expect = ledgerHash({ at: e.at, action: e.action, proposal_id: e.proposal_id, pack: e.pack, location: e.location, actor: e.actor, detail: e.detail, prev_hash: e.prev_hash });
    if (expect !== e.hash) {
      return { ok: false, length: entries.length, head_hash: entries.at(-1)?.hash ?? null, first_broken_seq: e.seq, reason: `entry ${e.seq} content does not match its recorded hash (edited after the fact)` };
    }
    prev = e.hash;
  }
  return { ok: true, length: entries.length, head_hash: prev === '0'.repeat(64) ? null : prev, first_broken_seq: null, reason: null };
}

export function resetGraph() {
  if (_db) _db.exec('DELETE FROM nodes; DELETE FROM edges; DELETE FROM proposals; DELETE FROM ledger; DELETE FROM snapshots; DELETE FROM offer_terms; DELETE FROM quota;');
}

export const sqliteDb = db;
