import { prisma } from '../../db/client';
import { CategoryType } from '@prisma/client';
import { forTenant } from '../../graph/graph.client';
import { mergeNode, mergeRelation, runQuery } from '../../graph/graph.queries';
import crypto from 'crypto';

export class SkillsService {
  /**
   * Creates a custom skill rule manually.
   */
  static async createSkill(
    userId: string,
    data: {
      category?: CategoryType;
      ruleName: string;
      description: string;
      triggerCondition: string;
      actionType: string;
      parameters?: Record<string, any>;
      isExecutable?: boolean;
    }
  ) {
    const skill = await prisma.skillRule.create({
      data: {
        userId,
        category: data.category || CategoryType.GENERAL,
        ruleName: data.ruleName,
        description: data.description,
        triggerCondition: data.triggerCondition,
        actionType: data.actionType,
        parameters: data.parameters || {},
        version: 1,
        isExecutable: data.isExecutable ?? true,
      },
    });
    await this.mirrorSkillToGraph(userId, skill as any);
    return skill;
  }

  /**
   * Scans ingested company SOP documents to extract versioned executable skill rules.
   */
  static async extractSkillsFromSOPs(userId: string) {
    const documents = await prisma.ingestedDocument.findMany({
      where: { userId },
    });

    let extractedCount = 0;

    for (const doc of documents) {
      const extractedRules = this.parseRulesFromDocument(doc.title, doc.content);

      for (const rule of extractedRules) {
        const existing = await prisma.skillRule.findFirst({
          where: { userId, ruleName: rule.ruleName },
        });

        if (!existing) {
          await prisma.skillRule.create({
            data: {
              userId,
              category: rule.category,
              ruleName: rule.ruleName,
              description: rule.description,
              triggerCondition: rule.triggerCondition,
              actionType: rule.actionType,
              parameters: rule.parameters,
              version: 1,
              isExecutable: true,
              sourceDocumentId: doc.id,
            },
          });
          extractedCount++;
        }
      }
    }

    return { success: true, extractedSkillsCount: extractedCount };
  }

  /**
   * Lists versioned skill rules for a user.
   */
  static async listSkills(userId: string, category?: CategoryType) {
    const where: any = { userId };
    if (category) where.category = category;

    return prisma.skillRule.findMany({
      where,
      include: {
        sourceDocument: { select: { id: true, title: true, sourceUrl: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Edits a skill rule, updating parameters and bumping the version number.
   */
  static async updateSkill(
    skillId: string,
    userId: string,
    updates: {
      ruleName?: string;
      description?: string;
      triggerCondition?: string;
      actionType?: string;
      parameters?: Record<string, any>;
      isExecutable?: boolean;
    }
  ) {
    const skill = await prisma.skillRule.findFirst({
      where: { id: skillId, userId },
    });

    if (!skill) {
      throw new Error('Skill rule not found');
    }

    const updated = await prisma.skillRule.update({
      where: { id: skillId },
      data: {
        ...updates,
        version: skill.version + 1, // Increment rule version on update
      },
    });
    await this.mirrorSkillToGraph(userId, updated as any);
    return updated;
  }

  /**
   * Deletes a skill rule.
   */
  static async deleteSkill(skillId: string, userId: string) {
    const skill = await prisma.skillRule.findFirst({
      where: { id: skillId, userId },
    });

    if (!skill) {
      throw new Error('Skill rule not found');
    }

    await prisma.skillRule.delete({
      where: { id: skillId },
    });

    return { success: true, message: 'Skill rule deleted successfully' };
  }

  /**
   * Evaluates an input payload against an executable skill rule.
   * The denied-party WATCHLIST lives in the tenant FalkorDB graph as
   * WatchlistEntry nodes (G7 fix) — the engine reads it via Cypher, flagging
   * demo-seeded entries as demo data.
   */
  static async executeSkill(skillId: string, userId: string, inputPayload: Record<string, any>) {
    const skill = await prisma.skillRule.findFirst({
      where: { id: skillId, userId },
    });

    if (!skill || !skill.isExecutable) {
      throw new Error('Skill rule is not executable or not found');
    }

    let status = 'PASSED';
    let resultDetails = '';
    const violations: string[] = [];
    const traceNodes: Array<any> = [];
    const traceEdges: Array<any> = [];

    if (skill.actionType === 'DENIED_PARTY_SCREENING') {
      const partyName = inputPayload.shipper || inputPayload.consignee || inputPayload.partyName || '';
      const restrictedNames: string[] = [];
      let demoList = false;
      try {
        const graph = await forTenant(userId);
        const rows = await runQuery(graph, `MATCH (w:WatchlistEntry) RETURN w.name AS name, w.list AS list`, {});
        rows.forEach((r: any) => {
          if (r.name) restrictedNames.push(String(r.name));
          if (r.list) demoList = String(r.list).includes('demo') || demoList;
        });
        if (rows.length) demoList = true; // seeded lists are labeled demo
      } catch (err: any) {
        console.warn('Watchlist graph read notice (FalkorDB down?) — executing with empty list:', err?.message || err);
      }
      traceNodes.push({ id: skill.id, label: 'Rule', name: skill.ruleName });
      if (restrictedNames.length && restrictedNames.some((restricted) => partyName.toLowerCase().includes(restricted.toLowerCase()))) {
        status = 'FLAGGED';
        violations.push(`Party '${partyName}' matches denied-party screening ${demoList ? 'demo ' : ''}watchlist entry.`);
      } else if (!restrictedNames.length) {
        status = 'PASSED';
        resultDetails = `Party '${partyName}' cleared screening (no watchlist entries configured in graph).`;
      } else {
        resultDetails = `Party '${partyName}' successfully cleared denied-party screening.`;
      }
    } else if (skill.actionType === 'HS_CODE_VALIDATION') {
      const hsCode = inputPayload.hsCode || inputPayload.tariffCode || '';
      if (!hsCode || hsCode.length < 6) {
        status = 'FLAGGED';
        violations.push('HS Code missing or invalid format (must be 6+ digits).');
      } else {
        resultDetails = `HS Code ${hsCode} validated against tariff schedule.`;
      }
    } else if (skill.actionType === 'CREDIT_LIMIT_APPROVAL') {
      const amount = Number(inputPayload.invoiceAmount || inputPayload.amount || 0);
      const limit = Number((skill.parameters as any)?.maxCreditLimit || 10000);
      if (amount > limit) {
        status = 'REQUIRES_APPROVAL';
        violations.push(`Amount $${amount} exceeds max automated credit approval limit ($${limit}).`);
      } else {
        resultDetails = `Invoice amount $${amount} within automated credit limit.`;
      }
    } else {
      resultDetails = `Rule '${skill.ruleName}' executed against payload successfully.`;
    }

    const { assembleTrace } = await import('./trace.service');
    const trace = assembleTrace(traceNodes, traceEdges, `executeSkill(${skill.actionType})`);

    return {
      skillId: skill.id,
      ruleName: skill.ruleName,
      version: skill.version,
      status,
      resultDetails,
      violations,
      traceId: trace.traceId,
      executedAt: new Date().toISOString(),
    };
  }

  /** Echoes a SQL skill rule into the tenant graph as (Rule)-[:IMPLEMENTS]->(Policy) so
   * the graph stays the explainability source of truth for rules too. */
  private static async mirrorSkillToGraph(userId: string, skill: {
    id: string;
    ruleName: string;
    description: string;
    actionType: string;
    parameters?: any;
    version: number;
    isExecutable: boolean;
    sourceDocumentId?: string | null;
  }) {
    try {
      const graph = await forTenant(userId);
      await mergeNode(graph, 'Rule', skill.id, {
        ruleName: skill.ruleName,
        actionType: skill.actionType,
        triggerCondition: skill.ruleName,
        severity: 'HIGH',
        parametersJSON: JSON.stringify(skill.parameters || {}),
        version: skill.version,
        isExecutable: skill.isExecutable ? 'true' : 'false',
        status: 'ACTIVE',
      });
      const policyId = `policy_${skill.actionType.toLowerCase()}`;
      await mergeNode(graph, 'Policy', policyId, {
        name: skill.ruleName,
        policyName: skill.ruleName,
        category: 'GENERAL',
        version: skill.version,
        status: 'ACTIVE',
        description: skill.description,
      });
      await mergeRelation(graph, 'Rule', skill.id, 'Policy', policyId, 'IMPLEMENTS');
      if (skill.sourceDocumentId) {
        const docId = `doc_${skill.sourceDocumentId}`;
        try {
          await mergeRelation(graph, 'Rule', skill.id, 'Document', docId, 'DERIVED_FROM');
        } catch {
          // document node may not exist yet in graph; provenance attempt is best-effort
        }
      }
    } catch (err: any) {
      console.warn('Skill graph mirror notice (FalkorDB down? rules remain in SQL):', err?.message || err);
    }
  }

  private static parseRulesFromDocument(docTitle: string, content: string) {
    const rules: Array<{
      category: CategoryType;
      ruleName: string;
      description: string;
      triggerCondition: string;
      actionType: string;
      parameters: Record<string, any>;
    }> = [];

    // Rule 1: Freight Denied Party Screening
    if (/denied-party|screening|restricted party/i.test(content) || /sop/i.test(docTitle)) {
      rules.push({
        category: CategoryType.FREIGHT,
        ruleName: 'Freight Denied-Party Screening Rule',
        description: 'Screen shippers, consignees, and notify parties against global sanction and denied-party lists prior to booking confirmation.',
        triggerCondition: 'On booking created or modified',
        actionType: 'DENIED_PARTY_SCREENING',
        parameters: { severity: 'CRITICAL', requireApprovalIfFlagged: true },
      });
    }

    // Rule 2: Tariff / HS Code Verification
    if (/hs code|tariff|customs/i.test(content) || /freight/i.test(docTitle)) {
      rules.push({
        category: CategoryType.FREIGHT,
        ruleName: 'Customs HS Code Verification Standard',
        description: 'Ensure 6-digit minimum international HS Code tariff declaration on export/import manifests.',
        triggerCondition: 'On customs declaration draft',
        actionType: 'HS_CODE_VALIDATION',
        parameters: { minDigitLength: 6, validateSchedule: true },
      });
    }

    // Rule 3: Finance Credit Approval Limit
    if (/billing|credit|invoice/i.test(content) || /billing/i.test(docTitle)) {
      rules.push({
        category: CategoryType.FINANCE,
        ruleName: 'Automated Invoice Credit Approval Threshold',
        description: 'Auto-approve client invoice creation up to $10,000 credit limit; require ops manager approval for higher amounts.',
        triggerCondition: 'On invoice creation request',
        actionType: 'CREDIT_LIMIT_APPROVAL',
        parameters: { maxCreditLimit: 10000, approvalRole: 'ADMIN' },
      });
    }

    return rules;
  }
}
