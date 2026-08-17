import { Router } from 'express';
import { healthRouter } from './health';
import { authRouter } from '../modules/auth/auth.routes';
import { organizationsRouter } from '../modules/organizations/organization.routes';
import { membersRouter } from '../modules/members/member.routes';
import { orgInvitationsRouter, publicInvitationsRouter } from '../modules/invitations/invitation.routes';
import { orgTeamsRouter, rootTeamsRouter } from '../modules/teams/team.routes';
import { orgProjectsRouter, rootProjectsRouter } from '../modules/projects/project.routes';
import { projectServicesRouter, rootServicesRouter } from '../modules/services/service.routes';
import { orgIncidentsRouter, rootIncidentsRouter } from '../modules/incidents/incident.routes';
import { commentsRouter } from '../modules/comments/comment.routes';
import { orgGithubRouter, githubWebhookRouter } from '../modules/integrations/github/github.routes';
import { orgSentryRouter, sentryWebhookRouter } from '../modules/integrations/sentry/sentry.routes';
import { correlationRouter } from '../modules/correlation/correlation.routes';
import { aiRouter } from '../modules/ai/ai.routes';
import { replayRouter } from '../modules/replay/replay.routes';
import { postmortemRouter } from '../modules/postmortems/postmortem.routes';
import { analyticsRouter } from '../modules/analytics/analytics.routes';
import { slackRouter, slackCallbackRouter, slackWebhookRouter } from '../modules/integrations/slack/slack.routes';
import { jiraRouter, jiraCallbackRouter, jiraWebhookRouter } from '../modules/integrations/jira/jira.routes';

const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);

// Organizations & nested resources
router.use('/organizations', organizationsRouter);
router.use('/organizations/:organizationId/members', membersRouter);
router.use('/organizations/:organizationId/invitations', orgInvitationsRouter);
router.use('/invitations', publicInvitationsRouter);

// Teams
router.use('/organizations/:organizationId/teams', orgTeamsRouter);
router.use('/teams', rootTeamsRouter);

// Projects
router.use('/organizations/:organizationId/projects', orgProjectsRouter);
router.use('/projects', rootProjectsRouter);

// Services
router.use('/projects/:projectId/services', projectServicesRouter);
router.use('/services', rootServicesRouter);

// Incidents (Phase 4)
router.use('/organizations/:organizationId/incidents', orgIncidentsRouter);
router.use('/incidents', rootIncidentsRouter);

// Comments (Phase 5)
router.use('/organizations/:organizationId/incidents/:incidentId/comments', commentsRouter);
router.use('/incidents/:incidentId/comments', commentsRouter);

// Analytics + Engineering Intelligence (Phase 12)
router.use('/organizations/:organizationId/analytics', analyticsRouter);

// Correlation Engine (Phase 8)
router.use('/organizations/:organizationId/incidents/:incidentId/correlation', correlationRouter);
router.use('/incidents/:incidentId/correlation', correlationRouter);

// AI Investigation Engine (Phase 9)
router.use('/organizations/:organizationId/incidents/:incidentId/investigation', aiRouter);
router.use('/incidents/:incidentId/investigation', aiRouter);

// Incident Replay Engine (Phase 10)
router.use('/organizations/:organizationId/incidents/:incidentId/replay', replayRouter);
router.use('/incidents/:incidentId/replay', replayRouter);

// AI Postmortem Engine (Phase 11)
router.use('/organizations/:organizationId/incidents/:incidentId/postmortem', postmortemRouter);
router.use('/incidents/:incidentId/postmortem', postmortemRouter);

// GitHub Integration (Phase 6)
router.use('/organizations/:organizationId/integrations/github', orgGithubRouter);
router.use('/webhooks/github', githubWebhookRouter);

// Sentry Integration (Phase 7)
router.use('/organizations/:organizationId/integrations/sentry', orgSentryRouter);
router.use('/webhooks/sentry', sentryWebhookRouter);

// Slack Integration (Phase 13)
router.use('/organizations/:organizationId/integrations/slack', slackRouter);
router.use('/integrations/slack', slackCallbackRouter);
router.use('/webhooks', slackWebhookRouter);

// Jira Integration (Phase 13)
router.use('/organizations/:organizationId/integrations/jira', jiraRouter);
router.use('/integrations/jira', jiraCallbackRouter);
router.use('/webhooks', jiraWebhookRouter);

export { router as apiRouter };
