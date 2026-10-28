// Shared domain types for Taste Brain.
//
// Scoring honesty note (verified live on the hackathon key, 2026-10-24):
// Qloo's /v2/insights returns results in its own relevance order and does NOT
// return an `affinity` or `score` field for entity results. The authoritative
// signal from Qloo is therefore the ORDER of the returned list, plus the
// `popularity` field and `properties` attributes. `qloo_rank` below is Qloo's
// own ordering; `fit` is a display value DERIVED BY TASTE BRAIN from that rank
// and is always labelled as derived. The LLM never produces either number.

export type TasteMode = 'live' | 'cached' | 'replay';

export interface QlooTagRef {
  id: string;
  name: string;
  type: string;
}

export type RuleKind =
  | 'numeric_max'      // offer field must be <= value (e.g. guarantee_usd)
  | 'numeric_min'      // offer field must be >= value
  | 'exclude_tags'
  | 'require_tags'
  | 'allow_list'
  | 'deny_list'
  | 'exclude_recent'   // no-repeat window: name appears in the operator's recent list
  | 'band'             // Qloo-reported attribute must sit inside [min,max] (room fit)
  | 'require_present'; // a field must exist at all (never guessed)

// What happens when the data a rule needs is not on file.
//   block -> rule cannot be proven, item is rejected (never assumed compliant)
//   flag  -> item stays visible but cannot be approved until the term is entered
export type OnMissing = 'block' | 'flag';

export interface BandField {
  field: 'qloo_popularity' | 'qloo_obscurity' | 'qloo_followers' | 'qloo_listeners';
  min?: number;
  max?: number;
}

export interface Rule {
  id: string;
  kind: RuleKind;
  field?: string;            // for numeric/band rules (offer field, or a band alias)
  value?: number;
  tags?: string[];           // tag names or tag ids for exclude/require rules
  list?: string[];           // allow/deny/exclude_recent name lists
  band?: BandField;          // for kind 'band' — reads a Qloo-reported attribute
  source: string;            // SOP document + line
  snippet?: string;          // human-readable rule text
  on_missing?: OnMissing;    // default 'block'
}

export interface CandidateOffer {
  offer_id: string;
  name: string;
  fields: Record<string, number>;   // operator-entered terms (guarantee_usd, ...)
  tags: string[];
  qloo_entity_id?: string;          // real Qloo uuid when known; placeholder id otherwise
}

export interface QlooEntityResult {
  entity_id: string;
  name: string;
  type: string;
  qloo_rank: number;                // 1-based position in Qloo's own result order
  fit: number;                      // derived by Taste Brain from qloo_rank (0..1)
  popularity?: number;              // Qloo field (0..1)
  obscurity?: number;               // Qloo properties.obscurity_scale (1..10)
  followers?: number;               // Qloo external.spotify[0].followers
  listeners?: number;               // Qloo external.lastfm[0].listeners
  start_year?: number;
  primary_genres?: string[];
  qloo_tags: QlooTagRef[];
  tag_names: string[];
  explainability?: string;          // English short description from Qloo
  source: { workflow: string; mode: TasteMode; fetched_at: string; endpoint: string };
}

export type RuleStatus = 'pass' | 'fail' | 'needs_data';

export interface RuleResult {
  rule_id: string;
  status: RuleStatus;
  pass: boolean;                 // convenience: status === 'pass'
  reason: string;
  source: string;
  on_missing?: OnMissing;
  // Numbers behind the verdict, so the Flip Point engine can compute a delta.
  metric?: string;
  observed?: number;
  threshold?: number;
  direction?: 'max' | 'min';
}

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
  fit_note: string;              // states plainly that fit is derived from Qloo rank
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
  /** The exact inputs the Rule Checker saw for this item, kept so a decision can
   *  be re-evaluated offline by the Verifier without a database or a Qloo key. */
  rule_inputs?: { fields: Record<string, number>; offer_tags: string[] };
  evidence: EvidenceCard;
  mode: TasteMode;
  // True when a rule could not be proven because the operator has not entered a
  // term yet (on_missing: 'flag'). Approval is refused until the term is entered.
  approval_blocked: boolean;
  needs_terms: NeedsTerm[];
  local_lift?: number | null;    // derived: rank moves caused by the location signal
  rising?: 'up' | 'steady' | 'down' | null; // derived from bias.trends vs default order
}

export interface AuditRejection {
  entity_id: string;
  offer_id: string;
  name: string;
  reason: string;
  check: number;
  rule_id?: string;
  at: string;
}

export type TraceStepType =
  | 'Rule' | 'Audience' | 'QlooEntity' | 'Offer' | 'Proposal' | 'Decision'
  | 'Filter' | 'Relax' | 'Allowlist' | 'Ablation' | 'Ledger' | 'Partner';

export interface TraceStep {
  type: TraceStepType;
  label: string;
  source?: string;
  id?: string;
  score?: number | null;
  result?: 'pass' | 'fail' | 'info' | 'needs_data';
  mode?: TasteMode;
  detail?: string;
  at: string;
}

export type ModeMix = Record<TasteMode, number>;

export interface DecisionTrace {
  proposal_id: string;
  pack: string;
  location: string;
  goal: string;
  mode: TasteMode;
  steps: TraceStep[];
  rerun_hash: string;
  mode_mix?: ModeMix;
}

export interface NeedsTerm {
  rule_id: string;
  /** The offer field the operator must enter, or the Qloo attribute that is absent. */
  field: string;
  /** False when the missing value is a Qloo attribute — nothing to enter. */
  enterable: boolean;
  label: string;
}

export interface FlipPoint {
  entity_id: string;
  name: string;
  rule_id: string;
  metric: string;
  observed: number;
  current_threshold: number;
  required_threshold: number;
  delta: number;
  direction: 'max' | 'min';
  note: string;
}

export interface Proposal {
  proposal_id: string;
  pack: string;
  location: string;
  goal: string;
  mode: TasteMode;
  /** Why a live request came back Cached or Replay — stored with the run, not just the session. */
  degrade_reason?: string | null;
  created_at: string;
  status: 'pending' | 'approved' | 'rejected';
  items: ProposalItem[];
  unsupported: { offer_id: string; name: string; reason: string }[];
  rejections: AuditRejection[];
  unresolved_seeds: { input: string; candidates: string[] }[];
  relaxations: string[];          // empty-result ladder steps applied, in order
  allowlist_violations: string[]; // params refused before sending, never silently dropped
  audience_tags: { name: string; id: string }[];
  local_lift_note: string;
  flip_points: FlipPoint[];
  trace: DecisionTrace;
}

/** One adapter call as the call-log screen receives it. Mirrors SessionCallLog. */
export interface QlooCallLogEntry {
  seq: number;
  workflow: string;
  variant: string;
  inputs_redacted: Record<string, unknown>;
  latency_ms: number;
  cache_hit: boolean;
  /** The attempt read nothing: no stored answer and no response. */
  failed?: boolean;
  endpoint: string;
  entity_count: number;
  mode: TasteMode;
  at: string;
  note?: string;
  pack?: string;
  location?: string;
}

// ── Ledger ───────────────────────────────────────────────────────────────────

export interface LedgerEntry {
  seq: number;
  at: string;
  action: 'proposed' | 'approved' | 'rejected' | 'term_entered' | 'rule_changed' | 'ablation';
  proposal_id: string;
  pack: string;
  location: string;
  actor: string;
  detail: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

// ── Run snapshot (replay without a model, ablation arms, Finals Mode) ────────

export interface RunSnapshot {
  proposal_id: string;
  pack: string;
  location: string;
  goal: string;
  mode: TasteMode;
  created_at: string;
  resolved_seeds: string[];
  seed_inputs: string[];
  location_query: string;
  rules: Rule[];
  candidates: QlooEntityResult[];      // Qloo order preserved
  variants: Record<string, QlooEntityResult[]>; // e.g. no_location, trend_bias, location_only
  recent_plays?: string[];             // the no-repeat window in force at the time
  audience_tags?: { name: string; id: string }[];
  item_ids: string[];
  rerun_hash: string;
}

// ── Ablation ─────────────────────────────────────────────────────────────────

export type AblationArm = 'full' | 'location_only' | 'seeds_only' | 'no_qloo' | 'shuffled_qloo';

export interface AblationRow {
  arm: AblationArm;
  label: string;
  available: boolean;
  note: string;
  /** Rows this arm actually returned — the denominator behind the figures. */
  arm_pool: number;
  /** min(k, candidate pool, arm pool): the slice the figures were computed over. */
  k_effective: number | null;
  overlap_at_k: number | null;
  kendall_tau: number | null;
  changed_in_top_k: number | null;
  top_names: string[];
}

export interface AblationResult {
  proposal_id: string;
  pack: string;
  location: string;
  computed_at: string;
  k: number;
  /** Candidates the full arm ranked. Below k, membership overlap is 1.0 by construction. */
  candidate_pool: number;
  source_mode: TasteMode;
  rows: AblationRow[];
}

export interface QuotaState {
  visitor_hour_used: number;
  visitor_day_used: number;
  global_day_used: number;
  monthly_used: number;
  visitor_hour_limit: number;
  visitor_day_limit: number;
  global_day_limit: number;
  monthly_floor: number;
  finals_override: boolean;
  live_allowed: boolean;
  floor_reached: boolean;
}
