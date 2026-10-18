import { prisma } from '../../db/client';
import { TeamRole, AccessScope } from '@prisma/client';

export class ControlPlaneService {
  /**
   * Creates a team member with default least-privilege 6-scope access grants.
   */
  static async createTeamMember(
    ownerUserId: string,
    email: string,
    name: string,
    role: TeamRole = TeamRole.OPS
  ) {
    const existing = await prisma.teamMember.findFirst({
      where: { ownerUserId, email },
    });

    if (existing) {
      throw new Error(`Team member with email '${email}' already exists`);
    }

    const allScopes: AccessScope[] = [
      AccessScope.EMAIL,
      AccessScope.DRIVE,
      AccessScope.SLACK,
      AccessScope.ACCOUNTING,
      AccessScope.BRAIN,
      AccessScope.WORKFLOWS,
    ];

    // Default least privilege: OPS/ACCOUNTS get BRAIN + WORKFLOWS, ADMIN gets all
    const defaultAllowed =
      role === TeamRole.ADMIN
        ? allScopes
        : [AccessScope.BRAIN, AccessScope.WORKFLOWS];

    const teamMember = await prisma.teamMember.create({
      data: {
        ownerUserId,
        email,
        name,
        role,
        accessGrants: {
          create: allScopes.map((scope) => ({
            scope,
            isGranted: defaultAllowed.includes(scope),
          })),
        },
      },
      include: { accessGrants: true },
    });

    await prisma.agentAuditLog.create({
      data: {
        userId: ownerUserId,
        action: 'TEAM_MEMBER_CREATED',
        details: { memberEmail: email, role, memberId: teamMember.id },
      },
    });

    return teamMember;
  }

  /**
   * Lists all team members and their 6-scope access grants for an organization.
   */
  static async listTeamMembers(ownerUserId: string) {
    return prisma.teamMember.findMany({
      where: { ownerUserId },
      include: { accessGrants: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Updates a team member's role (ADMIN, OPS, ACCOUNTS).
   */
  static async updateMemberRole(memberId: string, ownerUserId: string, role: TeamRole) {
    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, ownerUserId },
    });

    if (!member) {
      throw new Error('Team member not found');
    }

    const updated = await prisma.teamMember.update({
      where: { id: memberId },
      data: { role },
      include: { accessGrants: true },
    });

    await prisma.agentAuditLog.create({
      data: {
        userId: ownerUserId,
        action: 'MEMBER_ROLE_UPDATED',
        details: { memberEmail: member.email, oldRole: member.role, newRole: role },
      },
    });

    return updated;
  }

  /**
   * Grants a specific scope (e.g. EMAIL, DRIVE, SLACK) to a team member.
   */
  static async grantScope(memberId: string, scope: AccessScope, ownerUserId: string) {
    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, ownerUserId },
    });

    if (!member) {
      throw new Error('Team member not found');
    }

    const grant = await prisma.accessGrant.upsert({
      where: { teamMemberId_scope: { teamMemberId: memberId, scope } },
      update: { isGranted: true },
      create: { teamMemberId: memberId, scope, isGranted: true },
    });

    await prisma.agentAuditLog.create({
      data: {
        userId: ownerUserId,
        action: 'ACCESS_SCOPE_GRANTED',
        details: { memberEmail: member.email, scope },
      },
    });

    return grant;
  }

  /**
   * Instantly revokes a specific scope from a team member.
   */
  static async revokeScope(memberId: string, scope: AccessScope, ownerUserId: string) {
    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, ownerUserId },
    });

    if (!member) {
      throw new Error('Team member not found');
    }

    const grant = await prisma.accessGrant.upsert({
      where: { teamMemberId_scope: { teamMemberId: memberId, scope } },
      update: { isGranted: false },
      create: { teamMemberId: memberId, scope, isGranted: false },
    });

    await prisma.agentAuditLog.create({
      data: {
        userId: ownerUserId,
        action: 'ACCESS_SCOPE_REVOKED',
        details: { memberEmail: member.email, scope },
      },
    });

    return grant;
  }

  /**
   * Deletes a team member and associated scope grants.
   */
  static async deleteTeamMember(memberId: string, ownerUserId: string) {
    const member = await prisma.teamMember.findFirst({
      where: { id: memberId, ownerUserId },
    });

    if (!member) {
      throw new Error('Team member not found');
    }

    await prisma.agentAuditLog.create({
      data: {
        userId: ownerUserId,
        action: 'TEAM_MEMBER_DELETED',
        details: { memberId, memberEmail: member.email, name: member.name },
      },
    });

    await prisma.accessGrant.deleteMany({ where: { teamMemberId: memberId } });
    return prisma.teamMember.delete({ where: { id: memberId } });
  }
}
