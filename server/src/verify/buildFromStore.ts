// Assembles a DecisionExport from the running server's store. This is the only
// part of the verify path that touches the database; the Verifier itself never
// does, which is what lets the same checks run in a browser or a CLI.

import { graph, verifyLedger } from '../graph/store';
import { buildDecisionExport, type DecisionExport, type ExportRuleSubject } from './export';
import type { Proposal } from '../types';

export class ExportSourceError extends Error {}

/** Ledger entries up to and including this proposal's last write. The chain is
 *  contiguous, so a slice that stops mid-chain would fail verification for the
 *  wrong reason. */
function ledgerForProposal(proposalId: string) {
  const all = graph.readLedger(500);
  const own = all.filter((e) => e.proposal_id === proposalId);
  if (!own.length) return { entries: [], missing: true };
  const maxSeq = Math.max(...own.map((e) => e.seq));
  return { entries: all.filter((e) => e.seq <= maxSeq), missing: false };
}

export function exportFromStore(proposalId: string, allowLive = false): DecisionExport {
  const proposal = graph.getProposal<Proposal>(proposalId);
  if (!proposal) throw new ExportSourceError(`no stored proposal with id ${proposalId}`);

  const snapshot = graph.getSnapshot(proposalId);
  if (!snapshot) {
    throw new ExportSourceError(`this run stored no snapshot, so its evidence set and rule set cannot be exported. proposal ${proposalId}`);
  }
  if (!snapshot.candidates.length) {
    throw new ExportSourceError('the snapshot for this run holds no Qloo candidate rows, so there is no evidence set to verify against');
  }

  const { entries, missing } = ledgerForProposal(proposalId);
  if (missing) throw new ExportSourceError(`the ledger holds no entry for ${proposalId}; a decision that was never written cannot be attested`);

  const ruleSubjects: ExportRuleSubject[] = proposal.items.map((it) => ({
    entity_id: it.entity_id,
    name: it.name,
    fields: it.rule_inputs?.fields ?? {},
    offer_tags: it.rule_inputs?.offer_tags ?? [],
  }));

  const head = verifyLedger(entries).head_hash;
  return buildDecisionExport({
    proposal,
    rules: snapshot.rules,
    candidates: snapshot.candidates,
    rule_subjects: ruleSubjects,
    ledger: entries,
    ledger_head_hash: head,
  }, allowLive);
}
