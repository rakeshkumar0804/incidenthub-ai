import { Router } from 'express';
import { authenticate, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { CorrelationController } from './correlation.controller';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});
router.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

// GET /api/v1/organizations/:organizationId/incidents/:incidentId/correlation
router.get(
  '/',
  requirePermission('incidents:read'),
  (req, res, next) => {
    void CorrelationController.getCorrelationEvidence(req, res, next);
  },
);

// GET /api/v1/organizations/:organizationId/incidents/:incidentId/correlation/runs
router.get(
  '/runs',
  requirePermission('incidents:read'),
  (req, res, next) => {
    void CorrelationController.getCorrelationRuns(req, res, next);
  },
);

// POST /api/v1/organizations/:organizationId/incidents/:incidentId/correlation
router.post(
  '/',
  requirePermission('incidents:update'),
  (req, res, next) => {
    void CorrelationController.triggerCorrelation(req, res, next);
  },
);

// PATCH /api/v1/organizations/:organizationId/incidents/:incidentId/correlation/evidence/:evidenceId
router.patch(
  '/evidence/:evidenceId',
  requirePermission('incidents:update'),
  (req, res, next) => {
    void CorrelationController.updateEvidenceStatus(req, res, next);
  },
);

export { router as correlationRouter };
