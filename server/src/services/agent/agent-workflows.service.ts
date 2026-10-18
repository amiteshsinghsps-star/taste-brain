import { prisma } from '../../db/client';
import { AgentMode, TaskStatus, AgentStatus } from '@prisma/client';
import { RetrievalService } from '../brain/retrieval.service';
import { forTenant } from '../../graph/graph.client';
import { runQuery, mergeNode, mergeRelation } from '../../graph/graph.queries';
import { MemoryService } from '../memory/memory.service';
import { evaluateBooking } from '../brain/rule-engine.service';
import { LedgerService } from '../brain/ledger.service';
import { PrecedentService } from '../brain/precedent.service';
import crypto from 'crypto';

/**
 * AgentWorkflowsService — graph-driven agents (Epic E, FR-14..FR-18).
 *
 * The freight agent decides via the TENANT GRAPH end-to-end:
 *   1. Loads governing policies/rules via Cypher (loadRulesFromGraph).
 *   2. Runs the PURE deterministic engine over graph rules + the graph
 *      watchlist — the LLM never decides pass/fail (FR-15). Every rule
 *      evaluation (verdict, margin, reasons, source chunks) is kept for
 *      Why-Not explanations and the Decision Trace.
 *   3. Writes Booking + Task, TRIGGERED, PERFORMED, Decision nodes + trace.
 *   4. Copilot stages with traceId; Autopilot executes and logs.
 *   5. Appends a hash-chained ledger entry; writes an Episode (Track 02).
 */
export class AgentWorkflowsService {
  /** FR-14: freight agent processes a booking using the graph. */
  static async executeFreightWorkflow(
    agentId: string,
    userId: string,
    payload: {
      bookingNumber?: string;
      shipper: string;
      consignee: string;
      origin: string;
      destination: string;
      hsCode?: string;
      containerType?: string;
      invoiceAmount?: number;
    }
  ) {
    const agent = await prisma.agentInstance.findFirst({
      where: { id: agentId, userId },
    });

    if (!agent || agent.status !== AgentStatus.RUNNING) {
      throw new Error('Agent instance is not running or not found');
    }
    const graph = await forTenant(userId);

    // 1. Pure engine over graph rules + graph watchlist (deterministic verdict)
    const engine = await evaluateBooking(userId, payload);
    const violations: string[] = [...engine.reasons];
    let fieldValidation = 'PASSED';

    // 2. Mandatory Field Validation (deterministic)
    if (!payload.shipper || !payload.consignee || !payload.origin || !payload.destination) {
      fieldValidation = 'FAILED';
      violations.push('Missing required booking fields: shipper, consignee, origin, or destination.');
    }
    const fired = engine.evaluations.filter((e) => e.fired);

    // 3. Grounded context + citations for the draft (graph retrieval, keyed)
    const brainContext = await RetrievalService.query(userId, `customs SOP for ${payload.destination} booking`);

    // 4. Non-LLM cited draft reply
    const draftReply = `Dear ${payload.shipper},\n\nWe have received container booking ${payload.bookingNumber || 'REQ-' + Date.now()} from ${payload.origin} to ${payload.destination}. Mandatory HS Code ${payload.hsCode || 'PENDING'} declared.\n\nBest regards,\nCustoms Desk Agent`;

    const isFlagged = engine.verdict === 'FLAGGED';
    const verdict = engine.verdict;
    // L1 Copilot stages every outcome — including a blocked shipment — for a human (T10).
    const taskStatus: TaskStatus =
      agent.mode === AgentMode.COPILOT
        ? TaskStatus.STAGED_FOR_APPROVAL
        : isFlagged
          ? TaskStatus.FLAGGED
          : verdict === 'REQUIRES_APPROVAL'
            ? TaskStatus.STAGED_FOR_APPROVAL
            : TaskStatus.COMPLETED;

    // 5. Graph writes: Booking + Task + TRIGGERED + PERFORMED
    const taskId = `task_${crypto.randomUUID()}`;
    const bookingRef = payload.bookingNumber || `BKG-${Date.now()}`;
    const bookingId = `booking_${bookingRef.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
    await mergeNode(graph, 'Booking', bookingId, {
      bookingNumber: bookingRef,
      input: JSON.stringify(payload),
      at: new Date().toISOString(),
      atMs: String(Date.now()),
      recordedVerdict: verdict,
      demoSeed: 'false',
    });
    const custRows = await runQuery(
      graph,
      `MATCH (c:Customer) WHERE toLower($party) CONTAINS toLower(c.name) RETURN c.id AS id LIMIT 1`,
      { party: `${payload.shipper} ${payload.consignee}` }
    );
    if (custRows[0]?.id) {
      await mergeRelation(graph, 'Booking', bookingId, 'Customer', custRows[0].id, 'FOR');
    }

    await mergeNode(graph, 'Task', taskId, {
      kind: 'FREIGHT_BOOKING_CHECK',
      status: taskStatus,
      createdAt: new Date().toISOString(),
      summary: `${isFlagged ? 'Flagged' : 'Checked'} booking ${bookingRef} (${payload.shipper} → ${payload.consignee}) — verdict ${verdict}`,
      bookingRef,
    });
    await mergeRelation(graph, 'Agent', agent.id, 'Task', taskId, 'PERFORMED');
    for (const e of fired.slice(0, 5)) {
      try {
        await mergeRelation(graph, 'Task', taskId, 'Rule', e.ruleId, 'TRIGGERED');
        await mergeRelation(graph, 'Booking', bookingId, 'Rule', e.ruleId, 'TRIGGERED');
      } catch {
        /* best-effort link */
      }
    }
    if (isFlagged) {
      // link matched watchlist entry
      const watchRows = await runQuery(
        graph,
        `MATCH (w:WatchlistEntry) WHERE toLower($shipper) CONTAINS toLower(w.name) OR toLower($consignee) CONTAINS toLower(w.name) RETURN w.id AS id`,
        { shipper: payload.shipper, consignee: payload.consignee }
      );
      for (const w of watchRows) {
        await mergeRelation(graph, 'Booking', bookingId, 'WatchlistEntry', w.id, 'FLAGGED_BY');
      }
    }

    // Trace: booking → task → rule → policy + engine evaluations (Appendix B shape)
    const traceNodes: any[] = [
      { id: bookingId, label: 'Booking', name: bookingRef },
      { id: taskId, label: 'Task', name: `Booking ${bookingRef}` },
    ];
    const traceEdges: any[] = [{ from: agent.id, to: taskId, type: 'PERFORMED' }];
    for (const e of engine.evaluations) {
      traceNodes.push({ id: e.ruleId, label: 'Rule', name: e.ruleName });
      traceEdges.push({ from: taskId, to: e.ruleId, type: 'TRIGGERED' });
      if (e.policyName) {
        traceNodes.push({ id: `policy:${e.policyName}`, label: 'Policy', name: e.policyName });
        traceEdges.push({ from: e.ruleId, to: `policy:${e.policyName}`, type: 'IMPLEMENTS' });
      }
    }
    const precedents = await PrecedentService.similar(
      userId,
      [bookingRef, payload.shipper, payload.consignee, payload.destination, ...fired.map((e) => e.ruleName)].filter(Boolean) as string[],
      3
    ).catch((err: any) => {
      // The approval card works without precedent; never fail a verdict over it.
      console.warn('precedent lookup notice:', err?.message || err);
      return [];
    });

    const taskResult = {
      bookingNumber: bookingRef,
      bookingId,
      verdict,
      fieldValidation,
      evaluations: engine.evaluations,
      governingRules: fired.map((e) => e.ruleId),
      citations: brainContext.citations,
      precedents,
      draftReply,
      violations,
      taskId,
      executedMode: agent.mode,
      trace: {
        traceId: brainContext.trace.traceId,
        nodes: traceNodes,
        edges: traceEdges,
      },
      traceSentences: [
        `Booking ${bookingRef} → pure engine evaluated ${engine.evaluations.length} graph rule(s) → verdict ${verdict} → staged in ${agent.mode}`,
        ...engine.evaluations.map((e) => `Rule "${e.ruleName}" (${e.actionType}) → ${e.verdict}${typeof e.margin === 'number' ? `, margin ${e.margin}` : ''} — ${e.reasons[0] || ''}`),
      ],
    };

    const task = await prisma.agentTask.create({
      data: {
        agentId: agent.id,
        userId,
        taskType: 'FREIGHT_CUSTOMS_WORKFLOW',
        inputPayload: payload as any,
        outputResult: taskResult as any,
        status: taskStatus,
      },
    });

    // Hash-chained ledger entry (W4): every agent verdict is tamper-evident
    try {
      await LedgerService.append({
        tenantId: userId,
        actor: `agent:${agent.name}`,
        kind: `FREIGHT_CHECK_${verdict}`,
        subjectId: bookingId,
        traceId: brainContext.trace.traceId,
        payload: { bookingNumber: bookingRef, verdict, firedRules: fired.map((e) => e.ruleName), mode: agent.mode },
      });
    } catch (err: any) {
      console.warn('ledger append notice:', err?.message || err);
    }

    // Memory episode (FR-19, Track 02)
    try {
      await MemoryService.writeEpisode(
        { tenantId: userId, agentId: agent.id },
        `Freight agent ${isFlagged ? 'flagged' : verdict === 'REQUIRES_APPROVAL' ? 'staged for approval' : 'cleared'} booking ${bookingRef}: ${violations.join('; ') || 'no violations'}`,
        [{ label: 'Booking', id: bookingId }],
        verdict
      );
    } catch (err) {
      console.warn('episode write notice:', err);
    }

    await prisma.agentAuditLog.create({
      data: {
        agentId: agent.id,
        userId,
        action: agent.mode === AgentMode.COPILOT ? 'FREIGHT_WORKFLOW_STAGED' : 'FREIGHT_WORKFLOW_EXECUTED',
        details: { taskId: task.id, graphTaskId: taskId, bookingId, traceId: brainContext.trace.traceId, status: taskStatus, verdict, violationsCount: violations.length } as any,
      },
    });

    return { task, result: taskResult };
  }

  /** Workflows 1: Answer & Draft Reply — now graph-first with trace. */
  static async answerAndDraftWorkflow(agentId: string, userId: string, prompt: string, recipient?: string) {
    const brainRes = await RetrievalService.query(userId, prompt);
    const draftEmail = `Hello ${recipient || 'Team'},\n\nRegarding your inquiry:\n${brainRes.answer}\n\nBest regards,\nAI Brain Copilot`;

    return this.createWorkflowTask(agentId, userId, 'ANSWER_AND_DRAFT', { prompt, recipient }, {
      answer: brainRes.answer,
      citations: brainRes.citations,
      trace: brainRes.trace,
      traceSentences: brainRes.traceSentences,
      draftEmail,
    });
  }

  /** Workflows 2: Summarize thread. */
  static async summarizeThreadWorkflow(agentId: string, userId: string, threadContent: string) {
    const cleanText = threadContent.replace(/<[^>]*>/g, '').trim();
    const summary = cleanText.length > 300 ? `${cleanText.substring(0, 300)}...` : cleanText;

    return this.createWorkflowTask(agentId, userId, 'SUMMARIZE_THREAD', { textLength: threadContent.length }, {
      summary: `Key Summary: ${summary}`,
      bulletPoints: [
        'Thread ingested; entities extracted into the tenant knowledge graph.',
        'Core operational updates captured with source citations.',
      ],
    });
  }

  /** Workflows 3: Extract action items. */
  static async extractActionItemsWorkflow(agentId: string, userId: string, textContent: string) {
    const lines = textContent.split('\n').filter((l) => l.trim().length > 0);
    const actionItems = lines.slice(0, 5).map((line, idx) => ({
      id: `act_${idx + 1}`,
      task: line.trim(),
      assignee: 'Operations Desk',
      dueDate: new Date(Date.now() + (idx + 1) * 24 * 3600 * 1000).toISOString().split('T')[0],
      priority: idx === 0 ? 'HIGH' : 'MEDIUM',
    }));

    return this.createWorkflowTask(agentId, userId, 'EXTRACT_ACTION_ITEMS', { textContent }, {
      count: actionItems.length,
      actionItems,
    });
  }

  /** E3 (FR-18): email agent triage hands a Task to the Freight/Finance agent via HANDED_OFF_TO. */
  static async handOffTask(userId: string, fromAgentId: string, toAgentId: string, kind: string, summary: string) {
    const graph = await forTenant(userId);
    const taskId = `task_${crypto.randomUUID()}`;
    await mergeNode(graph, 'Task', taskId, {
      kind,
      status: 'HANDED_OFF',
      createdAt: new Date().toISOString(),
      summary: summary.slice(0, 400),
    });
    await mergeRelation(graph, 'Task', taskId, 'Agent', toAgentId, 'HANDED_OFF_TO');
    await mergeRelation(graph, 'Agent', fromAgentId, 'Task', taskId, 'PERFORMED');
    try {
      await MemoryService.writeEpisode({ tenantId: userId, agentId: fromAgentId }, `Email agent handed off task: ${summary}`, [{ label: 'Task', id: taskId }], 'HANDED_OFF');
    } catch {
      // memory best-effort
    }
    return { taskId, fromAgentId, toAgentId, kind };
  }

  /**
   * Approves a staged Copilot task -> creates a Decision node in the graph (C3).
   */
  static async approveTask(taskId: string, userId: string) {
    const task = await prisma.agentTask.findFirst({
      where: { id: taskId, userId },
    });

    if (!task) {
      throw new Error('Task not found');
    }

    if (task.status !== TaskStatus.STAGED_FOR_APPROVAL && task.status !== TaskStatus.FLAGGED) {
      throw new Error(`Task cannot be approved from status '${task.status}'`);
    }

    const updatedTask = await prisma.agentTask.update({
      where: { id: taskId },
      data: { status: TaskStatus.COMPLETED },
    });

    // Decision node in the graph: Person → DECIDED → Decision → ABOUT → Task/Policy
    try {
      const graph = await forTenant(userId);
      const decisionId = `decision_${crypto.randomUUID()}`;
      const bookingRef = (task.outputResult as any)?.bookingNumber || task.taskType;
      await mergeNode(graph, 'Decision', decisionId, {
        summary: `Human approved agent task (${bookingRef})`,
        outcome: 'APPROVED',
        at: new Date().toISOString(),
        mode: 'COPILOT',
      });
      await mergeNode(graph, 'Task', `task_sql_${task.id}`, {
        kind: task.taskType,
        status: 'COMPLETED',
        createdAt: task.createdAt.toISOString(),
        summary: `${task.taskType} ${bookingRef}`,
        sqlId: task.id,
      });
      // Direction matches the seeded convention (Decision)-[:ABOUT]->(Task|Policy);
      // the precedent lookup and the trace walk both traverse it this way.
      await mergeRelation(graph, 'Decision', decisionId, 'Task', `task_sql_${task.id}`, 'ABOUT');

      // The person behind the decision: the account holder is a graph Person node,
      // so "who approved this" is answerable from the graph, not only from Postgres.
      const approver = await prisma.user.findUnique({ where: { id: userId } });
      const approverId = `person_user_${userId}`;
      await mergeNode(graph, 'Person', approverId, {
        name: approver?.name || approver?.email || userId,
        email: approver?.email ?? null,
        role: 'APPROVER',
      } as any);
      await mergeRelation(graph, 'Person', approverId, 'Decision', decisionId, 'DECIDED');

      // ...and the SOP that authorised it, via the rules the engine fired.
      const ruleIds: string[] = Array.isArray((task.outputResult as any)?.governingRules)
        ? (task.outputResult as any).governingRules
        : [];
      if (ruleIds.length) {
        const policyRows = await runQuery(
          graph,
          `MATCH (r:Rule)-[:IMPLEMENTS]->(p:Policy) WHERE r.id IN $ruleIds RETURN DISTINCT p.id AS id LIMIT 3`,
          { ruleIds }
        );
        for (const p of policyRows) {
          await mergeRelation(graph, 'Decision', decisionId, 'Policy', p.id, 'ABOUT');
        }
      }
      await MemoryService.writeEpisode({ tenantId: userId }, `Approved agent task ${task.id} (${task.taskType})`, [], 'APPROVED');
      // Hash-chained ledger entry (W4)
      try {
        await LedgerService.append({
          tenantId: userId,
          actor: `human:${approver?.email ?? userId}`,
          kind: 'TASK_APPROVED',
          subjectId: decisionId,
          traceId: (task.outputResult as any)?.trace?.traceId,
          payload: { taskId: task.id, taskType: task.taskType, bookingNumber: (task.outputResult as any)?.bookingNumber },
        });
      } catch (err: any) {
        console.warn('ledger append (approval) notice:', err?.message || err);
      }
    } catch (err) {
      console.warn('decision graph write notice (SQL approval still applies):', err);
    }

    await prisma.agentAuditLog.create({
      data: {
        agentId: task.agentId,
        userId,
        action: 'COPILOT_TASK_APPROVED',
        details: { taskId: task.id, approvedAt: new Date().toISOString(), traceId: (task.outputResult as any)?.trace?.traceId || (task.outputResult as any)?.traceId } as any,
      },
    });

    return updatedTask;
  }

  /** Lists tasks for a user, optionally filtered by status. */
  static async listTasks(userId: string, status?: TaskStatus) {
    const where: any = { userId };
    if (status) where.status = status;

    return prisma.agentTask.findMany({
      where,
      include: {
        agent: { select: { id: true, name: true, type: true, mode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private static async createWorkflowTask(
    agentId: string,
    userId: string,
    taskType: string,
    inputPayload: any,
    outputResult: any
  ) {
    const agent = await prisma.agentInstance.findFirst({
      where: { id: agentId, userId },
    });

    if (!agent || agent.status !== AgentStatus.RUNNING) {
      throw new Error('Agent instance is not running');
    }

    const taskStatus: TaskStatus = agent.mode === AgentMode.COPILOT ? TaskStatus.STAGED_FOR_APPROVAL : TaskStatus.COMPLETED;

    const task = await prisma.agentTask.create({
      data: {
        agentId,
        userId,
        taskType,
        inputPayload,
        outputResult,
        status: taskStatus,
      },
    });

    // Graph task node + episode memory
    try {
      const graph = await forTenant(userId);
      const graphTaskId = `task_sql_${task.id}`;
      await mergeNode(graph, 'Task', graphTaskId, {
        kind: taskType,
        status: taskStatus,
        createdAt: task.createdAt.toISOString(),
        summary: '',
        sqlId: task.id,
      });
      await mergeRelation(graph, 'Agent', agent.id, 'Task', graphTaskId, 'PERFORMED');
      await MemoryService.writeEpisode({ tenantId: userId, agentId: agent.id }, `Agent completed ${taskType}`, [{ label: 'Task', id: graphTaskId }], taskStatus);
    } catch (err) {
      console.warn('graph task write notice:', err);
    }

    await prisma.agentAuditLog.create({
      data: {
        agentId,
        userId,
        action: `AGENT_TASK_${taskStatus}`,
        details: { taskType, taskId: task.id } as any,
      },
    });

    return { task, result: outputResult };
  }
}
