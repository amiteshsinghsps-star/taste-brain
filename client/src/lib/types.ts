// Client mirror of the server's domain types (server/src/types.ts). The engine
// is the source of truth: nothing here invents a field the API does not return.

export type TasteMode = 'live' | 'cached' | 'replay';
export type RuleStatus = 'pass' | 'fail' | 'needs_data';
export type OnMissing = 'block' | 'flag';

export interface QlooTagRef { id: string; name: string; type: string }

export interface RuleResult {
  rule_id: string;
  status: RuleStatus;
  pass: boolean;
  reason: string;
  source: string;
  on_missing?: OnMissing;
  metric?: string;
  observed?: number;
  threshold?: number;
  direction?: 'max' | 'min';
}

export interface NeedsTerm { rule_id: string; field: string; enterable: boolean; label: string }

export interface EvidenceCard {
  entity_id: string;
  endpoint: string;
  workflow: string;
  mode: TasteMode;
  fetched_at: string;
  qloo_rank: number;
  popularity?: number;
  obscurity?: number;
  followers?: number;
  primary_genres: string[];
  qloo_tags: QlooTagRef[];
  explainability?: string;
  fit_note: string;
}

export interface ProposalItem {
  entity_id: string;
  offer_id: string;
  rank: number;
  name: string;
  type: string;
  fit: number;
  qloo_rank: number;
  popularity?: number;
  obscurity?: number;
  followers?: number;
  tags: string[];
  explanation: string;
  rule_results: RuleResult[];
  evidence: EvidenceCard;
  mode: TasteMode;
  approval_blocked: boolean;
  needs_terms: NeedsTerm[];
  local_lift?: number | null;
  rising?: 'up' | 'steady' | 'down' | null;
}

export interface AuditRejection {
  entity_id: string; offer_id: string; name: string;
  reason: string; check: number; rule_id?: string; at: string;
}

export type TraceStepType =
  | 'Rule' | 'Audience' | 'QlooEntity' | 'Offer' | 'Proposal' | 'Decision'
  | 'Filter' | 'Relax' | 'Allowlist' | 'Ablation' | 'Ledger' | 'Partner';

export interface TraceStep {
  type: TraceStepType; label: string; source?: string; id?: string;
  score?: number | null; result?: 'pass' | 'fail' | 'info' | 'needs_data';
  mode?: TasteMode; detail?: string; at: string;
}

export type ModeMix = Record<TasteMode, number>;

export interface DecisionTrace {
  proposal_id: string; pack: string; location: string; goal: string;
  mode: TasteMode; steps: TraceStep[]; rerun_hash: string; mode_mix?: ModeMix;
}

export interface FlipPoint {
  entity_id: string; name: string; rule_id: string; metric: string;
  observed: number; current_threshold: number; required_threshold: number;
  delta: number; direction: 'max' | 'min'; note: string;
}

export interface Proposal {
  proposal_id: string; pack: string; location: string; goal: string;
  mode: TasteMode; created_at: string;
  degrade_reason?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  items: ProposalItem[];
  unsupported: { offer_id: string; name: string; reason: string }[];
  rejections: AuditRejection[];
  unresolved_seeds: { input: string; candidates: string[] }[];
  relaxations: string[];
  allowlist_violations: string[];
  audience_tags: { name: string; id: string }[];
  local_lift_note: string;
  flip_points: FlipPoint[];
  trace: DecisionTrace;
}

export interface PackRule {
  id: string; kind: string; field?: string; value?: number; tags?: string[]; list?: string[];
  band?: { field: string; min?: number; max?: number };
  source: string; snippet?: string; on_missing?: OnMissing;
}

export interface PackSummary {
  pack: string; unit: string; display_name: string; description: string;
  goal_templates: string[]; copy: { audience_label: string; offer_label: string };
  rules: PackRule[];
  data_provenance: { id: string; name: string; provenance: string }[];
}

export interface PackLocation {
  id: string; name: string; city: string; seeds: string[]; catalog: string;
  capacity_tier?: string;
  accept_unknown_offers?: boolean;
  rule_overrides?: Record<string, number>;
  rule_ids?: string[];
  popularity_band?: { min?: number; max?: number };
  exclude_entity_ids?: string[];
  exclude_tag_ids?: string[];
  recent_plays?: string[];
  data_provenance: string;
  /** Measured on the server: does this room have a committed Replay catalog? */
  replay_fixture?: boolean;
}

export type AblationArm = 'full' | 'location_only' | 'seeds_only' | 'no_qloo' | 'shuffled_qloo';

export interface AblationRow {
  arm: AblationArm; label: string; available: boolean; note: string;
  arm_pool: number; k_effective: number | null;
  overlap_at_k: number | null; kendall_tau: number | null;
  changed_in_top_k: number | null; top_names: string[];
}

export interface AblationResult {
  proposal_id: string; pack: string; location: string; computed_at: string;
  k: number; candidate_pool: number; source_mode: TasteMode; rows: AblationRow[];
}

export interface WhatIfResult {
  proposal_id: string; recomputed_at: string; qloo_calls_used: number;
  before: { entity_id: string; name: string; rank: number }[];
  after: { entity_id: string; name: string; rank: number }[];
  changes: { name: string; entity_id: string; qloo_rank: number | null; direction: 'added' | 'removed'; because: string }[];
  rules_applied: { id: string; snippet: string; overridden: boolean }[];
  notes: string[];
  flip_points_offered: { rule_id: string; name: string; required_threshold: number; note: string }[];
}

export type WhyNotVerdict =
  | 'in_proposal' | 'rule_rejected' | 'awaiting_term' | 'filtered_before_query'
  | 'not_returned_by_qloo' | 'exists_but_not_returned' | 'unknown_entity';

export interface WhyNotAnswer {
  query: string; verdict: WhyNotVerdict; headline: string; detail: string[];
  entity_id: string | null; qloo_rank: number | null; failing_rule: string | null;
  flip: { rule_id: string; metric: string; current_threshold: number; required_threshold: number; note: string } | null;
  proven_from: string;
}

export interface PartnerRow {
  entity_id: string; name: string; type: string; variant: string; qloo_rank: number;
  popularity?: number; explainability?: string; shared_tags: string[];
  mode: TasteMode; endpoint: string; fetched_at: string;
}

export interface PartnerResult {
  pack: string; location: string; generated_at: string; qloo_calls_used: number;
  rows: PartnerRow[]; audience_tags: string[]; note: string; limits: string[];
}

export interface ApprovalBrief {
  proposal_id: string; written_at: string; title: string;
  sections: { heading: string; lines: string[] }[]; sign_off: string; text: string;
}

export interface LedgerEntry {
  seq: number; at: string;
  action: 'proposed' | 'approved' | 'rejected' | 'term_entered' | 'rule_changed' | 'ablation';
  proposal_id: string; pack: string; location: string; actor: string;
  detail: Record<string, unknown>; prev_hash: string; hash: string;
}

export interface TrustCheck { id: string; claim: string; status: 'pass' | 'fail' | 'unproven'; evidence: string }

export interface TrustReport {
  generated_at: string; checks: TrustCheck[]; passed: number; failed: number; unproven: number;
  proposal_id: string | null;
  ledger: {
    length: number; head_hash: string | null; ok: boolean;
    first_broken_seq: number | null; reason: string | null;
    entries: { seq: number; at: string; action: string; proposal_id: string; pack: string; location: string; actor: string; hash: string; prev_hash: string }[];
  };
  tamper_demo: { changed_field: string; stored_hash: string; recomputed_hash: string; detected: boolean };
  probes: { probe: string; outcome: string }[];
  allowlist: { endpoint: string; params: string[] }[];
  violations: { at: string; endpoint: string; param: string; detail: string }[];
  coverage: { verified: number; accepted_but_empty: number; not_usable: number; verified_at: string };
}

export interface CapabilityRow {
  id: string; name: string; endpoint: string;
  status: 'verified' | 'accepted_but_empty' | 'not_usable';
  params: string[]; evidence: string; used_by: string;
  http_status?: number; row_count?: number; probe_at?: string;
}

export interface CoverageBoard {
  verified_at: string; base_url: string;
  gate: { requirement: string; result: string; note: string };
  counts: { verified: number; accepted_but_empty: number; not_usable: number };
  rows: CapabilityRow[]; field_notes: string[]; method: string;
}

export interface ModeInfo {
  default_mode: TasteMode; qloo_enabled: boolean; qloo_key: 'set' | 'missing';
  qloo_rest_active: boolean; finals_mode: boolean; llm_model: string;
  quota_note: string; per_run_call_budget: number;
  quota: { used: number; soft_limit: number; within_limit: boolean };
}

export interface HealthInfo {
  success: boolean; status: string; qloo_key: string; qloo_rest_active: boolean;
  finals_mode: boolean; default_mode: TasteMode; llm_model: string;
  buckets: {
    visitor_hour: string; visitor_day: string; global_day: string; monthly: string;
    live_allowed: boolean; floor_reached: boolean; finals_override: boolean;
  };
  per_run_call_budget: number;
  harness_quota: { used: number; soft_limit: number; within_limit: boolean };
  quota: {
    visitor_hour: { used: number; limit: number };
    visitor_day: { used: number; limit: number };
    global_day: { used: number; limit: number };
    monthly: { used: number; floor: number };
  };
  live_allowed: boolean; live_possible: boolean; floor_reached: boolean; note: string;
}

export interface QlooCallLogEntry {
  seq: number; workflow: string; variant: string;
  inputs_redacted: Record<string, unknown>; latency_ms: number;
  cache_hit: boolean;
  /** The attempt read nothing at all: neither a stored answer nor a response. */
  failed?: boolean;
  endpoint: string; entity_count: number;
  mode: TasteMode; at: string; note?: string; pack?: string; location?: string;
}

export interface RestCallLogEntry {
  seq: number; at: string; path: string; workflow: string;
  status: number; latency_ms: number; cache_hit: boolean; mode: TasteMode;
  entity_count: number; inputs_redacted: Record<string, unknown>;
}

export interface SnapshotRow {
  proposal_id: string; pack: string; location: string; mode: string; created_at: string; items: number;
}

export interface ArmMetrics {
  arm: 'A_plain_llm' | 'B_grounded';
  ran: boolean;
  note: string;
  grounding_rate: number;
  rule_compliance: number;
  specificity: number;
  item_count: number;
  raw_items: string[];
}

export interface TasteLiftResult {
  run_date: string;
  sample_size: number;
  model: string;
  mode: TasteMode;
  git_commit: string;
  rubric: string[];
  summary: {
    armB: { grounding_rate: number; rule_compliance: number; specificity: number };
    armA: { ran: boolean; grounding_rate: number; specificity: number };
  };
  per_request: { request: { pack: string; location: string; goal: string }; armA: ArmMetrics; armB: ArmMetrics }[];
}

// ── W1 Verifier ──────────────────────────────────────────────────────────────

export interface VerifyCheck {
  id: string;
  name: string;
  status: 'pass' | 'fail';
  detail: string;
  first_failing: string | null;
}

export interface VerifyReport {
  ran_at: string;
  ok: boolean;
  passed: number;
  failed: number;
  checks: VerifyCheck[];
  proposal_id: string | null;
  schema: string | null;
  error: string | null;
}

/** Mirrors server/src/verify/export.ts. The client only renders it; the checks
 *  are computed by the same module the CLI runs. */
export interface DecisionExport {
  schema: string;
  exported_at: string;
  honest_scope: { proves: string[]; does_not_prove: string[] };
  provenance: { proposal_id: string; pack: string; location: string; goal: string; decision_mode: TasteMode };
  decision: Proposal;
  evidence: {
    entity_ids: string[];
    candidates: { entity_id: string; name: string; qloo_rank: number; tag_names: string[] }[];
  };
  rules: { pinned_version: string; rules: unknown[] };
  rule_subjects: { entity_id: string; name: string; fields: Record<string, number>; offer_tags: string[] }[];
  ledger: LedgerEntry[];
  ledger_head_hash: string | null;
}

/** Mirrors server/src/breakit/attacks.ts. Every field is the engine's own
 *  account of a defence it ran, not text written for this page. */
export interface AttackOutcome {
  id: string;
  name: string;
  attempted: string;
  defence: { check: string; where: string };
  blocked: boolean;
  detail: string;
  log_entry: Record<string, unknown>;
}

export interface BreakItReport {
  ran_at: string;
  sandbox: {
    basis: string;
    mode: TasteMode;
    real_ledger_written: false;
    real_ledger_still_intact: boolean | null;
    network_calls_before: number;
    network_calls_after: number;
  };
  blocked: number;
  total: number;
  ok: boolean;
  attacks: AttackOutcome[];
}
