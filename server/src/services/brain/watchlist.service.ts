import crypto from 'crypto';
import { forTenant } from '../../graph/graph.client';
import { runQuery, mergeNode } from '../../graph/graph.queries';
import { normalizeName } from '../../graph/graph.schema';

/**
 * Tenant watchlist — the write path behind "add your own screening entry".
 *
 * The denied-party rule already reads every `WatchlistEntry` node in the tenant
 * graph as engine facts (`loadFactsFromGraph`), so an entry added here changes
 * the next screening verdict for real: no parallel list, no stub, no reseed.
 * The seeded demo entries stay read-only so the demo story cannot be deleted.
 */

export interface WatchlistEntryRow {
  id: string;
  name: string;
  list: string | null;
  note: string | null;
  addedBy: string | null;
  at: string | null;
  demoSeed: string | null;
}

export interface ScreeningPreview {
  /** Bookings already in the graph whose declared parties would match this string. */
  wouldFlag: Array<{ bookingNumber: string; party: string; matched: string }>;
  screenedBookings: number;
  statement: string;
}

const MAX_NAME = 120;

function cleanName(value: unknown): string {
  const raw = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (raw.length < 2) throw new Error('name must be at least 2 characters');
  if (raw.length > MAX_NAME) throw new Error(`name must be ${MAX_NAME} characters or fewer`);
  return raw;
}

function cleanList(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'tenant-review-list';
  return raw.replace(/[^A-Za-z0-9 ._()-]/g, '').slice(0, 60) || 'tenant-review-list';
}

export class WatchlistService {
  static async list(tenantId: string): Promise<WatchlistEntryRow[]> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(
      graph,
      `MATCH (w:WatchlistEntry)
       RETURN w.id AS id, w.name AS name, w.list AS list, w.note AS note,
              w.addedBy AS addedBy, w.at AS at, coalesce(w.demoSeed, 'false') AS demoSeed
       ORDER BY at DESC, name ASC`,
      {}
    );
    return rows.map((r: any) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      list: r.list ?? null,
      note: r.note ?? null,
      addedBy: r.addedBy ?? null,
      at: r.at ?? null,
      demoSeed: String(r.demoSeed ?? 'false'),
    }));
  }

  /** Count stored bookings that the pure engine would flag once this name exists. */
  static async previewScreening(tenantId: string, name: string): Promise<ScreeningPreview> {
    const graph = await forTenant(tenantId);
    const needle = String(name || '').toLowerCase().trim();
    const rows = await runQuery(graph, `MATCH (b:Booking) RETURN b.id AS id, b.bookingNumber AS bookingNumber, b.input AS input`, {});
    const wouldFlag: ScreeningPreview['wouldFlag'] = [];
    for (const b of rows) {
      let input: Record<string, any> = {};
      try {
        input = JSON.parse(b.input || '{}');
      } catch {
        continue;
      }
      const parties = [input.shipper, input.consignee, input.notifyParty].filter(Boolean).map(String);
      const hit = parties.find((p) => needle.length > 1 && p.toLowerCase().includes(needle));
      if (hit) wouldFlag.push({ bookingNumber: String(b.bookingNumber || b.id || ''), party: hit, matched: needle });
    }
    return {
      wouldFlag: wouldFlag.slice(0, 25),
      screenedBookings: rows.length,
      statement: needle
        ? `Matching "${needle}" against ${rows.length} stored booking(s) using the same substring rule the screening engine uses: ${wouldFlag.length} would be flagged next run.`
        : 'No name supplied.',
    };
  }

  static async add(
    tenantId: string,
    input: { name: unknown; list?: unknown; note?: unknown },
    actor: string
  ): Promise<{ entry: WatchlistEntryRow; alreadyPresent: boolean; preview: ScreeningPreview }> {
    const graph = await forTenant(tenantId);
    const name = cleanName(input.name);
    const list = cleanList(input.list);
    const note = String(input.note ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300);

    const existing = await runQuery(
      graph,
      `MATCH (w:WatchlistEntry) WHERE toLower(w.name) = toLower($name)
       RETURN w.id AS id, w.name AS name, w.list AS list, w.note AS note, w.addedBy AS addedBy, w.at AS at, coalesce(w.demoSeed, 'false') AS demoSeed
       LIMIT 1`,
      { name }
    );

    const preview = await WatchlistService.previewScreening(tenantId, name);

    if (existing.length) {
      const row = existing[0];
      return {
        alreadyPresent: true,
        entry: {
          id: String(row.id),
          name: String(row.name),
          list: row.list ?? null,
          note: row.note ?? null,
          addedBy: row.addedBy ?? null,
          at: row.at ?? null,
          demoSeed: String(row.demoSeed ?? 'false'),
        },
        preview,
      };
    }

    const slug = normalizeName(name).replace(/\s+/g, '_');
    const id = `watch_custom_${slug || crypto.randomUUID().slice(0, 8)}`;
    const at = new Date().toISOString();
    await mergeNode(graph, 'WatchlistEntry', id, {
      name,
      list,
      note,
      addedBy: String(actor || '').slice(0, 160),
      at,
      demoSeed: 'false',
    });

    // Attach a human owner when a matching Person exists, so the entry is
    // reachable from the graph explorer instead of floating as an orphan.
    const owner = await runQuery(graph, `MATCH (p:Person) WHERE toLower($actor) CONTAINS toLower(p.name) RETURN p.id AS id LIMIT 1`, {
      actor: String(actor || '').toLowerCase(),
    });
    if (owner[0]?.id) {
      await runQuery(graph, `MATCH (p:Person {id: $pid}), (w:WatchlistEntry {id: $wid}) MERGE (p)-[:OWNS]->(w)`, {
        pid: String(owner[0].id),
        wid: id,
      });
    }

    return {
      alreadyPresent: false,
      entry: { id, name, list, note, addedBy: String(actor || ''), at, demoSeed: 'false' },
      preview,
    };
  }

  /** Removing an entry un-screens it. Seeded demo entries are refused, not deleted. */
  static async remove(tenantId: string, entryId: string): Promise<{ removed: boolean; reason?: string }> {
    const graph = await forTenant(tenantId);
    const rows = await runQuery(graph, `MATCH (w:WatchlistEntry {id: $id}) RETURN coalesce(w.demoSeed, 'false') AS demoSeed LIMIT 1`, {
      id: String(entryId || ''),
    });
    if (!rows.length) return { removed: false, reason: 'No such watchlist entry in this tenant graph.' };
    if (String(rows[0].demoSeed) === 'true') {
      return { removed: false, reason: 'Seeded demo entry — it is part of the demo company story and stays. Add your own entry to screen extra parties.' };
    }
    await runQuery(graph, `MATCH (w:WatchlistEntry {id: $id}) DETACH DELETE w`, { id: String(entryId) });
    return { removed: true };
  }
}
