import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import type { ProjectStatus } from '@incidenthub/shared';
import { ConflictError, NotFoundError, ForbiddenError } from '../../utils/errors';
import type { CreateProjectInput, UpdateProjectInput } from './project.schema';
import { invalidateAnalyticsCache } from '../analytics/analytics.service';

export class ProjectService {
  static async createProject(organizationId: string, input: CreateProjectInput) {
    const slugBase =
      input.slug ||
      input.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') ||
      'project';

    const slug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;

    const existing = await prisma.project.findUnique({
      where: {
        organizationId_slug: {
          organizationId,
          slug,
        },
      },
    });

    if (existing) {
      throw new ConflictError(`A project with slug '${slug}' already exists in this organization`);
    }

    if (input.teamId) {
      const team = await prisma.team.findFirst({
        where: { id: input.teamId, organizationId },
      });
      if (!team) {
        throw new NotFoundError('Associated team not found in this organization');
      }
    }

    const created = await prisma.project.create({
      data: {
        organizationId,
        name: input.name,
        slug,
        description: input.description,
        status: input.status,
        teamId: input.teamId || null,
      },
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { services: true } },
      },
    });

    void invalidateAnalyticsCache(organizationId);
    return created;
  }

  static async getProjects(organizationId: string, statusFilter?: ProjectStatus) {
    const projects = await prisma.project.findMany({
      where: {
        organizationId,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { services: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return projects.map((p) => ({
      id: p.id,
      organizationId: p.organizationId,
      name: p.name,
      slug: p.slug,
      description: p.description,
      status: p.status as unknown as ProjectStatus,
      teamId: p.teamId,
      team: p.team,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      serviceCount: p._count.services,
    }));
  }

  static async getProjectDetails(projectId: string, requestingUserId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        team: { select: { id: true, name: true } },
        services: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Tenant Isolation Verification: Verify user is a member of the project's parent organization
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!orgMember) {
      throw new ForbiddenError('Access denied: You are not a member of this project\'s organization');
    }

    return {
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status as unknown as ProjectStatus,
      teamId: project.teamId,
      team: project.team,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      services: project.services.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        name: s.name,
        slug: s.slug,
        description: s.description,
        repositoryUrl: s.repositoryUrl,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  }

  static async updateProject(projectId: string, requestingUserId: string, input: UpdateProjectInput) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Tenant isolation check
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!orgMember) {
      throw new ForbiddenError('Access denied');
    }

    if (input.teamId) {
      const team = await prisma.team.findFirst({
        where: { id: input.teamId, organizationId: project.organizationId },
      });
      if (!team) {
        throw new NotFoundError('Associated team not found in this organization');
      }
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        name: input.name,
        description: input.description !== undefined ? input.description : project.description,
        status: input.status,
        teamId: input.teamId !== undefined ? input.teamId : project.teamId,
      },
      include: {
        team: { select: { id: true, name: true } },
      },
    });

    void invalidateAnalyticsCache(project.organizationId);
    return updated;
  }

  static async deleteProject(projectId: string, requestingUserId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Tenant isolation check
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!orgMember) {
      throw new ForbiddenError('Access denied');
    }

    await prisma.project.delete({ where: { id: projectId } });
    void invalidateAnalyticsCache(project.organizationId);
    return { message: 'Project deleted successfully' };
  }
}
