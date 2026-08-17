import { Router } from 'express';
import { authenticate, requireOrgMember } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/rbac';
import { SentryController } from './sentry.controller';

const orgRouter = Router({ mergeParams: true });
const webhookRouter = Router();

// Public Webhook Endpoint (HMAC SHA-256 Verified)
webhookRouter.post('/', (req, res, next) => {
  void SentryController.handleWebhook(req, res, next);
});

// Organization-Scoped Sentry Integration Endpoints
orgRouter.use((req, res, next) => {
  void authenticate(req, res, next);
});
orgRouter.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

// Status & Issues (Read permissions)
orgRouter.get(
  '/',
  requirePermission('integrations:read'),
  (req, res, next) => { void SentryController.getIntegrationStatus(req, res, next); },
);
orgRouter.get(
  '/issues',
  requirePermission('integrations:read'),
  (req, res, next) => { void SentryController.listIssues(req, res, next); },
);

// Trigger Rules (Read & Manage)
orgRouter.get(
  '/rules',
  requirePermission('integrations:read'),
  (req, res, next) => { void SentryController.listRules(req, res, next); },
);
orgRouter.post(
  '/rules',
  requirePermission('integrations:manage'),
  (req, res, next) => { void SentryController.createRule(req, res, next); },
);
orgRouter.delete(
  '/rules/:ruleId',
  requirePermission('integrations:manage'),
  (req, res, next) => { void SentryController.deleteRule(req, res, next); },
);

// Auth Connection & Disconnect (Manage permissions)
orgRouter.post(
  '/authorize-oauth',
  requirePermission('integrations:manage'),
  (req, res, next) => { void SentryController.authorizeOAuth(req, res, next); },
);
orgRouter.post(
  '/connect-oauth',
  requirePermission('integrations:manage'),
  (req, res, next) => { void SentryController.connectOAuth(req, res, next); },
);
orgRouter.post(
  '/connect-token',
  requirePermission('integrations:manage'),
  (req, res, next) => { void SentryController.connectToken(req, res, next); },
);
orgRouter.delete(
  '/disconnect',
  requirePermission('integrations:manage'),
  (req, res, next) => { void SentryController.disconnect(req, res, next); },
);

// Link Issue to Incident (incidents:update — available to OWNER/ADMIN/RESPONDER)
orgRouter.post(
  '/incidents/:incidentId/link',
  requirePermission('incidents:update'),
  (req, res, next) => { void SentryController.linkIssueToIncident(req, res, next); },
);

export { orgRouter as orgSentryRouter, webhookRouter as sentryWebhookRouter };
