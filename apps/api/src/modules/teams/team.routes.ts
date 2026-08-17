import { Router } from 'express';
import { TeamController } from './team.controller';
import { authenticate, requireAuth, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';

const orgTeamsRouter = Router({ mergeParams: true });
const rootTeamsRouter = Router();

// GET /api/v1/organizations/:organizationId/teams
orgTeamsRouter.get(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('teams:read'),
  (req, res, next) => {
    void TeamController.list(req, res, next);
  },
);

// POST /api/v1/organizations/:organizationId/teams
orgTeamsRouter.post(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('teams:manage'),
  (req, res, next) => {
    void TeamController.create(req, res, next);
  },
);

// GET /api/v1/teams/:teamId
rootTeamsRouter.get(
  '/:teamId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void TeamController.getById(req, res, next);
  },
);

// PATCH /api/v1/teams/:teamId
rootTeamsRouter.patch(
  '/:teamId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void TeamController.update(req, res, next);
  },
);

// DELETE /api/v1/teams/:teamId
rootTeamsRouter.delete(
  '/:teamId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void TeamController.delete(req, res, next);
  },
);

// POST /api/v1/teams/:teamId/members
rootTeamsRouter.post(
  '/:teamId/members',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void TeamController.addMember(req, res, next);
  },
);

// DELETE /api/v1/teams/:teamId/members/:userId
rootTeamsRouter.delete(
  '/:teamId/members/:userId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void TeamController.removeMember(req, res, next);
  },
);

export { orgTeamsRouter, rootTeamsRouter };
