import crypto from 'crypto';
import { forTenant } from '../../graph/graph.client';
import { runQuery } from '../../graph/graph.queries';

/**
 * Hash-chained decision ledger (PRD v3 W4) — tamper-EVIDENT integrity check
 * for agent actions and human decisions. NOT a compliance certification.
 *
 * The chain lives in the tenant FalkorDB graph: LedgerEntry nodes linked by
 * NEXT edges, (Action/Decision)-[:RECORDED_AS]->(LedgerEntry). Each entry
 * hashes the previous hash + canonical JSON of its contents, so any later edit
 * breaks every subsequent hash and /ledger/verify reports the exact sequence
 * number where the chain broke.
 */

export interface LedgerEntry {
  seq: number;
  at: string;
  actor: string;
  kind: string;
  subjectId: string;
  traceId: string;
  payloadHash: string;
  prevHash: string;
  hash: string;
}

export interface AppendInput {
  tenantId: string;
  actor: string;
  kind: string;
  subjectId: string;
  traceId?: string;
  payload?: Record<string, unknown>;
}

export interface VerifyResult {
  ok: boolean;
  entries: number;
  brokenAt?: number;
}

const GENESIS = '0'.repeat(64);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Stable canonical JSON: sorted top-level keys (payload is flat by contract). */
function canon(o: Record<string, unknown>): string {
  const keys = Object.keys(o).sort();
  return JSON.stringify(keys.map((k) => [k, o[k]]));
}

function entryPayloadHash(payload?: Record<string, unknown>): string {
  return sha(canon(payload ?? {}));
}

// Per-tenant in-process append mutex: serializes seq assignment during demo scale.
const locks = new Map<string, Promise<unknown>>();
async function withTenantLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(tenantId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(tenantId, run);
  try {
    return await run;
  } finally {
    if (locks.get(tenantId) === run) locks.delete(tenantId);
  }
}

export class LedgerService {
  /** Appends the next chained entry and links it to the acting node. */
  static async append(input: AppendInput): Promise<LedgerEntry> {
    return withTenantLock(input.tenantId, async () => {
      const graph = await forTenant(input.tenantId);
      const lastRows = await runQuery(
        graph,
        `MATCH (e:LedgerEntry) RETURN e.seq AS seq, e.hash AS hash ORDER BY toInteger(e.seq) DESC LIMIT 1`,
        {}
      );
      const last = lastRows[0];
      const seq = Number(last?.seq ?? 0) + 1;
      const prevHash = String(last?.hash || GENESIS);
      const at = new Date().toISOString();
      const traceId = input.traceId || '';
      const payloadHash = entryPayloadHash(input.payload);
      const body: Record<string, unknown> = { seq, tenantId: input.tenantId, at, actor: input.actor, kind: input.kind, subjectId: input.subjectId, traceId, payloadHash };
      const hash = sha(prevHash + canon(body));
      const id = `ledger_${seq}_${sha(input.tenantId + seq + at).slice(0, 12)}`;

      await runQuery(
        graph,
        `CREATE (e:LedgerEntry {id: $id, seq: $seq, at: $at, actor: $actor, kind: $kind, subjectId: $subjectId, traceId: $traceId, payloadHash: $payloadHash, prevHash: $prevHash, hash: $hash})
         WITH e
         OPTIONAL MATCH (prev:LedgerEntry {seq: $prevSeq})
         FOREACH (p IN CASE WHEN prev IS NULL THEN [] ELSE [prev] END | CREATE (e)-[:NEXT]->(p))
         RETURN e.id AS id`,
        { id, seq: String(seq), at, actor: input.actor, kind: input.kind, subjectId: input.subjectId, traceId, payloadHash, prevHash, hash, prevSeq: String(seq - 1) }
      );

      // Link the acting node (Decision/Task/Rule...) to its ledger record.
      if (input.subjectId) {
        try {
          await runQuery(
            graph,
            `MATCH (s {id: $subjectId}) MATCH (e:LedgerEntry {id: $entryId}) MERGE (s)-[:RECORDED_AS]->(e)`,
            { subjectId: input.subjectId, entryId: id }
          );
        } catch {
          // subject node may not exist yet; the chain entry itself is the record
        }
      }
      return { seq, at, actor: input.actor, kind: input.kind, subjectId: input.subjectId, traceId, payloadHash, prevHash, hash };
    });
  }

  /** Recomputes the chain from seq 1; returns the first break point. */
  static async verify(tenantId: string): Promise<VerifyResult> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (e:LedgerEntry) RETURN e.seq AS seq, e.at AS at, e.actor AS actor, e.kind AS kind, e.subjectId AS subjectId, e.traceId AS traceId, e.payloadHash AS payloadHash, e.prevHash AS prevHash, e.hash AS hash ORDER BY toInteger(e.seq)`,
      {}
    );
    let prev = GENESIS;
    for (const r of rows) {
      const body: Record<string, unknown> = {
        seq: Number(r.seq),
        tenantId,
        at: r.at,
        actor: r.actor,
        kind: r.kind,
        subjectId: r.subjectId,
        traceId: r.traceId || '',
        payloadHash: r.payloadHash,
      };
      if (String(r.prevHash) !== prev || sha(prev + canon(body)) !== String(r.hash)) {
        return { ok: false, entries: rows.length, brokenAt: Number(r.seq) };
      }
      prev = String(r.hash);
    }
    return { ok: true, entries: rows.length };
  }

  /** Lists entries (newest first) for the UI / audit view. */
  static async list(tenantId: string, limit = 50): Promise<LedgerEntry[]> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (e:LedgerEntry) RETURN e.seq AS seq, e.at AS at, e.actor AS actor, e.kind AS kind, e.subjectId AS subjectId, e.traceId AS traceId, e.payloadHash AS payloadHash, e.prevHash AS prevHash, e.hash AS hash ORDER BY toInteger(e.seq) DESC LIMIT $limit`,
      { limit }
    );
    return rows.map((r: any) => ({ ...r, seq: Number(r.seq) }));
  }
}
