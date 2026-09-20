import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireOrgIncidentPermission } from '../../middleware/resourceAuth';
import { CorrelationController } from './correlation.controller';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});

// GET /api/v1/organizations/:organizationId/incidents/:incidentId/correlation
router.get(
  '/',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:read')(req, res, next);
  },
  (req, res, next) => {
    void CorrelationController.getCorrelationEvidence(req, res, next);
  },
);

// GET /api/v1/organizations/:organizationId/incidents/:incidentId/correlation/runs
router.get(
  '/runs',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:read')(req, res, next);
  },
  (req, res, next) => {
    void CorrelationController.getCorrelationRuns(req, res, next);
  },
);

// POST /api/v1/organizations/:organizationId/incidents/:incidentId/correlation
router.post(
  '/',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:update')(req, res, next);
  },
  (req, res, next) => {
    void CorrelationController.triggerCorrelation(req, res, next);
  },
);

// PATCH /api/v1/organizations/:organizationId/incidents/:incidentId/correlation/evidence/:evidenceId
router.patch(
  '/evidence/:evidenceId',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:update')(req, res, next);
  },
  (req, res, next) => {
    void CorrelationController.updateEvidenceStatus(req, res, next);
  },
);

export { router as correlationRouter };
