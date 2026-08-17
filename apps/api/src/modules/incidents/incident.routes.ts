import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { IncidentController } from './incident.controller';
import { authenticate, requireAuth, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { prisma } from '../../lib/prisma';
import { NotFoundError } from '../../utils/errors';

const orgIncidentsRouter = Router({ mergeParams: true });
const rootIncidentsRouter = Router();

// Middleware to resolve Incident and attach parent Organization ID to req.organization for RBAC check
async function resolveIncidentOrg(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const incidentId = req.params['incidentId'];
    if (!incidentId) {
      throw new NotFoundError('Incident ID is required');
    }

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      select: { organizationId: true },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found');
    }

    // Attach organizationId to params so requireOrgMember can extract it
    req.params['organizationId'] = incident.organizationId;
    next();
  } catch (error) {
    next(error);
  }
}

// GET /api/v1/organizations/:organizationId/incidents/metrics
orgIncidentsRouter.get(
  '/metrics',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('incidents:read'),
  (req, res, next) => {
    void IncidentController.getDashboardMetrics(req, res, next);
  },
);

// GET /api/v1/organizations/:organizationId/incidents
orgIncidentsRouter.get(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('incidents:read'),
  (req, res, next) => {
    void IncidentController.listIncidents(req, res, next);
  },
);

// POST /api/v1/organizations/:organizationId/incidents
orgIncidentsRouter.post(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('incidents:create'),
  (req, res, next) => {
    void IncidentController.createIncident(req, res, next);
  },
);

// GET /api/v1/incidents/:incidentId
rootIncidentsRouter.get(
  '/:incidentId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void resolveIncidentOrg(req, res, next);
  },
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('incidents:read'),
  (req, res, next) => {
    void IncidentController.getIncident(req, res, next);
  },
);

// PATCH /api/v1/incidents/:incidentId
rootIncidentsRouter.patch(
  '/:incidentId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void resolveIncidentOrg(req, res, next);
  },
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('incidents:update'),
  (req, res, next) => {
    void IncidentController.updateIncident(req, res, next);
  },
);

// PATCH /api/v1/incidents/:incidentId/status
rootIncidentsRouter.patch(
  '/:incidentId/status',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void resolveIncidentOrg(req, res, next);
  },
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('incidents:update'),
  (req, res, next) => {
    void IncidentController.updateStatus(req, res, next);
  },
);

// PATCH /api/v1/incidents/:incidentId/severity
rootIncidentsRouter.patch(
  '/:incidentId/severity',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void resolveIncidentOrg(req, res, next);
  },
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('incidents:update'),
  (req, res, next) => {
    void IncidentController.updateSeverity(req, res, next);
  },
);

// PATCH /api/v1/incidents/:incidentId/assignee
rootIncidentsRouter.patch(
  '/:incidentId/assignee',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void resolveIncidentOrg(req, res, next);
  },
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('incidents:assign'),
  (req, res, next) => {
    void IncidentController.updateAssignee(req, res, next);
  },
);

// GET /api/v1/incidents/:incidentId/timeline
rootIncidentsRouter.get(
  '/:incidentId/timeline',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void resolveIncidentOrg(req, res, next);
  },
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('incidents:read'),
  (req, res, next) => {
    void IncidentController.getIncidentTimeline(req, res, next);
  },
);

export { orgIncidentsRouter, rootIncidentsRouter };
