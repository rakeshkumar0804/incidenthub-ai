import { Router } from 'express';
import { InvitationController } from './invitation.controller';
import { authenticate, requireAuth, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';

const orgInvitationsRouter = Router({ mergeParams: true });
const publicInvitationsRouter = Router();

// POST /api/v1/organizations/:organizationId/invitations
orgInvitationsRouter.post(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('members:manage'),
  (req, res, next) => {
    void InvitationController.create(req, res, next);
  },
);

// GET /api/v1/organizations/:organizationId/invitations
orgInvitationsRouter.get(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('members:read'),
  (req, res, next) => {
    void InvitationController.list(req, res, next);
  },
);

// POST /api/v1/organizations/:organizationId/invitations/:invitationId/resend
orgInvitationsRouter.post(
  '/:invitationId/resend',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('members:manage'),
  (req, res, next) => {
    void InvitationController.resend(req, res, next);
  },
);

// GET /api/v1/organizations/:organizationId/invitations/:invitationId/dev-url
orgInvitationsRouter.get(
  '/:invitationId/dev-url',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('members:manage'),
  (req, res, next) => {
    void InvitationController.getDevUrl(req, res, next);
  },
);

// DELETE /api/v1/organizations/:organizationId/invitations/:invitationId
orgInvitationsRouter.delete(
  '/:invitationId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('members:manage'),
  (req, res, next) => {
    void InvitationController.revoke(req, res, next);
  },
);

// POST /api/v1/invitations/:token/accept (Public / optional auth)
publicInvitationsRouter.post('/:token/accept', (req, res, next) => {
  void authenticate(req, res, () => {
    void InvitationController.accept(req, res, next);
  });
});

export { orgInvitationsRouter, publicInvitationsRouter };
