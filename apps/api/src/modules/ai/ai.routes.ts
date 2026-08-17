import { Router } from 'express';
import { authenticate, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { AIController } from './ai.controller';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});
router.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

/**
 * Trigger AI investigation for an incident.
 * Required Permission: incidents:update (RESPONDER, ADMIN, OWNER)
 */
router.post(
  '/',
  requirePermission('incidents:update'),
  (req, res, next) => {
    void AIController.triggerInvestigation(req, res, next);
  },
);

/**
 * Retrieve latest AI investigation result for an incident.
 * Required Permission: incidents:read (VIEWER, RESPONDER, ADMIN, OWNER)
 */
router.get(
  '/',
  requirePermission('incidents:read'),
  (req, res, next) => {
    void AIController.getLatestInvestigation(req, res, next);
  },
);

/**
 * Retrieve historical AI investigation runs for an incident.
 * Required Permission: incidents:read (VIEWER, RESPONDER, ADMIN, OWNER)
 */
router.get(
  '/runs',
  requirePermission('incidents:read'),
  (req, res, next) => {
    void AIController.getInvestigationRuns(req, res, next);
  },
);

export { router as aiRouter };
