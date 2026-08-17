import { Router } from 'express';
import { JiraController } from './jira.controller';
import { authenticate, requireOrgMember } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/rbac';

const router = Router({ mergeParams: true });

router.use((req, res, next) => {
  void authenticate(req, res, next);
});
router.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

router.get('/connect', requirePermission('integrations:manage'), JiraController.initiateOAuth);
router.post('/connect-token', requirePermission('integrations:manage'), (req, res, next) => {
  void JiraController.connectApiToken(req, res, next);
});
router.delete('/disconnect', requirePermission('integrations:manage'), (req, res, next) => {
  void JiraController.disconnect(req, res, next);
});
router.post('/incidents/:incidentId/action-items/:actionItemId/jira-issue', requirePermission('incidents:update'), (req, res, next) => {
  void JiraController.createJiraIssue(req, res, next);
});

export { router as jiraRouter };

const callbackRouter = Router();
callbackRouter.get('/callback', (req, res, next) => {
  void JiraController.handleCallback(req, res, next);
});
export { callbackRouter as jiraCallbackRouter };

const webhookRouter = Router();
webhookRouter.post('/jira', (req, res, next) => {
  void JiraController.handleWebhook(req, res, next);
});
export { webhookRouter as jiraWebhookRouter };
