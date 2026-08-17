import type { Request, Response, NextFunction } from 'express';
import { OrgRole } from '@incidenthub/shared';
import type { Permission } from '@incidenthub/shared';
import { ForbiddenError, UnauthorizedError } from '../utils/errors';

/**
 * Role-Based Access Control (RBAC) Permission Matrix.
 * Maps OrgRole to its explicit set of granted permissions.
 */
export const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  [OrgRole.OWNER]: [
    'organization:read',
    'organization:update',
    'members:read',
    'members:manage',
    'teams:read',
    'teams:manage',
    'projects:read',
    'projects:manage',
    'incidents:read',
    'incidents:create',
    'incidents:update',
    'incidents:delete',
    'incidents:comment',
    'incidents:assign',
    'analytics:read',
    'integrations:read',
    'integrations:manage',
  ],
  [OrgRole.ADMIN]: [
    'organization:read',
    'organization:update',
    'members:read',
    'members:manage',
    'teams:read',
    'teams:manage',
    'projects:read',
    'projects:manage',
    'incidents:read',
    'incidents:create',
    'incidents:update',
    'incidents:delete',
    'incidents:comment',
    'incidents:assign',
    'analytics:read',
    'integrations:read',
    'integrations:manage',
  ],
  [OrgRole.RESPONDER]: [
    'organization:read',
    'members:read',
    'teams:read',
    'projects:read',
    'incidents:read',
    'incidents:create',
    'incidents:update',
    'incidents:comment',
    'incidents:assign',
    'analytics:read',
    'integrations:read',
  ],
  [OrgRole.VIEWER]: [
    'organization:read',
    'members:read',
    'teams:read',
    'projects:read',
    'incidents:read',
    'analytics:read',
    'integrations:read',
  ],
};

/**
 * Checks if a role possesses a specific permission.
 */
export function hasPermission(role: OrgRole, permission: Permission): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed ? allowed.includes(permission) : false;
}

/**
 * Middleware enforcing that the user's role in req.orgMember contains the required permission.
 * Must be used after requireOrgMember middleware.
 * Throws 403 Forbidden if permission is missing.
 */
export const requirePermission = (permission: Permission) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!req.orgMember) {
      throw new ForbiddenError('Organization membership context missing. Ensure requireOrgMember is placed before requirePermission.');
    }

    if (!hasPermission(req.orgMember.role, permission)) {
      throw new ForbiddenError(
        `Forbidden: Role '${req.orgMember.role}' does not have '${permission}' permission`,
      );
    }

    next();
  };
};

/**
 * Middleware requiring a minimum allowed role in the organization.
 */
export const requireOrgRole = (...allowedRoles: OrgRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!req.orgMember) {
      throw new ForbiddenError('Organization membership context missing.');
    }

    if (!allowedRoles.includes(req.orgMember.role)) {
      throw new ForbiddenError(
        `Forbidden: Action requires one of [${allowedRoles.join(', ')}] role`,
      );
    }

    next();
  };
};
