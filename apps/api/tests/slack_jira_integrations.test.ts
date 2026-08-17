import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/crypto';
import { IntegrationProvider, IntegrationStatus, IncidentSeverity, IncidentStatus, ActionItemStatus } from '@incidenthub/shared';
import { SlackService } from '../src/modules/integrations/slack/slack.service';
import { DeliveryService } from '../src/modules/integrations/delivery/delivery.service';

const app = createApp();
const request = supertest(app);

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

describe('Phase 13 — Slack + Jira Integrations Test Suite', () => {
  let orgId: string;
  let userId: string;
  let userToken: string;
  let projectId: string;
  let incidentId: string;
  let actionItemId: string;

  beforeAll(async () => {
    // Setup test organization & user
    const user = await prisma.user.create({
      data: {
        email: `phase13-test-${Date.now()}@example.com`,
        name: 'Phase 13 Admin',
        passwordHash: await hashPassword('password123'),
      },
    });
    userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: 'Phase 13 Test Org',
        slug: `phase13-org-${Date.now()}`,
      },
    });
    orgId = org.id;

    await prisma.organizationMember.create({
      data: {
        organizationId: orgId,
        userId: userId,
        role: 'ADMIN',
      },
    });

    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        name: 'Test Project',
        slug: `test-proj-${Date.now()}`,
      },
    });
    projectId = project.id;

    const loginRes = await request.post('/api/v1/auth/login').send({
      email: user.email,
      password: 'password123',
    });
    const loginData = loginRes.body as ApiEnvelope<{ accessToken: string }>;
    userToken = loginData.data.accessToken;

    // Create test incident & action item
    const incident = await prisma.incident.create({
      data: {
        organizationId: orgId,
        projectId: projectId,
        number: 9999,
        title: 'Phase 13 Test Incident',
        status: IncidentStatus.OPEN,
        severity: IncidentSeverity.SEV1,
        createdById: userId,
      },
    });
    incidentId = incident.id;

    const postmortem = await prisma.postmortem.create({
      data: {
        organizationId: orgId,
        incidentId: incidentId,
        status: 'DRAFT',
      },
    });

    const actionItem = await prisma.actionItem.create({
      data: {
        organizationId: orgId,
        incidentId: incidentId,
        postmortemId: postmortem.id,
        title: 'Fix auth pool memory leak',
        status: ActionItemStatus.OPEN,
      },
    });
    actionItemId = actionItem.id;
  });

  afterAll(async () => {
    await prisma.integrationDelivery.deleteMany({ where: { organizationId: orgId } });
    await prisma.externalReference.deleteMany({ where: { organizationId: orgId } });
    await prisma.externalEvent.deleteMany({});
    await prisma.actionItem.deleteMany({ where: { organizationId: orgId } });
    await prisma.postmortem.deleteMany({ where: { organizationId: orgId } });
    await prisma.incident.deleteMany({ where: { organizationId: orgId } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  // ===========================================================================
  // 1. SLACK INTEGRATION TESTS
  // ===========================================================================

  describe('Slack OAuth & Connection Lifecycle', () => {
    it('generates a valid Slack OAuth authorization URL with encrypted state', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/integrations/slack/connect`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      const body = res.body as ApiEnvelope<{ authorizeUrl: string }>;
      expect(body.success).toBe(true);
      expect(body.data.authorizeUrl).toContain('slack.com/oauth/v2/authorize');
    });

    it('exchanges OAuth code cleanly and connects Slack integration', async () => {
      const authorizeUrl = SlackService.getSlackAuthorizeUrl(orgId, userId);
      const stateParam = new URL(authorizeUrl).searchParams.get('state') || '';

      const callbackRes = await request.get(`/api/v1/integrations/slack/callback?code=mock-slack-code&state=${stateParam}`);
      expect(callbackRes.status).toBe(302);

      const integration = await prisma.integration.findUnique({
        where: { organizationId_provider: { organizationId: orgId, provider: IntegrationProvider.SLACK } },
      });
      expect(integration).toBeDefined();
      expect(integration?.status).toBe(IntegrationStatus.CONNECTED);
    });

    it('creates dedicated Slack incident channel idempotently', async () => {
      const channel1 = await SlackService.createIncidentChannel(orgId, incidentId);
      expect(channel1).not.toBeNull();
      expect(channel1?.channelId).toContain('C-inc-9999');

      // Second call returns existing reference
      const channel2 = await SlackService.createIncidentChannel(orgId, incidentId);
      expect(channel2?.channelId).toBe(channel1?.channelId);
    });

    it('validates Slack request signature and rejects replayed requests > 300s old', () => {
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
      const isValid = SlackService.verifySlackSignature('test-body', staleTimestamp, 'v0=mock');
      expect(isValid).toBe(false);
    });

    it('handles interactive Slack action buttons under RBAC and status rules', async () => {
      const reply = await SlackService.handleInteractivePayload({
        type: 'interactive',
        user: { id: 'U1234', username: 'testuser', name: 'Test User' },
        team: { id: 'T1234', domain: 'acme' },
        channel: { id: 'C1234', name: 'inc-9999' },
        actions: [{ action_id: 'ack_incident', value: incidentId }],
        response_url: 'http://localhost/response',
        trigger_id: 'trig-123',
      });

      expect(reply.text).toContain('INVESTIGATING');
      const updatedIncident = await prisma.incident.findUnique({ where: { id: incidentId } });
      expect(updatedIncident?.status).toBe(IncidentStatus.INVESTIGATING);
    });
  });

  // ===========================================================================
  // 2. JIRA INTEGRATION TESTS
  // ===========================================================================

  describe('Jira OAuth, API Token Fallback & Webhook Sync', () => {
    it('connects Jira via API Token fallback mode', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/jira/connect-token`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          siteUrl: 'https://acme.atlassian.net',
          email: 'admin@acme.com',
          apiToken: 'ATATT3xFfGF0mocktoken',
          defaultProjectKey: 'ENG',
        });

      expect(res.status).toBe(200);
      const integration = await prisma.integration.findUnique({
        where: { organizationId_provider: { organizationId: orgId, provider: IntegrationProvider.JIRA } },
      });
      expect(integration?.status).toBe(IntegrationStatus.CONNECTED);
    });

    it('creates Jira Issue from ActionItem idempotently with correlation metadata', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/jira/incidents/${incidentId}/action-items/${actionItemId}/jira-issue`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ projectKey: 'ENG' });

      expect(res.status).toBe(201);
      const resBody = res.body as ApiEnvelope<{ jiraIssueId: string }>;
      expect(resBody.data.jiraIssueId).toContain('ENG-');

      const ref = await prisma.externalReference.findFirst({
        where: { organizationId: orgId, provider: IntegrationProvider.JIRA, entityId: actionItemId },
      });
      expect(ref).toBeDefined();
      expect(ref?.metadata).toHaveProperty('lastSyncCorrelationId');

      // Idempotency: second call returns same ticket
      const res2 = await request
        .post(`/api/v1/organizations/${orgId}/integrations/jira/incidents/${incidentId}/action-items/${actionItemId}/jira-issue`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ projectKey: 'ENG' });

      const res2Body = res2.body as ApiEnvelope<{ jiraIssueId: string }>;
      expect(res2Body.data.jiraIssueId).toBe(resBody.data.jiraIssueId);
    });

    it('handles Jira Webhook status sync (Done -> ActionItem COMPLETED) with loop prevention', async () => {
      const ref = await prisma.externalReference.findFirst({
        where: { organizationId: orgId, provider: IntegrationProvider.JIRA, entityId: actionItemId },
      });

      if (!ref) throw new Error('ExternalReference missing for test');

      const webhookPayload = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          id: '10001',
          key: ref.externalId,
          fields: {
            summary: 'Fix auth pool memory leak',
            status: { id: '3', name: 'Done' },
          },
        },
        timestamp: Date.now(),
      };

      const res = await request
        .post('/api/v1/webhooks/jira')
        .set('x-atlassian-webhook-secret', 'incidenthub-dev-jira-webhook-secret')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      const body = res.body as ApiEnvelope<{ status: string }>;
      expect(body.data.status).toBe('updated');

      const updatedActionItem = await prisma.actionItem.findUnique({ where: { id: actionItemId } });
      expect(updatedActionItem?.status).toBe(ActionItemStatus.COMPLETED);

      // Duplicate webhook drop check
      const echoRes = await request
        .post('/api/v1/webhooks/jira')
        .set('x-atlassian-webhook-secret', 'incidenthub-dev-jira-webhook-secret')
        .send(webhookPayload);

      const echoBody = echoRes.body as ApiEnvelope<{ status: string }>;
      expect(echoBody.data.status).toContain('ignored');
    });
  });

  // ===========================================================================
  // 3. DELIVERY ENGINE & WORKER TESTS
  // ===========================================================================

  describe('Integration Delivery Engine & Processing', () => {
    it('executes atomic DB delivery claim (PENDING -> PROCESSING)', async () => {
      const integration = await prisma.integration.findFirst({ where: { organizationId: orgId } });
      if (!integration) throw new Error('Integration missing for test');

      const delivery = await prisma.integrationDelivery.create({
        data: {
          organizationId: orgId,
          integrationId: integration.id,
          provider: IntegrationProvider.SLACK,
          eventType: 'slack.test_event',
          sanitizedBody: { test: true },
          status: 'PENDING',
        },
      });

      const claimedFirst = await DeliveryService.claimDelivery(delivery.id);
      expect(claimedFirst).toBe(true);

      // Concurrent claim attempt fails
      const claimedSecond = await DeliveryService.claimDelivery(delivery.id);
      expect(claimedSecond).toBe(false);

      await DeliveryService.processDelivery(delivery.id);
      const finished = await prisma.integrationDelivery.findUnique({ where: { id: delivery.id } });
      expect(finished?.status).toBe('SUCCESS');
    });

    it('recovers stale PROCESSING deliveries older than 5 minutes', async () => {
      const integration = await prisma.integration.findFirst({ where: { organizationId: orgId } });
      if (!integration) throw new Error('Integration missing for test');

      const staleDelivery = await prisma.integrationDelivery.create({
        data: {
          organizationId: orgId,
          integrationId: integration.id,
          provider: IntegrationProvider.SLACK,
          eventType: 'slack.stale_event',
          sanitizedBody: { stale: true },
          status: 'PROCESSING',
          updatedAt: new Date(Date.now() - 6 * 60 * 1000), // 6 mins ago
        },
      });

      const recoveredCount = await DeliveryService.recoverStaleDeliveries();
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      const recovered = await prisma.integrationDelivery.findUnique({ where: { id: staleDelivery.id } });
      expect(recovered?.status).toBe('RETRYING');
    });
  });

  // ===========================================================================
  // 4. RBAC & TENANT ISOLATION TESTS
  // ===========================================================================

  describe('RBAC & Tenant Isolation Security', () => {
    it('rejects unauthenticated requests to integration management routes', async () => {
      const res = await request.get(`/api/v1/organizations/${orgId}/integrations/slack/connect`);
      expect(res.status).toBe(401);
    });

    it('rejects cross-tenant access to another organization integrations', async () => {
      const otherOrg = await prisma.organization.create({
        data: { name: 'Other Org', slug: `other-org-${Date.now()}` },
      });

      const res = await request
        .get(`/api/v1/organizations/${otherOrg.id}/integrations/slack/connect`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    });
  });
});
