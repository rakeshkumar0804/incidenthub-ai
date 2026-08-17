import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError, ForbiddenError } from '../../utils/errors';
import type { CreateTeamInput, UpdateTeamInput } from './team.schema';

export class TeamService {
  static async createTeam(organizationId: string, input: CreateTeamInput) {
    const existing = await prisma.team.findUnique({
      where: {
        organizationId_name: {
          organizationId,
          name: input.name,
        },
      },
    });

    if (existing) {
      throw new ConflictError(`A team named '${input.name}' already exists in this organization`);
    }

    return prisma.team.create({
      data: {
        organizationId,
        name: input.name,
        description: input.description,
      },
      include: {
        _count: { select: { members: true } },
      },
    });
  }

  static async getTeams(organizationId: string) {
    const teams = await prisma.team.findMany({
      where: { organizationId },
      include: {
        _count: { select: { members: true, projects: true } },
      },
      orderBy: { name: 'asc' },
    });

    return teams.map((t) => ({
      id: t.id,
      organizationId: t.organizationId,
      name: t.name,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      memberCount: t._count.members,
      projectCount: t._count.projects,
    }));
  }

  static async getTeamDetails(teamId: string, requestingUserId: string) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, email: true, name: true, avatarUrl: true },
            },
          },
        },
        projects: {
          select: { id: true, name: true, slug: true, status: true },
        },
      },
    });

    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant isolation verification: Verify user belongs to the team's parent organization
    const orgMembership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: team.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!orgMembership) {
      throw new ForbiddenError('Access denied: You are not a member of this team\'s organization');
    }

    return {
      id: team.id,
      organizationId: team.organizationId,
      name: team.name,
      description: team.description,
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString(),
      memberCount: team.members.length,
      members: team.members.map((m) => ({
        id: m.id,
        teamId: m.teamId,
        userId: m.userId,
        joinedAt: m.joinedAt.toISOString(),
        user: m.user,
      })),
      projects: team.projects,
    };
  }

  static async updateTeam(teamId: string, requestingUserId: string, input: UpdateTeamInput) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant isolation check
    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: team.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenError('Access denied');
    }

    return prisma.team.update({
      where: { id: teamId },
      data: {
        name: input.name,
        description: input.description !== undefined ? input.description : team.description,
      },
    });
  }

  static async deleteTeam(teamId: string, requestingUserId: string) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Tenant isolation check
    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: team.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!member) {
      throw new ForbiddenError('Access denied');
    }

    await prisma.team.delete({ where: { id: teamId } });
    return { message: 'Team deleted successfully' };
  }

  static async addTeamMember(teamId: string, targetUserId: string, requestingUserId: string) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    // Verify requesting user is an org member
    const reqMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: team.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!reqMember) {
      throw new ForbiddenError('Access denied');
    }

    // Verify target user is an org member
    const targetOrgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: team.organizationId,
          userId: targetUserId,
        },
      },
    });

    if (!targetOrgMember) {
      throw new ForbiddenError('Target user must be a member of the organization before joining a team');
    }

    const teamMember = await prisma.teamMember.upsert({
      where: {
        teamId_userId: {
          teamId,
          userId: targetUserId,
        },
      },
      create: {
        teamId,
        userId: targetUserId,
      },
      update: {},
      include: {
        user: {
          select: { id: true, email: true, name: true, avatarUrl: true },
        },
      },
    });

    return {
      id: teamMember.id,
      teamId: teamMember.teamId,
      userId: teamMember.userId,
      joinedAt: teamMember.joinedAt.toISOString(),
      user: teamMember.user,
    };
  }

  static async removeTeamMember(teamId: string, targetUserId: string, requestingUserId: string) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    const reqMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: team.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!reqMember) {
      throw new ForbiddenError('Access denied');
    }

    await prisma.teamMember.deleteMany({
      where: {
        teamId,
        userId: targetUserId,
      },
    });

    return { message: 'Team member removed successfully' };
  }
}
