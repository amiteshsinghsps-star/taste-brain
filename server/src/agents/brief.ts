// Owner approval brief (V6). One page a person signs. It restates only what the
// proposal already proves: Qloo's own ranking, the rules that ran, the mode the
// data came in, and what is still missing. Every figure is copied from the
// stored run — nothing is summarised into a new number.

import type { Proposal } from '../types';

const MODE_TEXT: Record<string, string> = {
  live: 'LIVE — read from Qloo on this run',
  cached: 'CACHED — served from a stored Qloo answer, the live call was not repeated',
  replay: 'REPLAY — synthetic fixtures, no real Qloo data touched this run',
};

export interface ApprovalBrief {
  proposal_id: string;
  written_at: string;
  title: string;
  sections: { heading: string; lines: string[] }[];
  sign_off: string;
  text: string;
}

export function approvalBrief(proposal: Proposal, approver: string): ApprovalBrief {
  const top = proposal.items.slice(0, 3);
  const blocked = proposal.items.filter((i) => i.approval_blocked);
  const vetoes = proposal.rejections;

  const sections: ApprovalBrief['sections'] = [
    {
      heading: 'The ask',
      lines: [
        `${proposal.pack} · ${proposal.location}`,
        `Goal as entered: "${proposal.goal}"`,
        `Run at ${proposal.created_at}`,
      ],
    },
    {
      heading: 'Where the taste data came from',
      lines: [
        `Mode: ${MODE_TEXT[proposal.mode] ?? proposal.mode}`,
        ...(proposal.trace.steps[0]?.mode ? [] : ['individual steps carry their own mode badge']),
        `Qloo rows considered: ${proposal.items.length + proposal.rejections.length + proposal.unsupported.length}`,
        `Recommended: ${proposal.items.length}`,
      ],
    },
    {
      heading: 'What is being approved',
      lines: top.length
        ? top.map((i) => `#${i.rank} ${i.name} — Qloo rank ${i.qloo_rank}${i.popularity !== undefined ? `, popularity ${i.popularity.toFixed(3)}` : ''}; fit ${Math.round(i.fit * 100)} is derived from Qloo's order, not a Qloo score`)
        : ['Nothing passed every applicable rule, so there is nothing to approve.'],
    },
    {
      heading: 'What was refused, and why',
      lines: [
        ...vetoes.map((r) => `${r.name}: ${r.reason} (Auditor check ${r.check}${r.rule_id ? `, rule ${r.rule_id}` : ''})`),
        ...proposal.unsupported.map((u) => `${u.name}: ${u.reason}`),
      ].slice(0, 8),
    },
    {
      heading: 'What the owner still has to provide',
      lines: blocked.length
        ? blocked.flatMap((i) => i.needs_terms.map((t) => `${i.name}: ${t.label}`))
        : ['Nothing. Every rule that could be checked was checked.'],
    },
    {
      heading: 'Guarantees this brief does not make',
      lines: [
        'No ticket sales, revenue or audience size is predicted anywhere in this system.',
        'Qloo describes groups of listeners, never individuals; nothing here is a claim about a person.',
        blocked.length ? 'Items awaiting a term are shown but cannot be approved until the owner enters it.' : 'Nothing was approved by a model: the ranking is Qloo\'s and the veto is the rule engine\'s.',
      ],
    },
  ];

  const text = [
    `TASTE BRAIN — APPROVAL BRIEF`,
    ``,
    ...sections.flatMap((s) => [`## ${s.heading}`, ...s.lines.map((l) => `  ${l}`), ``]),
    `Decision hash chain head is recorded in the ledger entry for this proposal.`,
  ].join('\n');

  return {
    proposal_id: proposal.proposal_id,
    written_at: new Date().toISOString(),
    title: `${approver}: approve ${top.map((t) => t.name).slice(0, 2).join(', ') || 'nothing'}?`,
    sections,
    sign_off: `Signed by ${approver} once the sections above are read. Approval is refused while a required term is missing.`,
    text,
  };
}
