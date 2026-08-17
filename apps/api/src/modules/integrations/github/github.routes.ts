import { Router } from 'express';
import { authenticate, requireOrgMember } from '../../../middleware/auth';
import { requirePermission } from '../../../middleware/rbac';
import { GitHubController } from './github.controller';

const orgGithubRouter = Router({ mergeParams: true });
const githubWebhookRouter = Router();

orgGithubRouter.use((req, res, next) => {
  void authenticate(req, res, next);
});
orgGithubRouter.use((req, res, next) => {
  void requireOrgMember(req, res, next);
});

// Integration Management
orgGithubRouter.get(
  '/',
  requirePermission('integrations:read'),
  (req, res, next) => {
    void GitHubController.getIntegration(req, res, next);
  },
);

orgGithubRouter.post(
  '/connect-app',
  requirePermission('integrations:manage'),
  (req, res, next) => {
    void GitHubController.connectApp(req, res, next);
  },
);

orgGithubRouter.post(
  '/connect-pat',
  requirePermission('integrations:manage'),
  (req, res, next) => {
    void GitHubController.connectPat(req, res, next);
  },
);

orgGithubRouter.delete(
  '/disconnect',
  requirePermission('integrations:manage'),
  (req, res, next) => {
    void GitHubController.disconnect(req, res, next);
  },
);

// Repositories
orgGithubRouter.get(
  '/repositories',
  requirePermission('integrations:read'),
  (req, res, next) => {
    void GitHubController.getRepositories(req, res, next);
  },
);

orgGithubRouter.post(
  '/repositories/sync',
  requirePermission('integrations:manage'),
  (req, res, next) => {
    void GitHubController.syncRepos(req, res, next);
  },
);

orgGithubRouter.patch(
  '/repositories/:repositoryId/link',
  requirePermission('integrations:manage'),
  (req, res, next) => {
    void GitHubController.linkRepository(req, res, next);
  },
);

// Repository Activities
orgGithubRouter.get(
  '/repositories/:repositoryId/commits',
  requirePermission('integrations:read'),
  (req, res, next) => {
    void GitHubController.getCommits(req, res, next);
  },
);

orgGithubRouter.get(
  '/repositories/:repositoryId/pull-requests',
  requirePermission('integrations:read'),
  (req, res, next) => {
    void GitHubController.getPullRequests(req, res, next);
  },
);

orgGithubRouter.get(
  '/repositories/:repositoryId/deployments',
  requirePermission('integrations:read'),
  (req, res, next) => {
    void GitHubController.getDeployments(req, res, next);
  },
);

orgGithubRouter.get(
  '/repositories/:repositoryId/workflows',
  requirePermission('integrations:read'),
  (req, res, next) => {
    void GitHubController.getWorkflowRuns(req, res, next);
  },
);

// Incident Activity Linking
orgGithubRouter.post(
  '/incidents/:incidentId/link',
  requirePermission('incidents:comment'),
  (req, res, next) => {
    void GitHubController.linkIncidentActivity(req, res, next);
  },
);

// Webhook Receiver
githubWebhookRouter.post(
  '/',
  (req, res, next) => {
    void GitHubController.handleWebhook(req, res, next);
  },
);

export { orgGithubRouter, githubWebhookRouter };
