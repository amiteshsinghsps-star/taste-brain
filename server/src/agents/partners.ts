// Co-promotion partners (V5). A venue does not sell tickets alone: it shares an
// audience with record shops, brands, venues and places. Qloo answers this
// directly by asking the same taste signal for a different entity type (verified
// live: /v2/insights with filter.type=urn:entity:brand and urn:entity:place
// return rows with their own explanation text).
//
// What is measured is audience overlap only. Nothing here is a claim that a
// company agreed to anything, and no partner is invented: if Qloo returns no
// rows, the screen says so.

import type { Session } from '../qloo/adapter';
import type { QlooTagRef } from '../types';

export interface PartnerRow {
  entity_id: string;
  name: string;
  type: string;
  /** The insights variant that produced this row, e.g. "partners_brand". */
  variant: string;
  qloo_rank: number;
  popularity?: number;
  explainability?: string;
  shared_tags: string[];
  mode: string;
  endpoint: string;
  fetched_at: string;
}

export interface PartnerResult {
  pack: string;
  location: string;
  generated_at: string;
  qloo_calls_used: number;
  rows: PartnerRow[];
  /** The audience tags the overlap was computed against — empty in replay. */
  audience_tags: string[];
  note: string;
  limits: string[];
}

const shared = (entityTags: QlooTagRef[], audienceTags: { name: string }[]) => {
  const names = new Set(audienceTags.map((t) => t.name.toLowerCase()));
  return entityTags.filter((t) => names.has(t.name.toLowerCase())).map((t) => t.name);
};

export async function coPromotionPartners(opts: {
  session: Session;
  seeds: string[];
  locationQuery: string;
  audienceTags: { name: string }[];
  types?: string[];
  /** False when the seeds are the room's configured labels, not /search output. */
  seedsWereResolved?: boolean;
}): Promise<PartnerResult> {
  const limits: string[] = [];
  const rows: PartnerRow[] = [];
  const audienceTagNames = opts.audienceTags.map((t) => t.name);
  const before = opts.session.calls.length;

  if (!opts.seeds.length) {
    return {
      pack: opts.session.pack, location: opts.session.location, generated_at: new Date().toISOString(),
      qloo_calls_used: 0, rows: [], audience_tags: audienceTagNames,
      note: 'this room carries no taste seed at all, so there is nothing to ask about. Partners are never invented.',
      limits: ['a partner query needs at least one seed entity'],
    };
  }

  for (const t of opts.types ?? ['brand', 'place']) {
    try {
      const r = await opts.session.insights({
        variant: `partners_${t}`,
        filterType: `urn:entity:${t}`,
        seeds: opts.seeds,
        locationQuery: opts.locationQuery,
        useLocation: true,
        take: 10,
      });
      if (!r.entities.length) {
        limits.push(`Qloo returned no ${t} rows for this room's audience`);
        continue;
      }
      for (const e of r.entities) {
        rows.push({
          entity_id: e.entity_id, name: e.name, type: e.type, variant: `partners_${t}`, qloo_rank: e.qloo_rank,
          popularity: e.popularity, explainability: e.explainability,
          shared_tags: shared(e.qloo_tags, opts.audienceTags),
          mode: r.mode, endpoint: e.source.endpoint || '/v2/insights', fetched_at: e.source.fetched_at,
        });
      }
    } catch (err: any) {
      limits.push(`${t} query failed: ${String(err?.message ?? err).slice(0, 90)}`);
    }
  }

  if (opts.seedsWereResolved === false) {
    limits.push(`seeds were taken from this room's configuration, not from a /search lookup — ${opts.session.mode} mode makes no name resolution`);
  }
  if (rows.length && audienceTagNames.length === 0) {
    limits.push('this run carries no audience tags, so no row can be shown as sharing one — that is missing data on our side, not a lack of overlap in Qloo');
  }

  const made = opts.session.calls.slice(before);
  const live_reads = made.filter((c) => c.mode === 'live' && !c.cache_hit).length;
  const from_store = made.length - live_reads;
  if (from_store) limits.push(`${from_store} of the ${made.length} partner lookups were served from the stored copy — no bytes left this box for those`);

  return {
    pack: opts.session.pack,
    location: opts.session.location,
    generated_at: new Date().toISOString(),
    qloo_calls_used: live_reads,
    rows,
    audience_tags: audienceTagNames,
    note: rows.length
      ? `Audience overlap only. These ${rows.length} ${opts.types?.join('/') ?? 'brand/place'} entities come back for the same taste signal Qloo used to rank acts for this room; shared_tags lists the Qloo tags they have in common with the room's audience. It is not evidence that any of them has agreed to a promotion.`
      : 'Qloo returned no cross-domain rows for this audience, so there is nothing to show. No partner was invented to fill the screen.',
    limits,
  };
}
