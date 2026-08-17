import { Router } from 'express';
import { ProjectController } from './project.controller';
import { authenticate, requireAuth, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';

const orgProjectsRouter = Router({ mergeParams: true });
const rootProjectsRouter = Router();

// GET /api/v1/organizations/:organizationId/projects
orgProjectsRouter.get(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('projects:read'),
  (req, res, next) => {
    void ProjectController.list(req, res, next);
  },
);

// POST /api/v1/organizations/:organizationId/projects
orgProjectsRouter.post(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('projects:manage'),
  (req, res, next) => {
    void ProjectController.create(req, res, next);
  },
);

// GET /api/v1/projects/:projectId
rootProjectsRouter.get(
  '/:projectId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void ProjectController.getById(req, res, next);
  },
);

// PATCH /api/v1/projects/:projectId
rootProjectsRouter.patch(
  '/:projectId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void ProjectController.update(req, res, next);
  },
);

// DELETE /api/v1/projects/:projectId
rootProjectsRouter.delete(
  '/:projectId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void ProjectController.delete(req, res, next);
  },
);

export { orgProjectsRouter, rootProjectsRouter };
