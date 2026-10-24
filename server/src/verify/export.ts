// Decision export: one self-contained file that carries everything the Verifier
// needs to re-check a decision offline. It is deliberately denormalised — a
// verifier that had to open a database or call an API would verify nothing.
//
// Data rule (PRD §0.4): until Qloo confirms what may be shared, an export can
// only be built from a Replay run, whose fixtures are synthetic. A live run
// would put Qloo-returned names and tags in a file meant for publication, so
// buildDecisionExport refuses it instead of guessing at a redaction.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../graph/store';
import type { LedgerEntry, Proposal, QlooEntityResult, Rule, TasteMode } from '../types';

export const DECISION_EXPORT_SCHEMA = 'taste-brain-decision-export/1';

/** The pinned identity of the rule set a run used. Packs carry no rule version
 *  field, so the content of the rule set itself is the version. */
export function rulesPinnedVersion(rules: Rule[]): string {
  return createHash('sha256').update(canonicalJson(rules)).digest('hex');
}

export interface ExportCandidate {
  entity_id: string;
  name: string;
  qloo_rank: number;
  popularity?: number;
  obscurity?: number;
  followers?: number;
  listeners?: number;
  tag_names: string[];
  qloo_tags: { id: string; name: string; type: string }[];
}

export interface ExportRuleSubject {
  entity_id: string;
  name: string;
  fields: Record<string, number>;
  offer_tags: string[];
}

export interface DecisionExport {
  schema: typeof DECISION_EXPORT_SCHEMA;
  exported_at: string;
  honest_scope: { proves: string[]; does_not_prove: string[] };
  provenance: {
    proposal_id: string;
    pack: string;
    location: string;
    goal: string;
    decision_mode: TasteMode;
  };
  decision: Proposal;
  evidence: { entity_ids: string[]; candidates: ExportCandidate[] };
  rules: { pinned_version: string; rules: Rule[] };
  rule_subjects: ExportRuleSubject[];
  ledger: LedgerEntry[];
  ledger_head_hash: string | null;
}

export function exportHonestScope(mode: TasteMode): DecisionExport['honest_scope'] {
  return {
    proves: [
      'the ledger chain recomputes to the stated head hash, so no record was edited after it was written',
      "every shown item cites a Qloo entity id that exists in this run's stored evidence",
      'the order of the proposal is the order Qloo returned, not a re-sort by this app',
      'each rule verdict re-evaluates to the recorded result under the pinned rule set',
      'live / cached / replay is recorded on every step, and the run badge does not claim more than its steps show',
    ],
    does_not_prove: [
      "that Qloo's own data is correct — this checks integrity and internal consistency, not Qloo's accuracy",
      `that the ${mode} bytes were fetched when the file says they were; timestamps are as recorded by the server that wrote this file`,
      'that a named approver is who they claim to be — the approver is recorded, not authenticated',
    ],
  };
}

function toCandidate(c: QlooEntityResult): ExportCandidate {
  return {
    entity_id: c.entity_id,
    name: c.name,
    qloo_rank: c.qloo_rank,
    popularity: c.popularity,
    obscurity: c.obscurity,
    followers: c.followers,
    listeners: c.listeners,
    tag_names: c.tag_names,
    qloo_tags: c.qloo_tags,
  };
}

/** Replay fixtures are synthetic, so a Replay export is safe to publish.
 *  Override only after Qloo confirms the sharing rule. */
export function exportAllowedForMode(mode: TasteMode, allowLive = false): { ok: boolean; reason: string } {
  if (mode === 'replay') return { ok: true, reason: 'Replay run: the stored rows are committed synthetic fixtures, so an export carries no live Qloo payload.' };
  if (allowLive) return { ok: true, reason: `Live export permitted by explicit override (allowLive=true) — mode ${mode}.` };
  return {
    ok: false,
    reason: `This run is "${mode}", which carries Qloo-returned names and tags. Exports and receipts are limited to Replay (synthetic) data until Qloo confirms what may be shared. Run the same room in Replay to get a shareable file.`,
  };
}

export interface BuildExportInput {
  proposal: Proposal;
  rules: Rule[];
  candidates: QlooEntityResult[];
  rule_subjects: ExportRuleSubject[];
  ledger: LedgerEntry[];
  ledger_head_hash: string | null;
}

export class ExportRefused extends Error {}

export function buildDecisionExport(input: BuildExportInput, allowLive = false): DecisionExport {
  const { proposal, rules, candidates, rule_subjects, ledger, ledger_head_hash } = input;
  const gate = exportAllowedForMode(proposal.mode, allowLive);
  if (!gate.ok) throw new ExportRefused(gate.reason);
  return {
    schema: DECISION_EXPORT_SCHEMA,
    exported_at: new Date().toISOString(),
    honest_scope: exportHonestScope(proposal.mode),
    provenance: {
      proposal_id: proposal.proposal_id,
      pack: proposal.pack,
      location: proposal.location,
      goal: proposal.goal,
      decision_mode: proposal.mode,
    },
    decision: proposal,
    evidence: {
      entity_ids: candidates.map((c) => c.entity_id),
      candidates: candidates.map(toCandidate),
    },
    rules: { pinned_version: rulesPinnedVersion(rules), rules },
    rule_subjects,
    ledger,
    ledger_head_hash,
  };
}
