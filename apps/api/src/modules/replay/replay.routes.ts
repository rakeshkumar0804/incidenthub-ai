import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireOrgIncidentPermission } from '../../middleware/resourceAuth';
import { ReplayController } from './replay.controller';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});

/**
 * Trigger Incident Replay timeline reconstruction.
 * Required Permission: incidents:update (RESPONDER, ADMIN, OWNER)
 */
router.post(
  '/',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:update')(req, res, next);
  },
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
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:read')(req, res, next);
  },
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
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:read')(req, res, next);
  },
  (req, res, next) => {
    void ReplayController.getReplayRuns(req, res, next);
  },
);

export { router as replayRouter };
