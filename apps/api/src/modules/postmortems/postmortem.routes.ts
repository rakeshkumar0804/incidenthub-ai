import { Router } from 'express';
import { authenticate, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { PostmortemController } from './postmortem.controller';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});
router.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

/**
 * Generate AI Postmortem draft.
 * Permission: incidents:update (RESPONDER, ADMIN, OWNER)
 */
router.post(
  '/',
  requirePermission('incidents:update'),
  (req, res, next) => {
    void PostmortemController.generatePostmortem(req, res, next);
  },
);

router.post(
  '/generate',
  requirePermission('incidents:update'),
  (req, res, next) => {
    void PostmortemController.generatePostmortem(req, res, next);
  },
);

/**
 * Retrieve Postmortem document and versions.
 * Permission: incidents:read (VIEWER, RESPONDER, ADMIN, OWNER)
 */
router.get(
  '/',
  requirePermission('incidents:read'),
  (req, res, next) => {
    void PostmortemController.getPostmortem(req, res, next);
  },
);

/**
 * Edit Postmortem active version or update status (DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED).
 * Permission: incidents:update (RESPONDER, ADMIN, OWNER)
 */
router.patch(
  '/',
  requirePermission('incidents:update'),
  (req, res, next) => {
    void PostmortemController.updatePostmortem(req, res, next);
  },
);

/**
 * Create structured Action Item attached to Postmortem.
 * Permission: incidents:update (RESPONDER, ADMIN, OWNER)
 */
router.post(
  '/action-items',
  requirePermission('incidents:update'),
  (req, res, next) => {
    void PostmortemController.createActionItem(req, res, next);
  },
);

/**
 * Update structured Action Item status or priority.
 * Permission: incidents:update (RESPONDER, ADMIN, OWNER)
 */
router.patch(
  '/action-items/:actionItemId',
  requirePermission('incidents:update'),
  (req, res, next) => {
    void PostmortemController.updateActionItem(req, res, next);
  },
);

export { router as postmortemRouter };
