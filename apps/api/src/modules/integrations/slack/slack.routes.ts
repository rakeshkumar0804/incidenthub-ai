import { Router } from 'express';
import { SlackController } from './slack.controller';
import { authenticate, requireOrgMember } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/rbac';
import { requireOrgIncidentPermission } from '../../../middleware/resourceAuth';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});
router.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

router.get('/connect', requirePermission('integrations:manage'), SlackController.initiateOAuth);
router.delete('/disconnect', requirePermission('integrations:manage'), (req, res, next) => {
  void SlackController.disconnect(req, res, next);
});
router.post(
  '/incidents/:incidentId/channel',
  (req, res, next) => {
    void requireOrgIncidentPermission('incidents:update')(req, res, next);
  },
  (req, res, next) => {
    void SlackController.createChannel(req, res, next);
  },
);

export { router as slackRouter };

const callbackRouter = Router();
callbackRouter.get('/callback', (req, res, next) => {
  void SlackController.handleCallback(req, res, next);
});
export { callbackRouter as slackCallbackRouter };

const webhookRouter = Router();
webhookRouter.post(['/slack', '/slack/actions'], (req, res, next) => {
  void SlackController.handleWebhook(req, res, next);
});
export { webhookRouter as slackWebhookRouter };
