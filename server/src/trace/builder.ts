import { createHash } from 'node:crypto';
import type { DecisionTrace, ModeMix, TraceStep } from '../types';

// A live run can contain cached answers, so the badge alone understates where each
// step came from. Counting them lets the UI disclose the mix rather than imply that
// every byte arrived on this run.
export function modeMix(steps: TraceStep[]): ModeMix {
  const mix: ModeMix = { live: 0, cached: 0, replay: 0 };
  for (const s of steps) if (s.mode) mix[s.mode] += 1;
  return mix;
}

// Rerun hash over the decision-relevant content (PRD F3: re-running the export
// against stored Qloo results must reproduce the same ranking).
//
// Version 1 keyed each step on `id ?? label`, so a step that had an entity id
// contributed no name: renaming an item inside an export re-hashed to the same
// value and passed. Version 2 carries the id and the label as separate fields,
// which puts the displayed name, the rank and the verdict all inside the hash.
// Both versions are still verifiable because the version is recorded in the
// hash-protected ledger detail — a run written under one rule keeps verifying
// under it, and nothing stored so far has to be re-signed.
export type RerunHashVersion = 1 | 2;
export const CURRENT_RERUN_HASH_VERSION: RerunHashVersion = 2;

export function rerunHash(steps: TraceStep[], version: RerunHashVersion = CURRENT_RERUN_HASH_VERSION): string {
  const canonical = steps
    .filter((s) => ['QlooEntity', 'Rule', 'Offer', 'Filter'].includes(s.type))
    .map((s) => version === 1
      ? `${s.type}:${s.id ?? s.label}:${s.result ?? ''}:${s.score ?? ''}`
      // One JSON array per step: field boundaries cannot be shifted by putting a
      // separator character into a name, which a joined string would allow.
      : JSON.stringify([s.type, s.id ?? '', s.label, s.result ?? '', s.score ?? '']))
    .join(version === 1 ? '|' : ',');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function buildTrace(input: {
  proposal_id: string; pack: string; location: string; goal: string; mode: DecisionTrace['mode']; steps: TraceStep[];
}): DecisionTrace {
  return {
    ...input,
    rerun_hash: rerunHash(input.steps, CURRENT_RERUN_HASH_VERSION),
    rerun_hash_version: CURRENT_RERUN_HASH_VERSION,
    mode_mix: modeMix(input.steps),
  };
}

export function exportTrace(trace: DecisionTrace): string {
  return JSON.stringify(trace, null, 2);
}

// Recomputed on every read so the mix always matches the steps the operator is
// looking at — Decision and Ledger steps are appended after the trace is built, and
// runs stored before the field existed have none.
export function withModeMix(trace: DecisionTrace): DecisionTrace {
  return { ...trace, mode_mix: modeMix(trace.steps) };
}

export function stampProposal<T extends { trace: DecisionTrace }>(proposal: T): T {
  return { ...proposal, trace: withModeMix(proposal.trace) };
}
