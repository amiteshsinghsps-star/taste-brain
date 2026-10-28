// Ablation Lab (F11). Deterministic, computed from a stored run snapshot, so it
// costs no Qloo calls and cannot change between judges. Numbers are reported
// exactly as computed — including when they are small.

import type { AblationArm, AblationResult, AblationRow, QlooEntityResult, RunSnapshot } from '../types';

const K = 10;

/** Deterministic PRNG so the shuffled control is identical on every machine. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kendallTau(a: string[], b: string[]): number | null {
  const common = a.filter((x) => b.includes(x));
  if (common.length < 2) return null;
  const orderA = common.map((x) => a.indexOf(x));
  const orderB = common.map((x) => b.indexOf(x));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < common.length; i++) {
    for (let j = i + 1; j < common.length; j++) {
      const da = orderA[i] - orderA[j];
      const db = orderB[i] - orderB[j];
      if (da * db > 0) concordant++;
      else if (da * db < 0) discordant++;
    }
  }
  const total = concordant + discordant;
  return total === 0 ? null : +((concordant - discordant) / total).toFixed(4);
}

interface ArmComparison {
  overlap: number | null;
  tau: number | null;
  changed: number | null;
  k_effective: number | null;
  /** True when both arms hold the same item set, so only the order can differ. */
  same_membership: boolean;
}

function compare(reference: string[], arm: string[], k: number): ArmComparison {
  if (!arm.length) return { overlap: null, tau: null, changed: null, k_effective: null, same_membership: false };
  // Comparing 10 of a 4-row pool would report agreement on the whole pool; the
  // slice is capped at what each arm actually holds and that cap is disclosed.
  const kEff = Math.min(k, reference.length, arm.length);
  const topRef = reference.slice(0, kEff);
  const topArm = arm.slice(0, kEff);
  const shared = topRef.filter((x) => topArm.includes(x)).length;
  const overlap = +(shared / Math.max(1, Math.min(topRef.length, topArm.length))).toFixed(4);
  const changed = topRef.filter((x, i) => topArm[i] !== x).length;
  const sameMembership = new Set(reference).size === new Set(arm).size
    && reference.every((x) => arm.includes(x));
  return { overlap, tau: kendallTau(reference, arm), changed, k_effective: kEff, same_membership: sameMembership };
}

export function computeAblation(snapshot: RunSnapshot, k = K): AblationResult {
  const ids = (arr: QlooEntityResult[]) => arr.map((e) => e.entity_id);
  const full = ids(snapshot.candidates);
  const byId = new Map(snapshot.candidates.map((c) => [c.entity_id, c]));
  // Arm B/C rows are not in the proposal's own candidate list, but their names
  // come from the stored rows for that arm — never invented here either.
  for (const arr of Object.values(snapshot.variants)) {
    for (const e of arr ?? []) if (!byId.has(e.entity_id)) byId.set(e.entity_id, e);
  }

  const armDefs: { arm: AblationArm; label: string; list: string[]; note: string }[] = [
    { arm: 'full', label: 'A · Full — seeds + location', list: full, note: 'the ranking the proposal used' },
    { arm: 'location_only', label: 'B · Location only — no taste seeds', list: ids(snapshot.variants.location_only ?? []), note: 'what a room-signal-only query returns' },
    { arm: 'seeds_only', label: 'C · Seeds only — no location', list: ids(snapshot.variants.no_location ?? []), note: 'the same seeds without the room' },
    {
      arm: 'no_qloo',
      label: 'D · No Qloo — stated ordering',
      list: [...snapshot.candidates]
        .sort((a, b) => (a.followers ?? Number.MAX_SAFE_INTEGER) - (b.followers ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name))
        .map((c) => c.entity_id),
      note: 'a venue without taste data would order this way: smallest known audience first, then alphabetically. No Qloo ordering used at all.',
    },
    {
      arm: 'shuffled_qloo',
      label: 'E · Shuffled Qloo control',
      list: (() => {
        const rnd = mulberry32(42);
        const arr = [...full];
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      })(),
      note: 'same items, order destroyed with a fixed seed. If this scores like the real ranking, the ranking carries no signal.',
    },
  ];

  const rows: AblationRow[] = armDefs.map((def) => {
    const available = def.list.length > 0;
    if (def.arm === 'full') {
      return {
        arm: def.arm, label: def.label, available, note: def.note,
        arm_pool: def.list.length, k_effective: Math.min(k, def.list.length),
        overlap_at_k: 1, kendall_tau: 1, changed_in_top_k: 0,
        top_names: def.list.slice(0, k).map((id) => byId.get(id)?.name ?? id),
      };
    }
    const cmp = compare(full, def.list, k);
    // Arms D and E are reorderings of arm A, so their membership figure is 1.0
    // by construction. Saying so here is what keeps the number honest.
    const caveat = available && cmp.same_membership && cmp.overlap === 1 && (cmp.tau ?? 1) < 1
      ? ' — the items are identical, so membership agreement is 100% by construction; the discriminating figures are τ and the position changes'
      : available ? '' : ' — this arm returned no stored rows on this run, so no figure is computed for it';
    return {
      arm: def.arm,
      label: def.label,
      available,
      note: def.note + caveat,
      arm_pool: def.list.length,
      k_effective: cmp.k_effective,
      overlap_at_k: cmp.overlap,
      kendall_tau: cmp.tau,
      changed_in_top_k: cmp.changed,
      top_names: def.list.slice(0, k).map((id) => byId.get(id)?.name ?? id),
    };
  });

  return {
    proposal_id: snapshot.proposal_id,
    pack: snapshot.pack,
    location: snapshot.location,
    computed_at: new Date().toISOString(),
    k,
    candidate_pool: full.length,
    source_mode: snapshot.mode,
    rows,
  };
}

/**
 * The one-line answer for the pitch: how much of the list depends on Qloo.
 * Order-sensitive figures lead, because a small candidate pool makes the
 * membership figure saturate and say nothing.
 */
export function ablationHeadline(result: AblationResult): string {
  const measured = result.rows.filter((r) => r.available && r.arm !== 'full' && r.kendall_tau !== null);
  if (!measured.length) return 'Ablation arms did not return enough stored rows to compute a figure on this run.';
  const kSlice = Math.max(...measured.map((r) => r.k_effective ?? 0));
  const bits = measured.map((r) => {
    const short = r.arm === 'location_only' ? 'dropping the taste seeds'
      : r.arm === 'seeds_only' ? "dropping the room's location"
      : r.arm === 'no_qloo' ? 'ordering without Qloo at all'
      : 'shuffling Qloo\'s order';
    return `${short}: τ ${r.kendall_tau}, ${r.changed_in_top_k ?? 0} of ${r.k_effective ?? 0} positions moved`;
  });
  const saturated = measured.every((r) => r.overlap_at_k === 1);
  const caveat = saturated
    ? `Membership overlap is ${'100%'} across every arm because this run pooled ${result.candidate_pool} candidate(s) against k=${result.k}; only the order differs, so τ and positions moved are the figures that mean anything here.`
    : `Arms were compared over the top ${kSlice} of a ${result.candidate_pool}-row pool (k=${result.k}).`;
  return `Measured on ${result.candidate_pool} candidate(s): ${bits.join('; ')}. ${caveat}`;
}
