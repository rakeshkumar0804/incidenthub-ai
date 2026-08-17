import { prisma } from '../../lib/prisma';
import { OrgRole } from '@incidenthub/shared';
import { NotFoundError, ForbiddenError, ValidationError } from '../../utils/errors';
import type { UpdateMemberRoleInput } from './member.schema';

export class MemberService {
  static async getMembers(organizationId: string) {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      organizationId: m.organizationId,
      userId: m.userId,
      role: m.role as unknown as OrgRole,
      joinedAt: m.joinedAt.toISOString(),
      user: m.user,
    }));
  }

  static async updateMemberRole(
    organizationId: string,
    targetMemberId: string,
    requesterUserId: string,
    input: UpdateMemberRoleInput,
  ) {
    const targetMember = await prisma.organizationMember.findFirst({
      where: { id: targetMemberId, organizationId },
    });

    if (!targetMember) {
      throw new NotFoundError('Organization member not found');
    }

    const requesterMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: requesterUserId,
        },
      },
    });

    if (!requesterMember) {
      throw new ForbiddenError('Access denied');
    }

    const requesterRole = requesterMember.role as unknown as OrgRole;
    const targetRole = targetMember.role as unknown as OrgRole;

    // Privilege escalation protection: Only OWNER can assign OWNER role
    if (input.role === OrgRole.OWNER && requesterRole !== OrgRole.OWNER) {
      throw new ForbiddenError('Only an Organization OWNER can grant or transfer OWNER status');
    }

    // Protection against removing sole owner
    if (targetRole === OrgRole.OWNER && input.role !== OrgRole.OWNER) {
      const ownerCount = await prisma.organizationMember.count({
        where: { organizationId, role: OrgRole.OWNER },
      });

      if (ownerCount <= 1) {
        throw new ValidationError('Cannot downgrade the sole Organization OWNER. Assign another OWNER first.');
      }
    }

    const updated = await prisma.organizationMember.update({
      where: { id: targetMember.id },
      data: { role: input.role },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatarUrl: true },
        },
      },
    });

    return {
      id: updated.id,
      organizationId: updated.organizationId,
      userId: updated.userId,
      role: updated.role as unknown as OrgRole,
      joinedAt: updated.joinedAt.toISOString(),
      user: updated.user,
    };
  }

  static async removeMember(organizationId: string, targetMemberId: string) {
    const targetMember = await prisma.organizationMember.findFirst({
      where: { id: targetMemberId, organizationId },
    });

    if (!targetMember) {
      throw new NotFoundError('Organization member not found');
    }

    const targetRole = targetMember.role as unknown as OrgRole;

    // Sole owner removal protection
    if (targetRole === OrgRole.OWNER) {
      const ownerCount = await prisma.organizationMember.count({
        where: { organizationId, role: OrgRole.OWNER },
      });

      if (ownerCount <= 1) {
        throw new ValidationError('Cannot remove the sole Organization OWNER. Transfer ownership first.');
      }
    }

    await prisma.organizationMember.delete({
      where: { id: targetMember.id },
    });

    return { message: 'Member removed successfully' };
  }
}
