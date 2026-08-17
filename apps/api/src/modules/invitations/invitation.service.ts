import { prisma } from '../../lib/prisma';
import { hashToken, generateRandomToken } from '../../utils/crypto';
import { OrgRole, InvitationStatus } from '@incidenthub/shared';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../../utils/errors';
import type { CreateInvitationInput } from './invitation.schema';

export class InvitationService {
  static async createInvitation(
    organizationId: string,
    invitedByUserId: string,
    input: CreateInvitationInput,
  ) {
    const requesterMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: invitedByUserId,
        },
      },
    });

    if (!requesterMember) {
      throw new ForbiddenError('Access denied');
    }

    const requesterRole = requesterMember.role as unknown as OrgRole;

    // Role Escalation Protection: ADMIN or lower cannot invite an OWNER
    if (input.role === OrgRole.OWNER && requesterRole !== OrgRole.OWNER) {
      throw new ForbiddenError('Only an Organization OWNER can issue an invitation for the OWNER role');
    }

    // Check if target email is already an active member of the organization
    const existingMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId,
        user: { email: input.email.toLowerCase() },
      },
    });

    if (existingMember) {
      throw new ConflictError('User with this email is already a member of the organization');
    }

    // Generate cryptographically random token string
    const rawToken = generateRandomToken(32);
    const tokenHash = hashToken(rawToken);

    // Delete any previous pending invitation for this email in this org
    await prisma.invitation.deleteMany({
      where: {
        organizationId,
        email: input.email.toLowerCase(),
        status: InvitationStatus.PENDING,
      },
    });

    const invitation = await prisma.invitation.create({
      data: {
        organizationId,
        email: input.email.toLowerCase(),
        role: input.role,
        tokenHash,
        invitedById: invitedByUserId,
        status: InvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
      include: {
        organization: true,
        invitedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    const isDevMode = process.env['NODE_ENV'] !== 'production';
    const baseUrl = process.env['CLIENT_URL'] || 'http://localhost:5173';
    const inviteUrl = isDevMode ? `${baseUrl}/accept-invitation?token=${rawToken}` : undefined;

    return {
      invitation: {
        id: invitation.id,
        organizationId: invitation.organizationId,
        email: invitation.email,
        role: invitation.role as unknown as OrgRole,
        invitedById: invitation.invitedById,
        status: invitation.status as unknown as InvitationStatus,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
        invitedBy: invitation.invitedBy,
        organization: {
          id: invitation.organization.id,
          name: invitation.organization.name,
          slug: invitation.organization.slug,
          logoUrl: invitation.organization.logoUrl,
          createdAt: invitation.organization.createdAt.toISOString(),
          updatedAt: invitation.organization.updatedAt.toISOString(),
        },
      },
      inviteUrl,
    };
  }

  static async getInvitations(organizationId: string) {
    const invitations = await prisma.invitation.findMany({
      where: { organizationId },
      include: {
        invitedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map((inv) => ({
      id: inv.id,
      organizationId: inv.organizationId,
      email: inv.email,
      role: inv.role as unknown as OrgRole,
      invitedById: inv.invitedById,
      status: inv.status as unknown as InvitationStatus,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      invitedBy: inv.invitedBy,
    }));
  }

  static async acceptInvitation(rawToken: string, acceptingUserId?: string) {
    const tokenHash = hashToken(rawToken);

    const invitation = await prisma.invitation.findUnique({
      where: { tokenHash },
      include: { organization: true },
    });

    if (!invitation || (invitation.status as unknown as InvitationStatus) !== InvitationStatus.PENDING) {
      throw new ValidationError('Invalid, revoked, or already accepted invitation token');
    }

    if (invitation.expiresAt < new Date()) {
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new ValidationError('Invitation token has expired');
    }

    const userToLink = acceptingUserId
      ? await prisma.user.findUnique({ where: { id: acceptingUserId } })
      : await prisma.user.findUnique({ where: { email: invitation.email } });

    if (!userToLink) {
      return {
        success: true,
        requiresRegistration: true,
        email: invitation.email,
        role: invitation.role as unknown as OrgRole,
        organizationName: invitation.organization.name,
      };
    }

    // Connect user to organization
    const member = await prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED },
      });

      return tx.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId: userToLink.id,
          },
        },
        create: {
          organizationId: invitation.organizationId,
          userId: userToLink.id,
          role: invitation.role,
        },
        update: {
          role: invitation.role,
        },
        include: { organization: true },
      });
    });

    return {
      success: true,
      requiresRegistration: false,
      organizationId: member.organizationId,
      organizationName: member.organization.name,
      role: member.role as unknown as OrgRole,
    };
  }

  static async resendInvitation(organizationId: string, invitationId: string) {
    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
    });

    if (!invitation) {
      throw new NotFoundError('Invitation not found');
    }

    const newRawToken = generateRandomToken(32);
    const newTokenHash = hashToken(newRawToken);

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        tokenHash: newTokenHash,
        status: InvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const isDevMode = process.env['NODE_ENV'] !== 'production';
    const baseUrl = process.env['CLIENT_URL'] || 'http://localhost:5173';
    const inviteUrl = isDevMode ? `${baseUrl}/accept-invitation?token=${newRawToken}` : undefined;

    return {
      message: 'Invitation resent successfully',
      inviteUrl,
    };
  }

  static async revokeInvitation(organizationId: string, invitationId: string) {
    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
    });

    if (!invitation) {
      throw new NotFoundError('Invitation not found');
    }

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.REVOKED },
    });

    return { message: 'Invitation revoked successfully' };
  }

  static async getDevInvitationUrl(organizationId: string, invitationId: string) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new ForbiddenError('Development invitation links are disabled in production environments');
    }

    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
    });

    if (!invitation) {
      throw new NotFoundError('Invitation not found');
    }

    if ((invitation.status as unknown as InvitationStatus) !== InvitationStatus.PENDING) {
      throw new ValidationError('Only pending invitations have active invitation links');
    }

    const newRawToken = generateRandomToken(32);
    const newTokenHash = hashToken(newRawToken);

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        tokenHash: newTokenHash,
      },
    });

    const baseUrl = process.env['CLIENT_URL'] || 'http://localhost:5173';
    const inviteUrl = `${baseUrl}/accept-invitation?token=${newRawToken}`;

    return {
      invitationId: invitation.id,
      email: invitation.email,
      inviteUrl,
    };
  }
}
