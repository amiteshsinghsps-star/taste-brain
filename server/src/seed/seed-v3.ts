import crypto from 'crypto';
import { forTenant } from '../graph/graph.client';
import { mergeNode, mergeRelation, runQuery, setVectorProp } from '../graph/graph.queries';
import { ChunkerService } from '../services/ingestion/chunker.service';
import { embedTexts } from '../services/brain/embeddings.service';
import { loadRulesFromGraph, loadFactsFromGraph, evaluate } from '../services/brain/rule-engine.service';

/**
 * Seed v3 (PRD v3 §Appendix A) — demo history for the Policy Time Machine:
 *
 *  • Customers (ACME, Globex, Initech, Umbrella)
 *  • 30 Bookings over the last 30 days whose recordedVerdict is COMPUTED by the
 *    pure rule engine over the seeded graph rules — replay fidelity is 30/30 by
 *    construction. Designed so lowering the credit threshold 10,000 → 5,000
 *    flips exactly the 5 bookings priced in [5,000, 10,000]:
 *    BK-1011 (ACME 7,200), BK-1017 (ACME 9,800), BK-1023 (Globex 6,400),
 *    BK-1029 (Initech 5,500), BK-1043 (Globex 10,000 boundary).
 *  • A superseded Client Credit Check SOP v1 + superseded rule v1, so
 *    temporal questions ("what did it replace?") have real history.
 *  • 12 invoices for the finance desk.
 *  • Planted health issues for the Knowledge Health report: an orphan policy,
 *    a stale legacy rule, and one document not refreshed in >90 days.
 */

function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
}

const DAY = 24 * 3600 * 1000;

interface BookingSpec {
  no: string;
  customer: string;
  shipper: string;
  consignee: string;
  amount: number;
  origin: string;
  destination: string;
  daysAgo: number;
}

/** 30 bookings: 18 below 5k, 5 in (5k..10k], 5 above 10k (incl. boundary 10k), 2 denied-party hits. */
function bookingSpecs(): BookingSpec[] {
  const specs: BookingSpec[] = [];
  const cleanShippers = ['Fastlane Export Co', 'Baltic Trade GmbH', 'Pacific Rim Shipping', 'Nordwind Spedition', 'Alpine Logistics SA'];
  let seq = 0;
  const push = (b: Partial<BookingSpec> & { no: string; customer: string; amount: number }) => {
    const i = seq++ % cleanShippers.length;
    specs.push({
      no: b.no,
      customer: b.customer,
      shipper: b.shipper ?? cleanShippers[i],
      consignee: b.consignee ?? cleanShippers[(i + 1) % cleanShippers.length],
      amount: b.amount,
      origin: b.origin ?? 'CNSHA',
      destination: b.destination ?? 'DEHAM',
      daysAgo: b.daysAgo ?? (seq % 29),
    });
  };

  // 18 clean bookings under 5,000 (BK-2001..BK-2018)
  const under5k = [
    ['ACME Corp', 1200], ['Globex', 2100], ['Initech', 3400], ['Umbrella Corp', 900], ['ACME Corp', 4500],
    ['Globex', 2800], ['Initech', 1500], ['Umbrella Corp', 3900], ['ACME Corp', 2200], ['Globex', 4100],
    ['Initech', 800], ['Umbrella Corp', 3300], ['ACME Corp', 2700], ['Globex', 1900], ['Initech', 4600],
    ['Umbrella Corp', 2400], ['ACME Corp', 3100], ['Globex', 1400],
  ] as Array<[string, number]>;
  under5k.forEach(([customer, amount], i) => push({ no: `BK-20${(i + 1).toString().padStart(2, '0')}`, customer, amount }));

  // 5 bookings in (5,000 .. 10,000] — these flip when the threshold drops to 5,000
  push({ no: 'BK-1011', customer: 'ACME Corp', amount: 7200 });
  push({ no: 'BK-1017', customer: 'ACME Corp', amount: 9800 });
  push({ no: 'BK-1023', customer: 'Globex', amount: 6400 });
  push({ no: 'BK-1029', customer: 'Initech', amount: 5500 });
  push({ no: 'BK-1043', customer: 'Globex', amount: 10000 }); // boundary: `>` threshold → PASSED at 10k

  // 5 bookings above 10,000 — REQUIRES_APPROVAL under both thresholds (BK-3001..BK-3005)
  const over10k = [
    ['ACME Corp', 12400], ['Globex', 18500], ['Initech', 24000], ['Umbrella Corp', 11200], ['ACME Corp', 15800],
  ] as Array<[string, number]>;
  over10k.forEach(([customer, amount], i) => push({ no: `BK-30${(i + 1).toString().padStart(2, '0')}`, customer, amount }));

  // 2 denied-party hits — FLAGGED under both thresholds
  push({ no: 'BK-1007', customer: 'Umbrella Corp', amount: 6600, shipper: 'Denied Trading LLC' });
  push({ no: 'BK-1019', customer: 'Globex', amount: 14700, consignee: 'Blacklisted Forwarder' });

  return specs;
}

export class SeedV3 {
  static async seed(tenantId: string): Promise<{ counts: Record<string, number> }> {
    const g = await forTenant(tenantId);

    // ---- Superseded credit history (temporal questions) ----
    const v1Content =
      'Northwind Finance — Client Credit Approval SOP (v1, SUPERSEDED). ' +
      'Priya Nair (Finance Controller) owned this early policy. ' +
      'Rule: invoices up to 5,000 USD could be auto-approved by the Finance agent for clients with ACTIVE credit accounts. ' +
      'Invoices over 5,000 USD required manual approval. ' +
      'This version was retired when the limit was raised to 10,000 USD.';
    const v1DocId = 'doc_seed_client_credit_check_sop_v1';
    const v1Hash = crypto.createHash('sha256').update(v1Content).digest('hex');
    await mergeNode(g, 'Document', v1DocId, {
      title: 'Client Credit Check SOP v1',
      sourceType: 'GDRIVE',
      sourceUrl: '',
      version: 1,
      hash: v1Hash,
      status: 'SUPERSEDED',
      validFrom: new Date(Date.now() - 200 * DAY).toISOString(),
      validTo: new Date(Date.now() - 90 * DAY).toISOString(),
      createdAt: new Date(Date.now() - 200 * DAY).toISOString(),
      demoSeed: 'true',
    });
    const v1Chunks = ChunkerService.chunkText(v1Content);
    const { vectors } = await embedTexts(v1Chunks);
    for (let i = 0; i < v1Chunks.length; i++) {
      await mergeNode(g, 'Chunk', `${v1DocId}_c${i}`, { text: v1Chunks[i], idx: i, documentId: v1DocId, demoSeed: 'true' });
      await setVectorProp(g, 'Chunk', `${v1DocId}_c${i}`, 'embedding', vectors[i]);
      await mergeRelation(g, 'Chunk', `${v1DocId}_c${i}`, 'Document', v1DocId, 'PART_OF');
    }
    // Current doc supersedes v1
    await mergeRelation(g, 'Document', 'doc_seed_client_credit_check_sop', 'Document', v1DocId, 'SUPERSEDES');
    // Superseded rule version v1 (threshold 5,000) kept for history
    await mergeNode(g, 'Rule', 'rule_seed_automated_invoice_credit_approval_v1', {
      ruleName: 'Automated Invoice Credit Approval',
      actionType: 'CREDIT_LIMIT_APPROVAL',
      triggerCondition: 'On invoice creation request',
      severity: 'HIGH',
      parametersJSON: JSON.stringify({ maxCreditLimit: 5000, approvalRole: 'ADMIN' }),
      version: 1,
      isExecutable: 'true',
      status: 'SUPERSEDED',
      demoSeed: 'true',
    });
    await mergeRelation(g, 'Rule', 'rule_seed_automated_invoice_credit_approval', 'Rule', 'rule_seed_automated_invoice_credit_approval_v1', 'SUPERSEDES');
    await mergeRelation(g, 'Rule', 'rule_seed_automated_invoice_credit_approval_v1', 'Policy', 'policy_seed_credit_limit_approval', 'IMPLEMENTS');
    await mergeRelation(g, 'Rule', 'rule_seed_automated_invoice_credit_approval_v1', 'Chunk', `${v1DocId}_c0`, 'DERIVED_FROM');

    // ---- Customers ----
    const customers = [
      { id: 'customer_seed_acme', name: 'ACME Corp' },
      { id: 'customer_seed_globex', name: 'Globex' },
      { id: 'customer_seed_initech', name: 'Initech' },
      { id: 'customer_seed_umbrella', name: 'Umbrella Corp' },
    ];
    for (const c of customers) {
      await mergeNode(g, 'Customer', c.id, { name: c.name, creditStatus: 'ACTIVE', demoSeed: 'true' });
    }

    // ---- Bookings: recorded verdicts computed by the pure engine ----
    const rules = await loadRulesFromGraph(tenantId);
    const facts = await loadFactsFromGraph(tenantId);

    let bookings = 0;
    for (const b of bookingSpecs()) {
      const input = {
        bookingNumber: b.no,
        shipper: b.shipper,
        consignee: b.consignee,
        origin: b.origin,
        destination: b.destination,
        hsCode: '847130',
        invoiceAmount: b.amount,
        currency: 'USD',
        customer: b.customer,
      };
      const { verdict } = evaluate(rules, input, facts);
      const atMs = Date.now() - b.daysAgo * DAY;
      const bookingId = `booking_seed_${normalize(b.no)}`;
      await mergeNode(g, 'Booking', bookingId, {
        bookingNumber: b.no,
        input: JSON.stringify(input),
        at: new Date(atMs).toISOString(),
        atMs: String(atMs),
        recordedVerdict: verdict,
        value: String(b.amount),
        customerId: `customer_seed_${normalize(b.customer)}`,
        demoSeed: 'true',
      });
      await mergeRelation(g, 'Booking', bookingId, 'Customer', `customer_seed_${normalize(b.customer)}`, 'FOR');
      bookings++;
    }

    // ---- Invoices (finance desk) ----
    const invoices: Array<[string, string, number]> = [
      ['INV-2231', 'ACME Corp', 24500], ['INV-2232', 'Globex', 8200], ['INV-2233', 'Initech', 4100],
      ['INV-2234', 'Umbrella Corp', 15600], ['INV-2235', 'ACME Corp', 6800], ['INV-2236', 'Globex', 1200],
      ['INV-2237', 'Initech', 9900], ['INV-2238', 'Umbrella Corp', 7300], ['INV-2239', 'ACME Corp', 11100],
      ['INV-2240', 'Globex', 3300], ['INV-2241', 'Initech', 500], ['INV-2242', 'Umbrella Corp', 9200],
    ];
    for (const [no, customer, amount] of invoices) {
      await mergeNode(g, 'Invoice', `invoice_seed_${normalize(no)}`, { invoiceNumber: no, amount: String(amount), currency: 'USD', demoSeed: 'true' });
      await mergeRelation(g, 'Invoice', `invoice_seed_${normalize(no)}`, 'Customer', `customer_seed_${normalize(customer)}`, 'ABOUT');
    }

    // ---- Planted health issues (Knowledge Health report demo) ----
    // 1. Orphan policy: ACTIVE but no owner
    await mergeNode(g, 'Policy', 'policy_seed_dangerous_goods_handling', {
      name: 'Dangerous Goods Handling',
      policyName: 'Dangerous Goods Handling',
      category: 'COMPLIANCE',
      version: 1,
      status: 'ACTIVE',
      validFrom: new Date().toISOString(),
      validTo: '',
      demoSeed: 'true',
    });
    // 2. Stale legacy rule (source doc superseded)
    await mergeNode(g, 'Rule', 'rule_seed_legacy_4digit_hs', {
      ruleName: 'Legacy 4-digit HS Manifest Rule',
      actionType: 'HS_CODE_VALIDATION',
      triggerCondition: 'On customs declaration draft',
      severity: 'MEDIUM',
      parametersJSON: JSON.stringify({ minDigitLength: 4 }),
      version: 1,
      isExecutable: 'true',
      status: 'STALE',
      staleReason: 'Source document superseded by the 6-digit HS standard',
      demoSeed: 'true',
    });
    await mergeRelation(g, 'Rule', 'rule_seed_legacy_4digit_hs', 'Policy', 'policy_seed_hs_code_verification', 'IMPLEMENTS');
    await mergeRelation(g, 'Rule', 'rule_seed_legacy_4digit_hs', 'Chunk', 'doc_seed_hs_code_verification_sop_c0', 'DERIVED_FROM');
    // 3. Document not refreshed in >90 days (the HS data-quality memo)
    await runQuery(
      g,
      `MATCH (d:Document {id: 'doc_seed_decision_memo_hs_code_data_quality_initiative'}) SET d.validFrom = $old`,
      { old: new Date(Date.now() - 120 * DAY).toISOString() }
    );

    // ---- Genesis ledger entry ----
    const { LedgerService } = await import('../services/brain/ledger.service');
    await LedgerService.append({
      tenantId,
      actor: 'system',
      kind: 'GENESIS',
      subjectId: '',
      payload: { note: 'Demo company loaded' },
    });

    return { counts: { bookings, invoices: invoices.length, customers: customers.length, supersededDocs: 1 } };
  }
}
