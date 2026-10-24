// Thin typed client for the Taste Brain API. Every screen reads the engine's
// own words from here — the UI adds no numbers, no labels of its own invention
// and never a second ranking.

import type {
  AblationResult, ApprovalBrief, AttackOutcome, BreakItReport, CapabilityRow, CoverageBoard, DecisionExport, DecisionTrace,
  HealthInfo, LedgerEntry, ModeInfo, PackLocation, PackSummary, PartnerResult, Proposal,
  RestCallLogEntry, SnapshotRow, TasteMode, TasteLiftResult, TrustReport, VerifyReport, WhatIfResult,
  WhyNotAnswer, QlooCallLogEntry,
} from './types';

export type { TasteMode, Proposal } from './types';

const BASE = '';

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const b = await res.json(); if (b?.message) msg = String(b.message); } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const post = (p: string, body: unknown) =>
  fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export interface RunInput {
  pack: string; location: string; goal: string; mode?: TasteMode;
  chosen_seeds?: Record<string, string>;
  offer_terms?: Record<string, Record<string, number>>;
  recent_plays?: string[];
  rule_overrides?: Record<string, number>;
  snapshot_id?: string;
}

export const api = {
  mode: () => fetch(`${BASE}/api/mode`).then((r) => j<ModeInfo>(r)),
  health: () => fetch(`${BASE}/api/health`).then((r) => j<HealthInfo>(r)),

  packs: () => fetch(`${BASE}/api/packs`).then((r) => j<{ success: boolean; packs: PackSummary[] }>(r)),
  locations: (pack: string) =>
    fetch(`${BASE}/api/packs/${encodeURIComponent(pack)}/locations`).then((r) => j<{ success: boolean; locations: PackLocation[] }>(r)),
  location: (pack: string, loc: string) =>
    fetch(`${BASE}/api/packs/${encodeURIComponent(pack)}/locations/${encodeURIComponent(loc)}`)
      .then((r) => j<{ success: boolean; location: PackLocation; catalog_size: number }>(r)),

  createProposal: (body: RunInput) => post('/api/proposals', body).then((r) => j<{ success: boolean; proposal: Proposal; served_from?: 'snapshot' }>(r)),
  proposal: (id: string) => fetch(`${BASE}/api/proposals/${encodeURIComponent(id)}`).then((r) => j<{ success: boolean; proposal: Proposal }>(r)),
  latestProposal: (room?: { pack?: string; location?: string }) => {
    const q = new URLSearchParams();
    if (room?.pack) q.set('pack', room.pack);
    if (room?.location) q.set('location', room.location);
    const qs = q.toString();
    return fetch(`${BASE}/api/proposals/latest${qs ? `?${qs}` : ''}`).then((r) => j<{ success: boolean; proposal: Proposal | null }>(r));
  },
  trace: (id: string) => fetch(`${BASE}/api/proposals/${encodeURIComponent(id)}/trace`).then((r) => j<DecisionTrace>(r)),

  decide: (id: string, body: { outcome: 'approved' | 'rejected'; approver: string; entity_ids?: string[]; terms?: Record<string, Record<string, number>> }) =>
    post(`/api/proposals/${encodeURIComponent(id)}/decision`, body).then((r) => j<{ success: boolean; proposal: Proposal }>(r)),

  ablation: (id: string) =>
    fetch(`${BASE}/api/proposals/${encodeURIComponent(id)}/ablation`).then((r) => j<{ success: boolean; ablation: AblationResult; headline: string }>(r)),
  brief: (id: string, approver: string) =>
    fetch(`${BASE}/api/proposals/${encodeURIComponent(id)}/brief?approver=${encodeURIComponent(approver)}`)
      .then((r) => j<{ success: boolean; brief: ApprovalBrief }>(r)),
  snapshots: () => fetch(`${BASE}/api/snapshots`).then((r) => j<{ success: boolean; snapshots: SnapshotRow[] }>(r)),

  whyNot: (body: { pack: string; location: string; query: string; proposal_id?: string; check_entity?: boolean; recent_plays?: string[] }) =>
    post('/api/whynot', body).then((r) => j<{ success: boolean; answer: WhyNotAnswer; live_check_used: boolean; live_check_declined?: boolean }>(r)),
  whatIf: (body: {
    pack: string; location: string; proposal_id?: string;
    rule_overrides?: Record<string, number>; offer_terms?: Record<string, Record<string, number>>;
    recent_plays?: string[]; band?: { min?: number; max?: number };
  }) => post('/api/whatif', body).then((r) => j<{ success: boolean; whatif: WhatIfResult }>(r)),
  partners: (body: { pack: string; location: string; proposal_id?: string; mode?: TasteMode }) =>
    post('/api/partners', body).then((r) => j<{ success: boolean; partners: PartnerResult; mode: TasteMode; degrade_reason?: string | null }>(r)),

  ledger: () => fetch(`${BASE}/api/ledger`).then((r) => j<{ success: boolean; entries: LedgerEntry[]; head_hash: string; length: number }>(r)),
  verify: () => fetch(`${BASE}/api/ledger/verify`)
    .then((r) => j<{ success: boolean; ok: boolean; length: number; head_hash: string | null; first_broken_seq: number | null; reason: string | null; note: string }>(r)),

  // W1 — the decision export and the standalone Verifier. `api.verify` above is
  // the ledger chain only; this re-runs all five checks over an export file.
  exportDecision: (id: string) =>
    fetch(`${BASE}/api/proposals/${encodeURIComponent(id)}/export`).then((r) => j<DecisionExport>(r)),
  verifyDecision: (exp: unknown) =>
    post('/api/verify', exp).then((r) => j<{ success: boolean; report: VerifyReport }>(r)),

  // W6 — the Break-it Challenge. Each call runs the engine's real defences over
  // the synthetic Replay sample; the server decides what was blocked, not the page.
  breakItAll: () => fetch(`${BASE}/api/breakit`).then((r) => j<{ success: boolean; report: BreakItReport }>(r)),
  breakIt: (attack: string) =>
    post('/api/breakit', { attack }).then((r) => j<{ success: boolean; attack: AttackOutcome }>(r)),

  coverage: () => fetch(`${BASE}/api/coverage`).then((r) => j<{ success: boolean; board: CoverageBoard }>(r)),
  trust: () => fetch(`${BASE}/api/trust`).then((r) => j<{ success: boolean; report: TrustReport; allowlist: Record<string, string[]> }>(r)),

  evalRun: () => post('/api/eval/run', {}).then((r) => j<{ success: boolean; results: TasteLiftResult }>(r)),
  evalResults: () => fetch(`${BASE}/api/eval/results`).then((r) => j<{ success: boolean; results: TasteLiftResult | null }>(r)),

  qlooLog: () => fetch(`${BASE}/api/qloo/log`).then((r) => j<{ success: boolean; log: QlooCallLogEntry[] }>(r)),
  restLog: () => fetch(`${BASE}/api/qloo/rest-log`).then((r) => j<{ success: boolean; log: RestCallLogEntry[] }>(r)),
};

export type { CapabilityRow };
