import crypto from 'crypto';
import { forTenant } from '../graph/graph.client';
import { mergeNode, mergeRelation, runQuery, setVectorProp } from '../graph/graph.queries';
import { ChunkerService } from '../services/ingestion/chunker.service';
import { embedTexts } from '../services/brain/embeddings.service';

/**
 * Northwind Logistics demo seed (FR-8).
 *
 * Seeds one coherent fictional freight-forwarding company into the tenant graph:
 * ≥12 people, 4 teams, 8 documents (SOPs, emails, Slack thread, decision memos),
 * 6 policies, 4 systems, 20+ decisions, 3 agents, watchlist entries.
 * Everything is flagged demoSeed=true / sourceLabel='demo-seed' so the UI can
 * badge it (G5 fix).
 */

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

async function seedPerson(g: any, p: { name: string; email: string; role: string; teamId: string }) {
  const pid = `person_seed_${normalize(p.name)}`;
  await mergeNode(g, 'Person', pid, { name: p.name, email: p.email, role: p.role, teamId: p.teamId, searchKey: `person:${normalize(p.name)}`, demoSeed: 'true' });
  await mergeRelation(g, 'Person', pid, 'Team', p.teamId, 'MEMBER_OF');
  return pid;
}

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
}

export class NorthwindSeeder {
  /** Idempotent: clears any prior Northwind seed in the tenant graph first. */
  static async seed(tenantId: string): Promise<{ seeded: true; counts: Record<string, number> }> {
    const g = await forTenant(tenantId);

    // Teams (4)
    const teams = [
      { id: 'team_seed_ops', name: 'Operations' },
      { id: 'team_seed_compliance', name: 'Compliance' },
      { id: 'team_seed_finance', name: 'Finance' },
      { id: 'team_seed_it', name: 'IT & Systems' },
    ].map((t) => mergeNode(g, 'Team', t.id, { name: t.name, demoSeed: 'true' }).then(() => t));

    await Promise.all(teams);

    // People (13) with roles & teams
    const people = [
      { name: 'Maya Rao', email: 'maya.rao@northwind.example', role: 'Ops Manager', teamId: 'team_seed_ops' },
      { name: 'Rahul Verma', email: 'rahul.verma@northwind.example', role: 'Ops Analyst', teamId: 'team_seed_ops' },
      { name: 'Raj Mehta', email: 'raj.mehta@northwind.example', role: 'Compliance Lead', teamId: 'team_seed_compliance' },
      { name: 'Sara Khan', email: 'sara.khan@northwind.example', role: 'Compliance Analyst', teamId: 'team_seed_compliance' },
      { name: 'Priya Nair', email: 'priya.nair@northwind.example', role: 'Finance Controller', teamId: 'team_seed_finance' },
      { name: 'Dev Patel', email: 'dev.patel@northwind.example', role: 'Accounts Payable', teamId: 'team_seed_finance' },
      { name: 'Anita Desai', email: 'anita.desai@northwind.example', role: 'IT Systems Admin', teamId: 'team_seed_it' },
      { name: 'Ken Watanabe', email: 'ken.watanabe@northwind.example', role: 'Customs Broker', teamId: 'team_seed_ops' },
      { name: 'Lena Fischer', email: 'lena.fischer@northwind.example', role: 'Documentation Specialist', teamId: 'team_seed_ops' },
      { name: 'Tom Okafor', email: 'tom.okafor@northwind.example', role: 'Logistics Coordinator', teamId: 'team_seed_ops' },
      { name: 'Grace Liu', email: 'grace.liu@northwind.example', role: 'Client Success', teamId: 'team_seed_finance' },
      { name: 'Omar Haddad', email: 'omar.haddad@northwind.example', role: 'Warehouse Manager', teamId: 'team_seed_ops' },
      { name: 'Nina Petrov', email: 'nina.petrov@northwind.example', role: 'Trading Compliance Officer', teamId: 'team_seed_compliance' },
    ];
    for (const p of people) await seedPerson(g, p);

    // Systems (4)
    const systems = [
      { id: 'system_seed_customs', name: 'Customs Declaration', kind: 'CUSTOMS' },
      { id: 'system_seed_erp', name: 'ERP', kind: 'ERP' },
      { id: 'system_seed_tms', name: 'Transport Management System', kind: 'TMS' },
      { id: 'system_seed_invoice', name: 'Invoice Generation', kind: 'FINANCE' },
    ];
    for (const s of systems) {
      await mergeNode(g, 'System', s.id, { name: s.name, kind: s.kind, demoSeed: 'true' });
    }
    await mergeNode(g, 'System', 'system_seed_erp', { name: 'ERP', kind: 'ERP', demoSeed: 'true', searchKey: 'system:erp' });

    // Documents (8) — SOPs, emails, Slack thread, decision memos
    const documents: Array<{ title: string; sourceType: string; content: string; author: string }> = [
      {
        title: 'Denied-Party SOP v3',
        sourceType: 'GDRIVE',
        author: 'Raj Mehta',
        content:
          'Northwind Logistics — Standard Operating Procedure: Denied-Party Screening (v3). ' +
          'Raj Mehta (Compliance) is the policy owner for denied-party screening. ' +
          'Section 1. Every container booking must be screened against the company denied-party watchlist before confirmation. ' +
          'Section 2. If a shipper, consignee or notify party matches an entry on the watchlist, the shipment must be flagged CRITICAL and escalated to the Compliance Lead before any further processing. ' +
          'Section 3. Shipments flagged for denied-party reasons must never auto-approve; the Freight Desk agent must stage the booking in Copilot mode for human review. ' +
          'Section 4. This policy governs the Customs Declaration system and the Freight Desk agent workflows. ' +
          'Section 5. Watchlist data is a demo list maintained by Compliance; it is not a live sanctions feed.',
      },
      {
        title: 'HS Code Verification SOP',
        sourceType: 'GDRIVE',
        author: 'Ken Watanabe',
        content:
          'Northwind Logistics — Standard Operating Procedure: HS Tariff Code Verification. ' +
          'Ken Watanabe (Customs Broker, Operations) is the owner of HS code validation. ' +
          'Rule: every export or import manifest must declare a Harmonized System (HS) code of at least 6 digits before customs declaration submission. ' +
          'The Customs Declaration system must reject manifests missing or failing the HS code format check and ask the documentation specialist for correction. ' +
          'Deviations require approval by the Ops Manager before manifest submission.',
      },
      {
        title: 'Client Credit Check SOP',
        sourceType: 'GDRIVE',
        author: 'Priya Nair',
        content:
          'Northwind Finance — Client Credit Approval SOP. ' +
          'Priya Nair (Finance Controller) is the owner of credit-limit approval. ' +
          'Rule: invoices up to 10,000 USD may be auto-approved by the Finance agent for clients with ACTIVE credit accounts. ' +
          'Invoices over 10,000 USD require Accounts (ADMIN role) approval; the Finance agent must stage them for approval and never auto-send. ' +
          'This policy governs the Invoice Generation system and the Finance agent.',
      },
      {
        title: 'Email: Customs delay guidance from Compliance',
        sourceType: 'GMAIL',
        author: 'Sara Khan',
        content:
          'From: sara.khan@northwind.example — "Reminder for the ops desk: any customs clearance delay longer than 48 hours at Hamburg Port must be escalated with a demurrage risk note. Always attach the HS code verification results before escalating. Denied Trading LLC and similar restricted entities remain blocked under the denied-party policy."',
      },
      {
        title: 'Slack: #ops-freight booking escalation thread',
        sourceType: 'SLACK',
        author: 'Tom Okafor',
        content:
          'Slack thread #ops-freight — Tom Okafor: "Booking BK-1042, shipper Denied Trading LLC, flagged by the screening agent last night." Maya Rao: "Good catch — that consignment stays frozen. Compliance owns the follow-up." Sara Khan: "Yes, watching this. It triggered the denied-party rule. Keeping the decision log updated for the audit file."',
      },
      {
        title: 'Decision memo: freeze all BK-1042 movements',
        sourceType: 'FOLDER',
        author: 'Maya Rao',
        content:
          'Decision memo — Maya Rao (Ops Manager): All movements for booking BK-1042 are frozen following a denied-party screening flag against the shipper. Source of authority: Denied-Party SOP v3, Section 2. This decision supersedes the earlier memorandum that provisionally released the booking pending re-check.',
      },
      {
        title: 'Decision memo: HS code data quality initiative',
        sourceType: 'FOLDER',
        author: 'Ken Watanabe',
        content:
          'Decision memo — Ken Watanabe: The Customs Declaration system will now require 6-digit HS codes at manifest submission time (was 4-digit). Older manifests with 4-digit codes are grandfathered but flagged for update. Rationale: fewer port rejections at Hamburg.',
      },
      {
        title: 'Email: invoice approval escalation for ACME Corp',
        sourceType: 'GMAIL',
        author: 'Dev Patel',
        content:
          'From: dev.patel@northwind.example — "Heads up: ACME Corp invoice INV-2231 for 24,500 USD exceeds the 10,000 USD auto-approval credit limit set in the Client Credit Check SOP. Staged for Finance Controller approval. Priya Nair is the approving officer."',
      },
    ];

    // Policies (6) — versioned, owned, governing systems
    const policies = [
      { name: 'Denied-Party Screening', owner: 'Raj Mehta', version: 3, category: 'COMPLIANCE', docTitle: 'Denied-Party SOP v3' },
      { name: 'HS Code Verification', owner: 'Ken Watanabe', version: 2, category: 'FREIGHT', docTitle: 'HS Code Verification SOP' },
      { name: 'Credit Limit Approval', owner: 'Priya Nair', version: 2, category: 'FINANCE', docTitle: 'Client Credit Check SOP' },
      { name: 'Customs Delay Escalation', owner: 'Maya Rao', version: 1, category: 'FREIGHT', docTitle: 'Email: Customs delay guidance from Compliance' },
      { name: 'Booking Documentation Standard', owner: 'Lena Fischer', version: 1, category: 'FREIGHT', docTitle: 'HS Code Verification SOP' },
      { name: 'Demurrage Risk Assessment', owner: 'Tom Okafor', version: 1, category: 'FREIGHT', docTitle: 'Slack: #ops-freight booking escalation thread' },
    ];

    // Agents (3)
    const agents = [
      { id: 'agent_seed_freight', name: 'Freight Desk Agent', type: 'FREIGHT_AGENT', mode: 'COPILOT' },
      { id: 'agent_seed_email', name: 'Email Triage Agent', type: 'EMAIL_AGENT', mode: 'COPILOT' },
      { id: 'agent_seed_finance', name: 'Finance Approval Agent', type: 'FINANCE_AGENT', mode: 'AUTOPILOT' },
    ];
    for (const a of agents) {
      await mergeNode(g, 'Agent', a.id, { name: a.name, type: a.type, mode: a.mode, status: 'RUNNING', demoSeed: 'true' });
    }

    // Watchlist entries (demo denied-party list, clearly labeled)
    const watchlist = [
      { name: 'Denied Trading LLC', note: 'Demo watchlist entry — restricted shipper' },
      { name: 'Acme Banned Corp', note: 'Demo watchlist entry — banned consignee' },
      { name: 'Blacklisted Forwarder', note: 'Demo watchlist entry — blacklisted freight forwarder' },
    ];
    for (const w of watchlist) {
      await mergeNode(g, 'WatchlistEntry', `watch_seed_${normalize(w.name)}`, { name: w.name, list: 'northwind-demo-denied-party', note: w.note, demoSeed: 'true' });
    }

    // Ingest documents into the graph (hash-based idempotency keeps re-seeding safe)
    const counts: Record<string, number> = { documents: 0, chunks: 0, policies: 0, decisions: 0, tasks: 0 };
    const docChunkIds: Record<string, string[]> = {};

    for (const doc of documents) {
      const documentId = `doc_seed_${normalize(doc.title)}`;
      const hash = crypto.createHash('sha256').update(doc.content).digest('hex');
      await mergeNode(g, 'Document', documentId, {
        title: doc.title,
        sourceType: doc.sourceType,
        sourceUrl: '',
        version: 1,
        hash,
        status: 'ACTIVE',
        validFrom: new Date().toISOString(),
        validTo: '',
        createdAt: new Date().toISOString(),
        demoSeed: 'true',
      });
      counts.documents++;

      const authorId = `person_seed_${normalize(doc.author)}`;
      await mergeRelation(g, 'Person', authorId, 'Document', documentId, 'AUTHORED');

      const chunks = ChunkerService.chunkText(doc.content);
      const { vectors } = await embedTexts(chunks);
      docChunkIds[doc.title] = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = `${documentId}_c${i}`;
        await mergeNode(g, 'Chunk', chunkId, { text: chunks[i], idx: i, documentId, demoSeed: 'true' });
        await setVectorProp(g, 'Chunk', chunkId, 'embedding', vectors[i]);
        await mergeRelation(g, 'Chunk', chunkId, 'Document', documentId, 'PART_OF');
        counts.chunks++;
        docChunkIds[doc.title].push(chunkId);
      }
    }

    // Policy nodes with ownership + governing edges + provenance from source docs
    const policyIds: Record<string, string> = {};
    for (const p of policies) {
      const policyId = `policy_seed_${normalize(p.name)}`;
      policyIds[p.name] = policyId;
      await mergeNode(g, 'Policy', policyId, {
        name: p.name,
        policyName: p.name,
        category: p.category,
        version: p.version,
        status: 'ACTIVE',
        validFrom: new Date().toISOString(),
        validTo: '',
        demoSeed: 'true',
      });
      counts.policies++;
      const ownerId = `person_seed_${normalize(p.owner)}`;
      await mergeRelation(g, 'Person', ownerId, 'Policy', policyId, 'OWNS');

      const docId = `doc_seed_${normalize(p.docTitle)}`;
      const chunkIds = docChunkIds[p.docTitle] || [];
      for (const c of chunkIds.slice(0, 2)) {
        await mergeRelation(g, 'Policy', policyId, 'Chunk', c, 'DERIVED_FROM');
      }
      if (p.name === 'Denied-Party Screening') {
        await mergeRelation(g, 'Policy', policyId, 'System', 'system_seed_customs', 'GOVERNS');
        await mergeRelation(g, 'Policy', policyId, 'Agent', 'agent_seed_freight', 'GOVERNS');
      } else if (p.name === 'HS Code Verification') {
        await mergeRelation(g, 'Policy', policyId, 'System', 'system_seed_customs', 'GOVERNS');
      } else if (p.name === 'Credit Limit Approval') {
        await mergeRelation(g, 'Policy', policyId, 'System', 'system_seed_invoice', 'GOVERNS');
        await mergeRelation(g, 'Policy', policyId, 'Agent', 'agent_seed_finance', 'GOVERNS');
      } else if (p.name === 'Customs Delay Escalation') {
        await mergeRelation(g, 'Policy', policyId, 'System', 'system_seed_tms', 'GOVERNS');
      } else if (p.name === 'Demurrage Risk Assessment') {
        await mergeRelation(g, 'Policy', policyId, 'Agent', 'agent_seed_freight', 'GOVERNS');
      }
    }

    // Executable rules implementing the policies (these are what the engine runs)
    const rules = [
      {
        name: 'Freight Denied-Party Screening',
        policy: 'Denied-Party Screening',
        actionType: 'DENIED_PARTY_SCREENING',
        severity: 'CRITICAL',
        params: { requireApprovalIfFlagged: true },
        docTitle: 'Denied-Party SOP v3',
      },
      {
        name: 'Customs HS Code Verification',
        policy: 'HS Code Verification',
        actionType: 'HS_CODE_VALIDATION',
        severity: 'HIGH',
        params: { minDigitLength: 6 },
        docTitle: 'HS Code Verification SOP',
      },
      {
        name: 'Automated Invoice Credit Approval',
        policy: 'Credit Limit Approval',
        actionType: 'CREDIT_LIMIT_APPROVAL',
        severity: 'HIGH',
        params: { maxCreditLimit: 10000, approvalRole: 'ADMIN' },
        docTitle: 'Client Credit Check SOP',
      },
    ];
    const ruleIds: Record<string, string> = {};
    for (const r of rules) {
      const ruleId = `rule_seed_${normalize(r.name)}`;
      ruleIds[r.name] = ruleId;
      await mergeNode(g, 'Rule', ruleId, {
        ruleName: r.name,
        actionType: r.actionType,
        triggerCondition: 'On freight booking / financial event',
        severity: r.severity,
        parametersJSON: JSON.stringify(r.params),
        version: 1,
        isExecutable: 'true',
        status: 'ACTIVE',
        demoSeed: 'true',
      });
      await mergeRelation(g, 'Rule', ruleId, 'Policy', policyIds[r.policy], 'IMPLEMENTS');
      const chunks = docChunkIds[r.docTitle] || [];
      for (const c of chunks.slice(0, 1)) {
        await mergeRelation(g, 'Rule', ruleId, 'Chunk', c, 'DERIVED_FROM');
      }
    }

    // KNOWS_ABOUT derived expertise (weight) for people on systems/policies
    const expertise: Array<[string, string, number]> = [
      ['Raj Mehta', 'system_seed_customs', 5],
      ['Raj Mehta', 'policy_seed_denied_party_screening', 9],
      ['Ken Watanabe', 'system_seed_customs', 7],
      ['Ken Watanabe', 'policy_seed_hs_code_verification', 8],
      ['Priya Nair', 'system_seed_invoice', 6],
      ['Priya Nair', 'policy_seed_credit_limit_approval', 9],
      ['Maya Rao', 'system_seed_tms', 6],
      ['Anita Desai', 'system_seed_erp', 8],
      ['Sara Khan', 'policy_seed_denied_party_screening', 4],
      ['Lena Fischer', 'policy_seed_booking_documentation_standard', 7],
    ];
    for (const [person, target, weight] of expertise) {
      await mergeRelation(g, 'Person', `person_seed_${normalize(person)}`, target.startsWith('policy') ? 'Policy' : 'System', target, 'KNOWS_ABOUT', { weight });
    }

    // Shipment + customers for the freight desk demo story
    await mergeNode(g, 'Shipment', 'shipment_seed_bk_1042', { bookingNumber: 'BK-1042', status: 'FROZEN', demoSeed: 'true' });
    await mergeNode(g, 'Customer', 'customer_seed_acme', { name: 'ACME Corp', creditStatus: 'ACTIVE', demoSeed: 'true' });
    await mergeNode(g, 'Invoice', 'invoice_seed_inv_2231', { invoiceNumber: 'INV-2231', amount: 24500, currency: 'USD', demoSeed: 'true' });
    await mergeRelation(g, 'Invoice', 'invoice_seed_inv_2231', 'Customer', 'customer_seed_acme', 'ABOUT');
    await mergeRelation(g, 'Shipment', 'shipment_seed_bk_1042', 'WatchlistEntry', 'watch_seed_denied_trading_llc', 'FLAGGED_BY');
    await mergeRelation(g, 'Shipment', 'shipment_seed_bk_1042', 'Rule', 'rule_seed_freight_denied_party_screening', 'TRIGGERED');
    await mergeRelation(g, 'Agent', 'agent_seed_freight', 'Shipment', 'shipment_seed_bk_1042', 'PERFORMED');

    // 20+ Decision nodes across the company history
    const decisionTemplates: Array<{ person: string; summary: string; outcome: string; policy?: string; docTitle?: string }> = [
      { person: 'Maya Rao', summary: 'Freeze all BK-1042 movements after denied-party flag', outcome: 'FROZEN', policy: 'Denied-Party Screening', docTitle: 'Decision memo: freeze all BK-1042 movements' },
      { person: 'Raj Mehta', summary: 'Upgrade denied-party SOP to v3', outcome: 'APPROVED', policy: 'Denied-Party Screening', docTitle: 'Denied-Party SOP v3' },
      { person: 'Ken Watanabe', summary: 'Require 6-digit HS codes on all manifests', outcome: 'APPROVED', policy: 'HS Code Verification', docTitle: 'Decision memo: HS code data quality initiative' },
      { person: 'Priya Nair', summary: 'Hold INV-2231 for manual credit approval (over 10k USD limit)', outcome: 'HOLD', policy: 'Credit Limit Approval', docTitle: 'Email: invoice approval escalation for ACME Corp' },
      { person: 'Sara Khan', summary: 'Escalate 72h customs delay at Hamburg with demurrage note', outcome: 'ESCALATED', policy: 'Customs Delay Escalation', docTitle: 'Email: Customs delay guidance from Compliance' },
      { person: 'Raj Mehta', summary: 'Publish demo watchlist to freight screening engine', outcome: 'APPROVED', policy: 'Denied-Party Screening' },
      { person: 'Maya Rao', summary: 'Approve container reassignment for BKG-2026-771', outcome: 'APPROVED', policy: 'Booking Documentation Standard' },
      { person: 'Tom Okafor', summary: 'Flag BK-1042 for compliance review', outcome: 'FLAGGED', policy: 'Demurrage Risk Assessment', docTitle: 'Slack: #ops-freight booking escalation thread' },
      { person: 'Priya Nair', summary: 'Set default credit auto-approval limit 10,000 USD', outcome: 'APPROVED', policy: 'Credit Limit Approval' },
      { person: 'Grace Liu', summary: 'Approve ACME Corp onboarding with ACTIVE credit status', outcome: 'APPROVED', policy: 'Credit Limit Approval' },
      { person: 'Raj Mehta', summary: 'Reject booking for Denied Trading LLC (screening hit)', outcome: 'REJECTED', policy: 'Denied-Party Screening' },
      { person: 'Maya Rao', summary: 'Exception approval BK-0901 delayed documentation', outcome: 'APPROVED', policy: 'Booking Documentation Standard' },
      { person: 'Lena Fischer', summary: 'Standardize manifest doc template for Hamburg', outcome: 'APPROVED', policy: 'Booking Documentation Standard' },
      { person: 'Dev Patel', summary: 'Escalate three overdue client invoices to Finance Controller', outcome: 'ESCALATED', policy: 'Credit Limit Approval' },
      { person: 'Anita Desai', summary: 'Approve ERP connector for document ingestion', outcome: 'APPROVED' },
      { person: 'Omar Haddad', summary: 'Route priority container 40HC for Kashgar haulage', outcome: 'APPROVED' },
      { person: 'Tom Okafor', summary: 'Escalate demurrage risk to ops standup', outcome: 'ESCALATED', policy: 'Demurrage Risk Assessment' },
      { person: 'Nina Petrov', summary: 'Add second-line review for restricted parties near-miss matches', outcome: 'APPROVED', policy: 'Denied-Party Screening' },
      { person: 'Priya Nair', summary: 'Approve September AR receivables write-down', outcome: 'APPROVED' },
      { person: 'Maya Rao', summary: 'Authorize overtime ops staff for week 42', outcome: 'APPROVED' },
      { person: 'Raj Mehta', summary: 'Approve audit trail retention 12 months', outcome: 'APPROVED' },
      { person: 'Ken Watanabe', summary: 'Retire legacy 4-digit HS manifest forms', outcome: 'APPROVED', policy: 'HS Code Verification' },
    ];
    for (const d of decisionTemplates) {
      const decisionId = id('decision_seed');
      await mergeNode(g, 'Decision', decisionId, {
        summary: d.summary,
        outcome: d.outcome,
        at: new Date(Date.now() - Math.floor(Math.random() * 30) * 86400000).toISOString(),
        mode: 'COPILOT',
        demoSeed: 'true',
      });
      await mergeRelation(g, 'Person', `person_seed_${normalize(d.person)}`, 'Decision', decisionId, 'DECIDED');
      if (d.policy) {
        await mergeRelation(g, 'Decision', decisionId, 'Policy', policyIds[d.policy], 'ABOUT');
      }
      if (d.docTitle) {
        const chunks = docChunkIds[d.docTitle] || [];
        if (chunks.length) {
          await mergeRelation(g, 'Decision', decisionId, 'Chunk', chunks[0], 'DERIVED_FROM');
        }
      }
      counts.decisions++;
    }

    // Handoff chain demo story: Email agent triaged BK-1042 inquiry → handed to Freight agent
    await mergeNode(g, 'Task', 'task_seed_bk1042_screening', {
      kind: 'DENIED_PARTY_SCREENING',
      status: 'FLAGGED',
      createdAt: new Date().toISOString(),
      summary: 'Screening task for booking BK-1042 (shipper Denied Trading LLC)',
      demoSeed: 'true',
    });
    await mergeRelation(g, 'Task', 'task_seed_bk1042_screening', 'Rule', ruleIds['Freight Denied-Party Screening'], 'TRIGGERED');
    await mergeRelation(g, 'Task', 'task_seed_bk1042_screening', 'Agent', 'agent_seed_email', 'HANDED_OFF_TO');
    await mergeRelation(g, 'Agent', 'agent_seed_freight', 'Task', 'task_seed_bk1042_screening', 'PERFORMED');
    counts.tasks++;

    // Memory: one sanctioned episode so recall is demoable out of the box (Track 02)
    await mergeNode(g, 'Episode', 'episode_seed_bk1042', {
      summary: 'Yesterday: Freight agent flagged booking BK-1042 (shipper Denied Trading LLC) under Denied-Party Screening v3; Maya Rao froze the shipment pending compliance review.',
      outcome: 'FROZEN',
      at: new Date(Date.now() - 86400000).toISOString(),
      scope: 'tenant',
      demoSeed: 'true',
    });
    await mergeRelation(g, 'Agent', 'agent_seed_freight', 'Episode', 'episode_seed_bk1042', 'REMEMBERS');
    await mergeRelation(g, 'Episode', 'episode_seed_bk1042', 'Shipment', 'shipment_seed_bk_1042', 'ABOUT');
    await mergeNode(g, 'Fact', 'fact_seed_acme_hs', {
      statement: 'Customer ACME Corp consistently ships under HS 8471 and stays under the 10,000 USD credit auto-approval limit.',
      confidence: '0.9',
      at: new Date().toISOString(),
      scope: 'tenant',
      demoSeed: 'true',
    });
    await mergeRelation(g, 'Agent', 'agent_seed_finance', 'Fact', 'fact_seed_acme_hs', 'REMEMBERS');
    await mergeNode(g, 'ConversationNode', 'conversation_seed_ops', { scope: 'tenant', createdAt: new Date().toISOString(), demoSeed: 'true' });
    await mergeNode(g, 'Turn', 'turn_seed_1', { role: 'agent', text: 'Freight Desk Agent logged the BK-1042 screening flag and handed follow-up to compliance.', at: new Date(Date.now() - 86400000).toISOString(), scope: 'tenant', demoSeed: 'true' });
    await mergeRelation(g, 'ConversationNode', 'conversation_seed_ops', 'Turn', 'turn_seed_1', 'HAS_TURN');

    return { seeded: true as const, counts };
  }
}
