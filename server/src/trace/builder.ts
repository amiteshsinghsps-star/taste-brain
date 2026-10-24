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
export function rerunHash(steps: TraceStep[]): string {
  const canonical = steps
    .filter((s) => ['QlooEntity', 'Rule', 'Offer', 'Filter'].includes(s.type))
    .map((s) => `${s.type}:${s.id ?? s.label}:${s.result ?? ''}:${s.score ?? ''}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function buildTrace(input: {
  proposal_id: string; pack: string; location: string; goal: string; mode: DecisionTrace['mode']; steps: TraceStep[];
}): DecisionTrace {
  return { ...input, rerun_hash: rerunHash(input.steps), mode_mix: modeMix(input.steps) };
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
