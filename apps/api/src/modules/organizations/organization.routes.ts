import { Router } from 'express';
import { OrganizationController } from './organization.controller';
import { authenticate, requireAuth, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';

const router = Router();

// Create new organization
router.post('/', (req, res, next) => {
  void authenticate(req, res, () => {
    requireAuth(req, res, () => {
      void OrganizationController.create(req, res, next);
    });
  });
});

// List user's organizations
router.get('/', (req, res, next) => {
  void authenticate(req, res, () => {
    requireAuth(req, res, () => {
      void OrganizationController.list(req, res, next);
    });
  });
});

// View specific organization
router.get(
  '/:organizationId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('organization:read'),
  (req, res, next) => {
    void OrganizationController.getById(req, res, next);
  },
);

// Update organization
router.patch(
  '/:organizationId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('organization:update'),
  (req, res, next) => {
    void OrganizationController.update(req, res, next);
  },
);

// Delete organization (Requires OWNER + slug confirmation)
router.delete(
  '/:organizationId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void requireOrgMember(req, res, next);
  },
  requirePermission('organization:update'),
  (req, res, next) => {
    void OrganizationController.delete(req, res, next);
  },
);

export { router as organizationsRouter };
