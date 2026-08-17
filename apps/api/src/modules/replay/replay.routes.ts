import { Router } from 'express';
import { authenticate, requireOrgMember } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { ReplayController } from './replay.controller';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});
router.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

/**
 * Trigger Incident Replay timeline reconstruction.
 * Required Permission: incidents:update (RESPONDER, ADMIN, OWNER)
 */
router.post(
  '/',
  requirePermission('incidents:update'),
  (req, res, next) => {
    void ReplayController.triggerReplay(req, res, next);
  },
);

/**
 * Retrieve latest Incident Replay timeline reconstruction.
 * Required Permission: incidents:read (VIEWER, RESPONDER, ADMIN, OWNER)
 */
router.get(
  '/',
  requirePermission('incidents:read'),
  (req, res, next) => {
    void ReplayController.getLatestReplay(req, res, next);
  },
);

/**
 * Retrieve historical Incident Replay runs.
 * Required Permission: incidents:read (VIEWER, RESPONDER, ADMIN, OWNER)
 */
router.get(
  '/runs',
  requirePermission('incidents:read'),
  (req, res, next) => {
    void ReplayController.getReplayRuns(req, res, next);
  },
);

export { router as replayRouter };
