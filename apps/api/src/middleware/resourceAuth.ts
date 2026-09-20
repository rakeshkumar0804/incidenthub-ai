import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../utils/errors';
import { hasPermission } from './rbac';
import type { Permission, OrgRole } from '@incidenthub/shared';

/**
 * Derives the owning organization from :projectId, checks membership, and enforces RBAC permission.
 * Rejects cross-tenant access with 403. Rejects missing projects with 404.
 */
export function requireProjectPermission(permission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const projectId = req.params['projectId'];
      if (!projectId) {
        throw new NotFoundError('Project ID is required');
      }

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, organizationId: true },
      });

      if (!project) {
        throw new NotFoundError('Project not found');
      }

      // Verify membership in project's owning organization
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: project.organizationId,
            userId: req.user.id,
          },
        },
      });

      if (!member) {
        throw new ForbiddenError('Access denied: You are not a member of this project\'s organization');
      }

      if (!hasPermission(member.role as OrgRole, permission)) {
        throw new ForbiddenError(`Forbidden: Role '${member.role}' does not have '${permission}' permission`);
      }

      req.orgMember = {
        organizationId: project.organizationId,
        role: member.role as OrgRole,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Derives the owning organization from :serviceId, checks membership, and enforces RBAC permission.
 * Rejects cross-tenant access with 403. Rejects missing services with 404.
 */
export function requireServicePermission(permission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const serviceId = req.params['serviceId'];
      if (!serviceId) {
        throw new NotFoundError('Service ID is required');
      }

      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        include: {
          project: { select: { organizationId: true } },
        },
      });

      if (!service) {
        throw new NotFoundError('Service not found');
      }

      const organizationId = service.project.organizationId;
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: req.user.id,
          },
        },
      });

      if (!member) {
        throw new ForbiddenError('Access denied: You are not a member of this service\'s organization');
      }

      if (!hasPermission(member.role as OrgRole, permission)) {
        throw new ForbiddenError(`Forbidden: Role '${member.role}' does not have '${permission}' permission`);
      }

      req.orgMember = {
        organizationId,
        role: member.role as OrgRole,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Derives the owning organization from :teamId, checks membership, and enforces RBAC permission.
 * Rejects cross-tenant access with 403. Rejects missing teams with 404.
 */
export function requireTeamPermission(permission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const teamId = req.params['teamId'];
      if (!teamId) {
        throw new NotFoundError('Team ID is required');
      }

      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true, organizationId: true },
      });

      if (!team) {
        throw new NotFoundError('Team not found');
      }

      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: team.organizationId,
            userId: req.user.id,
          },
        },
      });

      if (!member) {
        throw new ForbiddenError('Access denied: You are not a member of this team\'s organization');
      }

      if (!hasPermission(member.role as OrgRole, permission)) {
        throw new ForbiddenError(`Forbidden: Role '${member.role}' does not have '${permission}' permission`);
      }

      req.orgMember = {
        organizationId: team.organizationId,
        role: member.role as OrgRole,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Validates organization-scoped nested incident routes (:organizationId, :incidentId).
 * Enforces:
 * 1. User authentication (401).
 * 2. Active membership in the URL-specified organization (403).
 * 3. Existence of the incident (404).
 * 4. Strict parent-child match: incident.organizationId === URL organizationId (403).
 * 5. RBAC permission verification against the user's role in the organization (403).
 */
export function requireOrgIncidentPermission(permission: Permission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const organizationId = req.params['organizationId'];
      if (!organizationId) {
        throw new NotFoundError('Organization ID is required');
      }

      // 1. Verify user membership in URL organization
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: req.user.id,
          },
        },
      });

      if (!member) {
        throw new ForbiddenError('Access denied: You are not a member of this organization');
      }

      const incidentId = req.params['incidentId'];
      if (!incidentId) {
        throw new NotFoundError('Incident ID is required');
      }

      // 2. Verify incident exists
      const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
        select: { id: true, organizationId: true },
      });

      if (!incident) {
        throw new NotFoundError('Incident not found');
      }

      // 3. Verify strict parent-child match (no cross-tenant mismatch)
      if (incident.organizationId !== organizationId) {
        throw new ForbiddenError('Access denied: Incident does not belong to the specified organization');
      }

      // 4. Verify RBAC permission
      if (!hasPermission(member.role as OrgRole, permission)) {
        throw new ForbiddenError(`Forbidden: Role '${member.role}' does not have '${permission}' permission`);
      }

      req.orgMember = {
        organizationId,
        role: member.role as OrgRole,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

