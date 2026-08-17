import { Router } from 'express';
import { MemberController } from './member.controller';
import { authenticate, requireAuth, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';

const router = Router({ mergeParams: true });

// GET /api/v1/organizations/:organizationId/members
router.get(
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
    void MemberController.list(req, res, next);
  },
);

// PATCH /api/v1/organizations/:organizationId/members/:memberId
router.patch(
  '/:memberId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('members:manage'),
  (req, res, next) => {
    void MemberController.updateRole(req, res, next);
  },
);

// DELETE /api/v1/organizations/:organizationId/members/:memberId
router.delete(
  '/:memberId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('members:manage'),
  (req, res, next) => {
    void MemberController.remove(req, res, next);
  },
);

export { router as membersRouter };
