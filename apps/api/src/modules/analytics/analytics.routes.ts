import { Router } from 'express';
import { authenticate, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { AnalyticsController } from './analytics.controller';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});
router.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

/**
 * Overview Analytics (KPI Cards, Time-Series, Intelligence Signals)
 * Permission: analytics:read
 */
router.get(
  '/overview',
  requirePermission('analytics:read'),
  (req, res, next) => {
    void AnalyticsController.getOverview(req, res, next);
  },
);

/**
 * Service Reliability Rankings
 * Permission: analytics:read
 */
router.get(
  '/services',
  requirePermission('analytics:read'),
  (req, res, next) => {
    void AnalyticsController.getServices(req, res, next);
  },
);

/**
 * Candidate Deployment Correlations
 * Permission: analytics:read
 */
router.get(
  '/deployments',
  requirePermission('analytics:read'),
  (req, res, next) => {
    void AnalyticsController.getDeployments(req, res, next);
  },
);

/**
 * Engineering Intelligence Signals
 * Permission: analytics:read
 */
router.get(
  '/intelligence-signals',
  requirePermission('analytics:read'),
  (req, res, next) => {
    void AnalyticsController.getSignals(req, res, next);
  },
);

/**
 * Drilldown Endpoint
 * Permission: analytics:read
 */
router.get(
  '/drilldown',
  requirePermission('analytics:read'),
  (req, res, next) => {
    void AnalyticsController.getDrilldown(req, res, next);
  },
);

export { router as analyticsRouter };
