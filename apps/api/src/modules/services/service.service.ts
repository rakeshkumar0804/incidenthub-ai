import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { ConflictError, NotFoundError, ForbiddenError } from '../../utils/errors';
import type { CreateServiceInput, UpdateServiceInput } from './service.schema';
import { invalidateAnalyticsCache } from '../analytics/analytics.service';

export class ServiceService {
  static async createService(projectId: string, requestingUserId: string, input: CreateServiceInput) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Tenant Isolation Check: Verify user belongs to the project's organization
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

    const slugBase =
      input.slug ||
      input.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') ||
      'service';

    const slug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;

    const existing = await prisma.service.findUnique({
      where: {
        projectId_slug: {
          projectId,
          slug,
        },
      },
    });

    if (existing) {
      throw new ConflictError(`A service with slug '${slug}' already exists in this project`);
    }

    const created = await prisma.service.create({
      data: {
        projectId,
        name: input.name,
        slug,
        description: input.description,
        repositoryUrl: input.repositoryUrl,
      },
    });

    void invalidateAnalyticsCache(project.organizationId);
    return created;
  }

  static async getServices(projectId: string, requestingUserId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Tenant Isolation Check
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

    const services = await prisma.service.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return services.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      name: s.name,
      slug: s.slug,
      description: s.description,
      repositoryUrl: s.repositoryUrl,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  static async getServiceDetails(serviceId: string, requestingUserId: string) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        project: { select: { id: true, name: true, slug: true, organizationId: true } },
      },
    });

    if (!service) {
      throw new NotFoundError('Service not found');
    }

    // Tenant Isolation Check
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: service.project.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!orgMember) {
      throw new ForbiddenError('Access denied');
    }

    return {
      id: service.id,
      projectId: service.projectId,
      name: service.name,
      slug: service.slug,
      description: service.description,
      repositoryUrl: service.repositoryUrl,
      createdAt: service.createdAt.toISOString(),
      updatedAt: service.updatedAt.toISOString(),
      project: service.project,
    };
  }

  static async updateService(serviceId: string, requestingUserId: string, input: UpdateServiceInput) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { project: { select: { organizationId: true } } },
    });

    if (!service) {
      throw new NotFoundError('Service not found');
    }

    // Tenant Isolation Check
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: service.project.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!orgMember) {
      throw new ForbiddenError('Access denied');
    }

    const updated = await prisma.service.update({
      where: { id: serviceId },
      data: {
        name: input.name,
        description: input.description !== undefined ? input.description : service.description,
        repositoryUrl: input.repositoryUrl !== undefined ? input.repositoryUrl : service.repositoryUrl,
      },
    });

    void invalidateAnalyticsCache(service.project.organizationId);
    return updated;
  }

  static async deleteService(serviceId: string, requestingUserId: string) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: { project: { select: { organizationId: true } } },
    });

    if (!service) {
      throw new NotFoundError('Service not found');
    }

    // Tenant Isolation Check
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: service.project.organizationId,
          userId: requestingUserId,
        },
      },
    });

    if (!orgMember) {
      throw new ForbiddenError('Access denied');
    }

    await prisma.service.delete({ where: { id: serviceId } });
    void invalidateAnalyticsCache(service.project.organizationId);
    return { message: 'Service deleted successfully' };
  }
}
