import { prisma } from '../../db/client';
import { AgentStatus, AgentMode } from '@prisma/client';

export class AgentManagerService {
  /**
   * Creates a new AI Agent Instance.
   */
  static async createAgent(
    userId: string,
    name: string,
    type: string = 'FREIGHT_AGENT',
    mode: AgentMode = AgentMode.COPILOT,
    configuration: Record<string, any> = {}
  ) {
    const agent = await prisma.agentInstance.create({
      data: {
        userId,
        name,
        type,
        status: AgentStatus.RUNNING,
        mode,
        configuration,
      },
    });

    await prisma.agentAuditLog.create({
      data: {
        agentId: agent.id,
        userId,
        action: 'AGENT_CREATED',
        details: { name: agent.name, type: agent.type, mode: agent.mode },
      },
    });

    return agent;
  }

  /**
   * Lists all agent instances for a user.
   */
  static async listAgents(userId: string) {
    return prisma.agentInstance.findMany({
      where: { userId },
      include: {
        _count: { select: { tasks: true, auditLogs: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Updates agent status (RUNNING, PAUSED, SUSPENDED).
   */
  static async updateStatus(agentId: string, userId: string, status: AgentStatus) {
    const agent = await prisma.agentInstance.findFirst({
      where: { id: agentId, userId },
    });

    if (!agent) {
      throw new Error('Agent instance not found');
    }

    const updated = await prisma.agentInstance.update({
      where: { id: agentId },
      data: { status },
    });

    await prisma.agentAuditLog.create({
      data: {
        agentId: agent.id,
        userId,
        action: 'AGENT_STATUS_CHANGED',
        details: { previousStatus: agent.status, newStatus: status },
      },
    });

    return updated;
  }

  /**
   * Updates agent steering mode (COPILOT vs AUTOPILOT).
   */
  static async updateMode(agentId: string, userId: string, mode: AgentMode) {
    const agent = await prisma.agentInstance.findFirst({
      where: { id: agentId, userId },
    });

    if (!agent) {
      throw new Error('Agent instance not found');
    }

    const updated = await prisma.agentInstance.update({
      where: { id: agentId },
      data: { mode },
    });

    await prisma.agentAuditLog.create({
      data: {
        agentId: agent.id,
        userId,
        action: 'AGENT_MODE_CHANGED',
        details: { previousMode: agent.mode, newMode: mode },
      },
    });

    return updated;
  }

  /**
   * Queries agent audit logs.
   */
  static async getAuditLogs(userId: string, agentId?: string) {
    const where: any = { userId };
    if (agentId) where.agentId = agentId;

    return prisma.agentAuditLog.findMany({
      where,
      include: {
        agent: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Deletes an agent instance and associated tasks.
   */
  static async deleteAgent(agentId: string, userId: string) {
    const agent = await prisma.agentInstance.findFirst({
      where: { id: agentId, userId },
    });

    if (!agent) {
      throw new Error('Agent instance not found');
    }

    await prisma.agentAuditLog.create({
      data: {
        userId,
        action: 'AGENT_DELETED',
        details: { agentId, name: agent.name, type: agent.type },
      },
    });

    await prisma.agentTask.deleteMany({ where: { agentId } });
    return prisma.agentInstance.delete({ where: { id: agentId } });
  }
}
