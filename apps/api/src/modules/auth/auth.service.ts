import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { hashPassword, comparePassword, hashToken, generateRandomToken } from '../../utils/crypto';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { ConflictError, UnauthorizedError, ValidationError, NotFoundError, ForbiddenError } from '../../utils/errors';
import { OrgRole } from '@incidenthub/shared';
import type { UserDto, OrgMemberDto, AuthResponseData } from '@incidenthub/shared';
import type { RegisterInput, LoginInput, ResetPasswordInput } from './auth.schema';

function formatUserDto(user: {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
  createdAt: Date;
}): UserDto {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}

function formatOrgMemberDto(member: {
  id: string;
  organizationId: string;
  userId: string;
  role: string | OrgRole;
  joinedAt: Date;
  organization: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
}): OrgMemberDto {
  return {
    id: member.id,
    organizationId: member.organizationId,
    userId: member.userId,
    role: member.role as OrgRole,
    joinedAt: member.joinedAt.toISOString(),
    organization: {
      id: member.organization.id,
      name: member.organization.name,
      slug: member.organization.slug,
      logoUrl: member.organization.logoUrl,
    },
  };
}

function sortOrganizationsPrioritizingAcme<T extends { organization: { slug: string; name: string } }>(orgs: T[]): T[] {
  return [...orgs].sort((a, b) => {
    if (a.organization.slug === 'acme-engineering' || a.organization.name === 'Acme Engineering') return -1;
    if (b.organization.slug === 'acme-engineering' || b.organization.name === 'Acme Engineering') return 1;
    return 0;
  });
}


export class AuthService {
  /**
   * Registers a new user, creates their default Organization, sets them as OWNER,
   * and issues initial tokens & verification token.
   */
  static async register(input: RegisterInput, userAgent?: string, ipAddress?: string) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictError('A user with this email address already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const slugBase = input.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'org';
    const orgSlug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;

    const rawVerificationToken = generateRandomToken();
    const hashedVerificationToken = hashToken(rawVerificationToken);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email.toLowerCase(),
          name: input.name,
          passwordHash,
          emailVerified: false,
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: `${input.name}'s Org`,
          slug: orgSlug,
        },
      });

      const member = await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: OrgRole.OWNER,
        },
        include: { organization: true },
      });

      await tx.verificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashedVerificationToken,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        },
      });

      return { user, member };
    });

    // Create session & tokens
    const family = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const refreshToken = signRefreshToken(result.user.id, sessionId, family);
    const accessToken = signAccessToken(result.user.id, result.user.email);
    const hashedRefreshToken = hashToken(refreshToken);

    await prisma.session.create({
      data: {
        id: sessionId,
        userId: result.user.id,
        tokenHash: hashedRefreshToken,
        family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        userAgent,
        ipAddress,
      },
    });

    // Auto-link newly registered user to Acme Engineering if present
    const acmeOrg = await prisma.organization.findUnique({
      where: { slug: 'acme-engineering' },
    });

    let acmeMember = null;
    if (acmeOrg) {
      acmeMember = await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: acmeOrg.id,
            userId: result.user.id,
          },
        },
        update: {},
        create: {
          organizationId: acmeOrg.id,
          userId: result.user.id,
          role: OrgRole.ADMIN,
        },
        include: { organization: true },
      });
    }

    const allMembers = [
      ...(acmeMember ? [acmeMember] : []),
      result.member,
    ];
    const sortedMembers = sortOrganizationsPrioritizingAcme(allMembers);
    const activeOrganizationId = sortedMembers[0]?.organizationId || result.member.organizationId;

    const authData: AuthResponseData = {
      user: formatUserDto(result.user),
      accessToken,
      activeOrganizationId,
      organizations: sortedMembers.map(formatOrgMemberDto),
    };

    return {
      authData,
      refreshToken,
      verificationToken: rawVerificationToken,
    };
  }

  /**
   * Log in user with email & password. Issues access token + refresh token session.
   */
  static async login(input: LoginInput, userAgent?: string, ipAddress?: string) {
    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: {
        organizationMembers: {
          include: { organization: true },
        },
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await comparePassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const family = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const refreshToken = signRefreshToken(user.id, sessionId, family);
    const accessToken = signAccessToken(user.id, user.email);
    const hashedRefreshToken = hashToken(refreshToken);

    await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: hashedRefreshToken,
        family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent,
        ipAddress,
      },
    });

    const sortedMembers = sortOrganizationsPrioritizingAcme(user.organizationMembers);
    const activeOrgId = sortedMembers[0]?.organizationId;

    const authData: AuthResponseData = {
      user: formatUserDto(user),
      accessToken,
      activeOrganizationId: activeOrgId,
      organizations: sortedMembers.map(formatOrgMemberDto),
    };

    return {
      authData,
      refreshToken,
    };
  }


  /**
   * Logs out user by revoking the refresh token session.
   */
  static async logout(refreshTokenStr?: string): Promise<void> {
    if (!refreshTokenStr) return;
    const hashed = hashToken(refreshTokenStr);
    await prisma.session.updateMany({
      where: { tokenHash: hashed },
      data: { isRevoked: true },
    });
  }

  /**
   * Rotates refresh token & issues new access token. Detects token reuse attacks.
   */
  static async refreshTokens(rawRefreshToken: string, userAgent?: string, ipAddress?: string) {
    const payload = verifyRefreshToken(rawRefreshToken);
    if (!payload) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const hashed = hashToken(rawRefreshToken);
    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedError('Session not found');
    }

    // Reuse detection: If session is revoked, invalidate entire token family!
    if (session.isRevoked) {
      await prisma.session.updateMany({
        where: { family: session.family },
        data: { isRevoked: true },
      });
      throw new UnauthorizedError('Compromised session detected. All sessions invalidated. Please log in again.');
    }

    if (session.tokenHash !== hashed) {
      throw new UnauthorizedError('Refresh token mismatch');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token expired');
    }

    // Revoke old session
    await prisma.session.update({
      where: { id: session.id },
      data: { isRevoked: true },
    });

    // Create rotated new session in same family
    const newSessionId = crypto.randomUUID();
    const newRefreshToken = signRefreshToken(session.userId, newSessionId, session.family);
    const newAccessToken = signAccessToken(session.userId, session.user.email);
    const newHashedRefreshToken = hashToken(newRefreshToken);

    await prisma.session.create({
      data: {
        id: newSessionId,
        userId: session.userId,
        tokenHash: newHashedRefreshToken,
        family: session.family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent,
        ipAddress,
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Returns authenticated user profile and organization memberships.
   */
  static async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        organizationMembers: {
          include: { organization: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const sortedMembers = sortOrganizationsPrioritizingAcme(user.organizationMembers);

    return {
      user: formatUserDto(user),
      activeOrganizationId: sortedMembers[0]?.organizationId,
      organizations: sortedMembers.map(formatOrgMemberDto),
    };
  }


  /**
   * Generates password reset token.
   */
  static async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return { message: 'If an account exists, a password reset link has been generated.', resetToken: null };
    }

    const rawToken = generateRandomToken();
    const hashed = hashToken(rawToken);

    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashed,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    return {
      message: 'If an account exists, a password reset link has been generated.',
      resetToken: rawToken,
    };
  }

  /**
   * Resets password using token, updates passwordHash, and revokes all active sessions.
   */
  static async resetPassword(input: ResetPasswordInput) {
    const hashed = hashToken(input.token);
    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashed },
    });

    if (!resetRecord || resetRecord.expiresAt < new Date()) {
      throw new ValidationError('Invalid or expired password reset token');
    }

    const passwordHash = await hashPassword(input.newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash },
      });

      await tx.passwordResetToken.delete({ where: { id: resetRecord.id } });

      // Revoke all sessions on password change
      await tx.session.updateMany({
        where: { userId: resetRecord.userId },
        data: { isRevoked: true },
      });
    });

    return { message: 'Password reset successfully. Please log in with your new password.' };
  }

  /**
   * Verifies email using verification token.
   */
  static async verifyEmail(token: string) {
    const hashed = hashToken(token);
    const record = await prisma.verificationToken.findUnique({
      where: { tokenHash: hashed },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new ValidationError('Invalid or expired email verification token');
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerified: true },
      });

      await tx.verificationToken.delete({ where: { id: record.id } });
    });

    return { message: 'Email verified successfully.' };
  }

  /**
   * Resends verification email token.
   */
  static async resendVerification(email: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user || user.emailVerified) {
      return { message: 'Verification link sent if eligible.' };
    }

    const rawToken = generateRandomToken();
    const hashed = hashToken(rawToken);

    await prisma.verificationToken.deleteMany({ where: { userId: user.id } });
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashed,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    return { message: 'Verification link sent.', verificationToken: rawToken };
  }

  /**
   * Development-only recovery mechanism to restore OWNER role for rakesh6651@company.com in Rakesh's Org.
   */
  static async devRestoreOwner(): Promise<{ message: string; user: UserDto; activeOrganizationId: string; organizations: OrgMemberDto[] }> {
    if (process.env['NODE_ENV'] === 'production') {
      throw new ForbiddenError('Development features are disabled in production environments');
    }

    const email = 'rakesh6651@company.com';
    const name = 'Rakesh Rajput';
    const password = 'Password123!';
    const passwordHash = await hashPassword(password);

    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          emailVerified: true,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, emailVerified: true },
      });
    }

    let org = await prisma.organization.findFirst({
      where: { slug: 'rakesh-org' },
    });

    if (!org) {
      org = await prisma.organization.findFirst({
        where: { name: "Rakesh's Org" },
      });
    }

    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: "Rakesh's Org",
          slug: 'rakesh-org',
        },
      });
    }

    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: user.id,
        },
      },
    });

    if (!member) {
      await prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: OrgRole.OWNER,
        },
      });
    } else {
      await prisma.organizationMember.update({
        where: { id: member.id },
        data: { role: OrgRole.OWNER },
      });
    }

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        organizationMembers: {
          include: { organization: true },
        },
      },
    });

    return {
      message: 'Owner role successfully restored in development environment',
      user: formatUserDto(updatedUser),
      activeOrganizationId: org.id,
      organizations: updatedUser.organizationMembers.map(formatOrgMemberDto),
    };
  }

  /**
   * Development-only password recovery mechanism for VIEWER user (rakesh5566@company.com).
   * Ensures user exists, resets password, and guarantees VIEWER role in organization.
   */
  static async devResetViewerPassword(): Promise<{ message: string; user: UserDto; activeOrganizationId: string; organizations: OrgMemberDto[] }> {
    if (process.env['NODE_ENV'] === 'production') {
      throw new ForbiddenError('Development features are disabled in production environments');
    }

    const email = 'rakesh5566@company.com';
    const password = 'Password123!';
    const passwordHash = await hashPassword(password);

    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: 'Rakesh Viewer',
          passwordHash,
          emailVerified: true,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, emailVerified: true },
      });
    }

    let org = await prisma.organization.findFirst({
      where: { slug: 'rakesh-org' },
    });

    if (!org) {
      org = await prisma.organization.findFirst({
        where: { name: "Rakesh's Org" },
      });
    }

    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: "Rakesh's Org",
          slug: 'rakesh-org',
        },
      });
    }

    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: org.id,
          userId: user.id,
        },
      },
    });

    if (!member) {
      await prisma.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: OrgRole.VIEWER,
        },
      });
    } else {
      await prisma.organizationMember.update({
        where: { id: member.id },
        data: { role: OrgRole.VIEWER },
      });
    }

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        organizationMembers: {
          include: { organization: true },
        },
      },
    });

    return {
      message: 'Viewer password successfully reset in development environment',
      user: formatUserDto(updatedUser),
      activeOrganizationId: org.id,
      organizations: updatedUser.organizationMembers.map(formatOrgMemberDto),
    };
  }

  static async seedDemoData(): Promise<unknown> {
    const { runDemoSeeding } = await import('../../utils/seedDemo');
    return runDemoSeeding(prisma);
  }

  static async cleanDemoOrgs(): Promise<unknown> {
    const { cleanupExtraOrganizations } = await import('../../utils/cleanupOrgs');
    return cleanupExtraOrganizations(prisma);
  }
}


