import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { OrgRole } from '@incidenthub/shared';
import { ConflictError, NotFoundError, ForbiddenError, ValidationError } from '../../utils/errors';
import type { CreateOrganizationInput, UpdateOrganizationInput } from './organization.schema';

export class OrganizationService {
  static async createOrganization(userId: string, input: CreateOrganizationInput) {
    const slugBase =
      input.slug ||
      input.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') ||
      'org';

    const slug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;

    const existing = await prisma.organization.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictError('An organization with this slug already exists');
    }

    return prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.name,
          slug,
          logoUrl: input.logoUrl,
        },
      });

      const member = await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId,
          role: OrgRole.OWNER,
        },
        include: { organization: true },
      });

      return {
        organization,
        role: member.role,
      };
    });
  }

  static async getUserOrganizations(userId: string) {
    const members = await prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: true,
      },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      logoUrl: m.organization.logoUrl,
      role: m.role as unknown as OrgRole,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  static async getOrganizationDetails(organizationId: string) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        _count: {
          select: {
            members: true,
            teams: true,
            projects: true,
          },
        },
      },
    });

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const serviceCount = await prisma.service.count({
      where: { project: { organizationId } },
    });

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
      memberCount: org._count.members,
      teamCount: org._count.teams,
      projectCount: org._count.projects,
      serviceCount,
    };
  }

  static async updateOrganization(organizationId: string, input: UpdateOrganizationInput) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    return prisma.organization.update({
      where: { id: organizationId },
      data: {
        name: input.name,
        logoUrl: input.logoUrl !== undefined ? input.logoUrl : org.logoUrl,
      },
    });
  }

  static async deleteOrganization(organizationId: string, userId: string, confirmSlug: string) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Verify user is an OWNER in the organization
    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });

    if (!member || (member.role as unknown as OrgRole) !== OrgRole.OWNER) {
      throw new ForbiddenError('Only an Organization OWNER can delete the organization');
    }

    // Require explicit slug confirmation to prevent accidental deletion
    if (confirmSlug !== org.slug) {
      throw new ValidationError(`Confirmation failed: Provided slug '${confirmSlug}' does not match organization slug '${org.slug}'`);
    }

    // Intentional Cascade Deletion: Deletes organization and linked members, teams, projects, services, invitations
    await prisma.organization.delete({
      where: { id: organizationId },
    });

    return { message: `Organization '${org.name}' (${org.slug}) deleted successfully` };
  }
}
