import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { prisma } from '../lib/prisma';
import { UnauthorizedError, ForbiddenError, ValidationError } from '../utils/errors';
import type { OrgRole } from '@incidenthub/shared';

/**
 * Middleware to extract and verify the JWT access token from the request.
 * Populates req.user if valid. Does not throw if missing (allows optional auth).
 */
export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    let token: string | undefined;

    // Check Authorization header (Bearer <token>)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies && typeof (req.cookies as Record<string, unknown>)['accessToken'] === 'string') {
      token = (req.cookies as Record<string, string>)['accessToken'];
    }

    if (!token) {
      return next();
    }

    const payload = verifyAccessToken(token);
    if (!payload) {
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, name: true },
    });

    if (user) {
      req.user = user;
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Strict guard requiring an authenticated user. Throws 401 Unauthorized if missing.
 */
export const requireAuth = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }
  next();
};

/**
 * Verifies that the authenticated user is a member of the target organization.
 * Attaches req.orgMember = { organizationId, role } on success.
 * Throws 403 Forbidden if not a member or organizationId is missing.
 */
export const requireOrgMember = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const bodyObj = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

    // Extract organizationId from headers, params, query, or body
    const rawOrgId =
      (req.headers['x-organization-id'] as string) ||
      req.params['organizationId'] ||
      req.params['orgId'] ||
      (req.query['organizationId'] as string) ||
      (typeof bodyObj['organizationId'] === 'string' ? bodyObj['organizationId'] : undefined);

    if (!rawOrgId) {
      throw new ValidationError('Organization ID is required (header: x-organization-id, or param/body)');
    }

    const member = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: rawOrgId,
          userId: req.user.id,
        },
      },
      select: { organizationId: true, role: true },
    });

    if (!member) {
      throw new ForbiddenError('Access denied: You are not a member of this organization');
    }

    req.orgMember = {
      organizationId: member.organizationId,
      role: member.role as unknown as OrgRole,
    };

    next();
  } catch (error) {
    next(error);
  }
};
