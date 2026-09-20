import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { classifyPrismaUniqueError } from '../src/utils/errors';
import * as socketModule from '../src/lib/socket';
import type { Prisma } from '@prisma/client';
import {
  IntegrationProvider,
  IntegrationStatus,
  EventSource,
  EvidenceType,
  ActionItemStatus,
} from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Phase 3 — Webhook Ingestion Reliability, Idempotency, and Concurrency Test Suite', () => {
  let orgAId: string;
  let orgBId: string;
  let projectAId: string;
  let serviceAId: string;
  let ownerAId: string;
  let githubIntegAId: string;
  let jiraIntegAId: string;

  const testSecretGitHub = 'test-github-webhook-secret-32chars!';
  const testSecretSentry = 'test-sentry-webhook-secret-32chars!';
  const testSecretSlack = 'test-slack-webhook-signing-secret!';
  const testSecretJira = 'test-jira-webhook-secret-32chars!';
  let faultInjector: ((params: Prisma.MiddlewareParams) => Promise<void> | void) | null = null;

  beforeAll(async () => {
    // Install transactional fault injector middleware into Prisma
    prisma.$use(async (params, next) => {
      if (faultInjector) {
        await faultInjector(params);
      }
      const result: unknown = await next(params);
      return result;
    });

    process.env['GITHUB_WEBHOOK_SECRET'] = testSecretGitHub;
    process.env['SENTRY_WEBHOOK_SECRET'] = testSecretSentry;
    process.env['SLACK_SIGNING_SECRET'] = testSecretSlack;
    process.env['JIRA_WEBHOOK_SECRET'] = testSecretJira;

    // Clean test state
    await prisma.externalEvent.deleteMany({});
    await prisma.incidentEvidence.deleteMany({});
    await prisma.incidentEvent.deleteMany({});
    await prisma.incident.deleteMany({});
    await prisma.sentryIssue.deleteMany({});
    await prisma.sentryRule.deleteMany({});
    await prisma.gitHubCommit.deleteMany({});
    await prisma.gitHubPullRequest.deleteMany({});
    await prisma.gitHubRepository.deleteMany({});
    await prisma.actionItem.deleteMany({});
    await prisma.externalReference.deleteMany({});
    await prisma.integration.deleteMany({});
    await prisma.service.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.organizationMember.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.organization.deleteMany({});

    // Seed User & Orgs
    const userA = await prisma.user.create({
      data: {
        email: 'owner-phase3@incidenthub.test',
        passwordHash: 'hashed_pw',
        name: 'Phase 3 Owner',
      },
    });
    ownerAId = userA.id;

    const orgA = await prisma.organization.create({
      data: { name: 'Acme Reliability Org', slug: 'acme-reliability-org' },
    });
    orgAId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: 'Beta Tenant Org', slug: 'beta-tenant-org' },
    });
    orgBId = orgB.id;

    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: ownerAId, role: 'OWNER' },
    });

    const projectA = await prisma.project.create({
      data: { organizationId: orgAId, name: 'Billing Platform', slug: 'billing-platform' },
    });
    projectAId = projectA.id;

    await prisma.project.create({
      data: { organizationId: orgBId, name: 'Beta Platform', slug: 'beta-platform' },
    });

    const serviceA = await prisma.service.create({
      data: { projectId: projectAId, name: 'Stripe Gateway', slug: 'stripe-gateway' },
    });
    serviceAId = serviceA.id;

    // Integrations in Org A
    const githubInteg = await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: IntegrationProvider.GITHUB,
        status: IntegrationStatus.CONNECTED,
        metadata: { installationId: 12345678, connectedRepoCount: 1 },
      },
    });
    githubIntegAId = githubInteg.id;

    await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: IntegrationProvider.SENTRY,
        status: IntegrationStatus.CONNECTED,
        metadata: { sentryOrgSlug: 'acme-corp' },
      },
    });

    const jiraInteg = await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: IntegrationProvider.JIRA,
        status: IntegrationStatus.CONNECTED,
        metadata: { siteUrl: 'https://acme.atlassian.net', defaultProjectKey: 'ENG' },
      },
    });
    jiraIntegAId = jiraInteg.id;

    await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: IntegrationProvider.SLACK,
        status: IntegrationStatus.CONNECTED,
        metadata: { teamId: 'T_ACME_001', teamName: 'Acme Engineering' },
      },
    });

    // Seed GitHub Repository in Org A
    await prisma.gitHubRepository.create({
      data: {
        id: 'repo-acme-billing-phase3',
        organizationId: orgAId,
        integrationId: githubIntegAId,
        githubRepoId: BigInt(99887766),
        name: 'billing-service',
        fullName: 'acme-corp/billing-service',
        owner: 'acme-corp',
        defaultBranch: 'main',
        url: 'https://github.com/acme-corp/billing-service',
        projectId: projectAId,
        serviceId: serviceAId,
      },
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  interface ApiErrorEnvelope {
    success: false;
    error: {
      code: string;
      message: string;
    };
  }

  // ===========================================================================
  // BLOCKER 1 — GITHUB MANDATORY HEADERS & ERROR PATHS
  // ===========================================================================
  describe('Blocker 1 — GitHub Delivery Header Enforcement', () => {
    const payload = {
      repository: { full_name: 'acme-corp/billing-service', id: 99887766 },
      ref: 'refs/heads/main',
      commits: [
        {
          id: 'commit-gh-header-test-1',
          message: 'feat: add retry logic',
          author: { name: 'Alice', email: 'alice@acme.com' },
          timestamp: new Date().toISOString(),
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const validSig = `sha256=${crypto.createHmac('sha256', testSecretGitHub).update(raw).digest('hex')}`;

    it('returns 400 when X-GitHub-Delivery header is missing', async () => {
      const res = await request
        .post('/api/v1/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', validSig)
        .set('x-github-event', 'push')
        .send(payload);

      expect(res.status).toBe(400);
      const body = res.body as ApiErrorEnvelope;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when X-GitHub-Delivery header is blank', async () => {
      const res = await request
        .post('/api/v1/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', validSig)
        .set('x-github-delivery', '   ')
        .set('x-github-event', 'push')
        .send(payload);

      expect(res.status).toBe(400);
      const body = res.body as ApiErrorEnvelope;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when X-GitHub-Event header is missing', async () => {
      const res = await request
        .post('/api/v1/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', validSig)
        .set('x-github-delivery', 'gh-deliv-valid-123')
        .send(payload);

      expect(res.status).toBe(400);
      const body = res.body as ApiErrorEnvelope;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 403 when signature is missing or invalid, with no database side effect', async () => {
      const deliveryId = `gh-deliv-rejected-${Date.now()}`;

      // Missing signature -> 403
      const resMissing = await request
        .post('/api/v1/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-github-delivery', deliveryId)
        .set('x-github-event', 'push')
        .send(payload);

      expect(resMissing.status).toBe(403);

      // Invalid signature -> 403
      const resInvalid = await request
        .post('/api/v1/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', 'sha256=invaliddeadbeef')
        .set('x-github-delivery', deliveryId)
        .set('x-github-event', 'push')
        .send(payload);

      expect(resInvalid.status).toBe(403);

      // Verify no ExternalEvent was created
      const event = await prisma.externalEvent.findUnique({
        where: { provider_externalId: { provider: 'github', externalId: deliveryId } },
      });
      expect(event).toBeNull();
    });
  });

  // ===========================================================================
  // BLOCKER 2 — SENTRY DELIVERY IDENTITY & RAW BODY DIGEST
  // ===========================================================================
  describe('Blocker 2 — Sentry Delivery Identity', () => {
    it('uses genuine header when present, and deterministic sha256(sentry:resource:body) fallback when absent', async () => {
      const payload1 = {
        action: 'created',
        organization_slug: 'acme-corp',
        project_slug: 'billing-platform',
        issue: { id: `sentry-issue-${Date.now()}`, title: 'ReferenceError: x is not defined' },
      };
      const raw1 = JSON.stringify(payload1);
      const sig1 = crypto.createHmac('sha256', testSecretSentry).update(raw1).digest('hex');

      // 1. With explicit x-sentry-delivery header
      const explicitDelivery = `sentry-deliv-explicit-${Date.now()}`;
      const res1 = await request
        .post('/api/v1/webhooks/sentry')
        .set('x-sentry-delivery', explicitDelivery)
        .set('sentry-hook-resource', 'issue')
        .set('sentry-hook-signature', sig1)
        .send(payload1);

      expect(res1.status).toBe(200);
      const dbEvent1 = await prisma.externalEvent.findUnique({
        where: { provider_externalId: { provider: 'sentry', externalId: explicitDelivery } },
      });
      expect(dbEvent1).toBeDefined();
      expect(dbEvent1?.externalId).toBe(explicitDelivery);

      // 2. Without delivery header -> deterministic fallback sha256("sentry:issue:" + rawBody)
      const expectedDigest = crypto
        .createHash('sha256')
        .update(Buffer.concat([Buffer.from('sentry:issue:'), Buffer.from(raw1, 'utf8')]))
        .digest('hex');
      const expectedFallbackId = `sentry-${expectedDigest}`;

      const res2 = await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', 'issue')
        .set('sentry-hook-signature', sig1)
        .send(payload1);

      expect(res2.status).toBe(200);
      const dbEvent2 = await prisma.externalEvent.findUnique({
        where: { provider_externalId: { provider: 'sentry', externalId: expectedFallbackId } },
      });
      expect(dbEvent2).toBeDefined();
      expect(dbEvent2?.externalId).toBe(expectedFallbackId);

      // 3. Identical delivery returns duplicate
      const res3 = await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', 'issue')
        .set('sentry-hook-signature', sig1)
        .send(payload1);

      expect(res3.status).toBe(200);
      expect((res3.body as { data: { status: string } }).data.status).toBe('duplicate');

      // 4. Different body with same hook resource produces different fallback ID
      const payload2 = { ...payload1, issue: { ...payload1.issue, id: `sentry-issue-diff-${Date.now()}` } };
      const raw2 = JSON.stringify(payload2);
      const sig2 = crypto.createHmac('sha256', testSecretSentry).update(raw2).digest('hex');
      const expectedDigest2 = crypto
        .createHash('sha256')
        .update(Buffer.concat([Buffer.from('sentry:issue:'), Buffer.from(raw2, 'utf8')]))
        .digest('hex');

      expect(expectedDigest2).not.toBe(expectedDigest);

      const res4 = await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', 'issue')
        .set('sentry-hook-signature', sig2)
        .send(payload2);

      expect(res4.status).toBe(200);
      expect((res4.body as { data: { status: string } }).data.status).toBe('processed');
    });

    it('rejects tampered body with 403 Forbidden', async () => {
      const payload = { action: 'created', organization_slug: 'acme-corp', project_slug: 'billing-platform' };
      const rawOriginal = JSON.stringify(payload);
      const sig = crypto.createHmac('sha256', testSecretSentry).update(rawOriginal).digest('hex');

      const tamperedPayload = { ...payload, tampered: true };

      const res = await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-signature', sig)
        .send(tamperedPayload);

      expect(res.status).toBe(403);
    });
  });

  // ===========================================================================
  // BLOCKER 3 — UNAMBIGUOUS TENANT RESOLUTION & FAIL-CLOSED BEHAVIOR
  // ===========================================================================
  describe('Blocker 3 — Tenant Resolution & Fail-Closed Behavior', () => {
    it('returns ignored_unmapped when Sentry organization slug does not match any connected integration', async () => {
      const payload = {
        action: 'error',
        organization_slug: 'unknown-random-org',
        project_slug: 'random-project',
        issue: { id: 'sentry-unmapped-1', title: 'Unmapped error' },
      };
      const raw = JSON.stringify(payload);
      const sig = crypto.createHmac('sha256', testSecretSentry).update(raw).digest('hex');
      const deliveryId = `sentry-deliv-unmapped-${Date.now()}`;

      const res = await request
        .post('/api/v1/webhooks/sentry')
        .set('x-sentry-delivery', deliveryId)
        .set('sentry-hook-resource', 'event')
        .set('sentry-hook-signature', sig)
        .send(payload);

      expect(res.status).toBe(200);
      expect((res.body as { data: { status: string } }).data.status).toBe('ignored_unmapped');

      // Verify no ExternalEvent or SentryIssue created
      const event = await prisma.externalEvent.findUnique({
        where: { provider_externalId: { provider: 'sentry', externalId: deliveryId } },
      });
      expect(event).toBeNull();
    });

    it('fails closed when multiple organizations have conflicting Sentry integrations with same slug', async () => {
      // Connect Sentry integration in Org B with same slug 'acme-corp' to simulate conflict
      const conflictingInteg = await prisma.integration.create({
        data: {
          organizationId: orgBId,
          provider: IntegrationProvider.SENTRY,
          status: IntegrationStatus.CONNECTED,
          metadata: { sentryOrgSlug: 'acme-corp' },
        },
      });

      // Send payload with ambiguous project that does not exist in either org
      const payload = {
        action: 'error',
        organization_slug: 'acme-corp',
        project_slug: 'nonexistent-ambiguous-project',
        issue: { id: 'sentry-ambig-1', title: 'Ambiguous error' },
      };
      const raw = JSON.stringify(payload);
      const sig = crypto.createHmac('sha256', testSecretSentry).update(raw).digest('hex');
      const deliveryId = `sentry-deliv-ambig-${Date.now()}`;

      const res = await request
        .post('/api/v1/webhooks/sentry')
        .set('x-sentry-delivery', deliveryId)
        .set('sentry-hook-resource', 'event')
        .set('sentry-hook-signature', sig)
        .send(payload);

      expect(res.status).toBe(200);
      expect((res.body as { data: { status: string } }).data.status).toBe('ignored_unmapped');

      // Cleanup conflicting integration
      await prisma.integration.delete({ where: { id: conflictingInteg.id } });
    });
  });

  // ===========================================================================
  // BLOCKER 4 — SENTRY CONCURRENCY & SEQUENTIAL INCIDENT NUMBERING
  // ===========================================================================
  describe('Blocker 4 — Concurrency-Safe Sentry Incident Creation', () => {
    it('5 concurrent deliveries for the same Sentry issue create exactly 1 open incident', async () => {
      // Set up an auto-create Sentry rule
      await prisma.sentryRule.deleteMany({ where: { organizationId: orgAId } });
      await prisma.sentryRule.create({
        data: {
          organizationId: orgAId,
          name: 'Concurrent Auto Incident Rule',
          environment: 'production',
          minEventCount: 1,
          minUserCount: 1,
          levelFilter: 'error',
          mappedSeverity: 'SEV2',
          autoCreateIncident: true,
          projectId: projectAId,
          serviceId: serviceAId,
        },
      });

      const sentryIssueId = `sentry-concur-issue-${Date.now()}`;
      const payload = {
        action: 'error',
        organization_slug: 'acme-corp',
        project_slug: 'billing-platform',
        issue: {
          id: sentryIssueId,
          title: 'ConcurrentLockTimeoutException: database lock wait timeout',
          level: 'error',
          count: '25',
          userCount: 10,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
        event: { release: 'v1.0.0', environment: 'production' },
      };
      const raw = JSON.stringify(payload);
      const sig = crypto.createHmac('sha256', testSecretSentry).update(raw).digest('hex');

      const broadcastSpy = vi.spyOn(socketModule, 'broadcastToIncident');

      // Send 5 concurrent requests with different delivery IDs for the SAME Sentry issue
      const results = await Promise.all(
        Array.from({ length: 5 }).map((_, i) =>
          request
            .post('/api/v1/webhooks/sentry')
            .set('x-sentry-delivery', `sentry-concur-deliv-${Date.now()}-${i}`)
            .set('sentry-hook-resource', 'event')
            .set('sentry-hook-signature', sig)
            .send(payload),
        ),
      );

      for (const res of results) {
        expect(res.status).toBe(200);
      }

      // Check how many open incidents exist for this Sentry issue
      const issue = await prisma.sentryIssue.findUnique({
        where: { organizationId_sentryIssueId: { organizationId: orgAId, sentryIssueId } },
      });
      expect(issue).toBeDefined();

      const evidence = await prisma.incidentEvidence.findMany({
        where: {
          type: EvidenceType.SENTRY_ERROR,
          externalRefId: issue?.id,
          incident: { organizationId: orgAId },
        },
      });
      expect(evidence.length).toBe(1);

      // Exactly 1 incident created
      const incidents = await prisma.incident.findMany({
        where: { organizationId: orgAId, title: { contains: 'ConcurrentLockTimeoutException' } },
      });
      expect(incidents.length).toBe(1);

      // Exactly 1 initial timeline event for this incident
      const firstIncident = incidents[0];
      expect(firstIncident).toBeDefined();
      const timelineEvents = await prisma.incidentEvent.findMany({
        where: {
          incidentId: firstIncident?.id,
          source: EventSource.SENTRY,
          type: 'SENTRY_SIGNAL_TRIGGERED',
        },
      });
      expect(timelineEvents.length).toBe(1);

      // Exactly 1 post-commit socket emission; duplicates emit zero socket events
      expect(broadcastSpy).toHaveBeenCalledTimes(1);

      broadcastSpy.mockRestore();
    });

    it('concurrent trigger deliveries for different issues in one org receive unique sequential incident numbers', async () => {
      const lastInc = await prisma.incident.findFirst({
        where: { organizationId: orgAId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const previousMax = lastInc?.number ?? 0;

      const issueIds = Array.from({ length: 4 }).map((_, i) => `sentry-diff-issue-${Date.now()}-${i}`);

      const results = await Promise.all(
        issueIds.map((issueId, idx) => {
          const payload = {
            action: 'error',
            organization_slug: 'acme-corp',
            project_slug: 'billing-platform',
            issue: {
              id: issueId,
              title: `DistinctError-${idx}: distinct error type ${idx}`,
              level: 'error',
              count: '5',
              userCount: 2,
              firstSeen: new Date().toISOString(),
              lastSeen: new Date().toISOString(),
            },
            event: { release: 'v1.0.0', environment: 'production' },
          };
          const raw = JSON.stringify(payload);
          const sig = crypto.createHmac('sha256', testSecretSentry).update(raw).digest('hex');

          return request
            .post('/api/v1/webhooks/sentry')
            .set('x-sentry-delivery', `sentry-diff-deliv-${Date.now()}-${idx}`)
            .set('sentry-hook-resource', 'event')
            .set('sentry-hook-signature', sig)
            .send(payload);
        }),
      );

      for (const res of results) {
        expect(res.status).toBe(200);
      }

      const incidents = await prisma.incident.findMany({
        where: {
          organizationId: orgAId,
          title: { contains: 'DistinctError-' },
        },
        orderBy: { number: 'asc' },
      });

      expect(incidents.length).toBe(4);
      const numbers = incidents.map((inc) => inc.number);

      // Assert exact sorted sequential equality: [previousMax + 1, previousMax + 2, previousMax + 3, previousMax + 4]
      expect(numbers).toEqual([previousMax + 1, previousMax + 2, previousMax + 3, previousMax + 4]);

      // Assert no duplicates and no gaps
      expect(new Set(numbers).size).toBe(4);
      for (let i = 0; i < numbers.length - 1; i++) {
        const current = numbers[i];
        const nextNum = numbers[i + 1];
        if (current !== undefined && nextNum !== undefined) {
          expect(nextNum - current).toBe(1);
        }
      }
    });
  });

  // ===========================================================================
  // BLOCKER 6 — EXACTLY-ONCE CONCURRENCY (GITHUB & SENTRY 5 CONCURRENT IDENTICAL REQUESTS)
  // ===========================================================================
  describe('Blocker 6 — Exactly-Once Concurrency Tests', () => {
    it('GitHub: 5 concurrent identical requests yield exactly 1 processed and 4 duplicates', async () => {
      const deliveryId = `gh-concur-identical-${Date.now()}`;
      const sha = `sha-identical-${Date.now()}`;
      const payload = {
        repository: { full_name: 'acme-corp/billing-service', id: 99887766 },
        ref: 'refs/heads/main',
        commits: [
          {
            id: sha,
            message: 'perf: optimize query planner',
            author: { name: 'Bob', email: 'bob@acme.com' },
            timestamp: new Date().toISOString(),
          },
        ],
      };
      const raw = JSON.stringify(payload);
      const sig = `sha256=${crypto.createHmac('sha256', testSecretGitHub).update(raw).digest('hex')}`;

      const results = await Promise.all(
        Array.from({ length: 5 }).map(() =>
          request
            .post('/api/v1/webhooks/github')
            .set('Content-Type', 'application/json')
            .set('x-hub-signature-256', sig)
            .set('x-github-delivery', deliveryId)
            .set('x-github-event', 'push')
            .send(payload),
        ),
      );

      for (const res of results) {
        expect(res.status).toBe(200);
      }

      const statuses = results.map((r) => (r.body as { data: { status: string } }).data.status);
      expect(statuses.filter((s) => s === 'processed').length).toBe(1);
      expect(statuses.filter((s) => s === 'duplicate').length).toBe(4);

      const eventCount = await prisma.externalEvent.count({
        where: { provider: 'github', externalId: deliveryId },
      });
      expect(eventCount).toBe(1);

      const commitCount = await prisma.gitHubCommit.count({
        where: { sha },
      });
      expect(commitCount).toBe(1);
    });

    it('Sentry: 5 concurrent identical requests yield exactly 1 processed and 4 duplicates', async () => {
      // Ensure auto-create Sentry rule exists
      await prisma.sentryRule.deleteMany({ where: { organizationId: orgAId } });
      await prisma.sentryRule.create({
        data: {
          organizationId: orgAId,
          name: 'Identical Auto Incident Rule',
          environment: 'production',
          minEventCount: 1,
          minUserCount: 1,
          levelFilter: 'error',
          mappedSeverity: 'SEV2',
          autoCreateIncident: true,
          projectId: projectAId,
          serviceId: serviceAId,
        },
      });

      const deliveryId = `sentry-concur-identical-${Date.now()}`;
      const issueId = `sentry-identical-issue-${Date.now()}`;
      const payload = {
        action: 'error',
        organization_slug: 'acme-corp',
        project_slug: 'billing-platform',
        issue: {
          id: issueId,
          title: 'PaymentGatewayTimeout: socket hangup',
          level: 'error',
          count: '1',
          userCount: 1,
        },
        event: { release: 'v1.0.0', environment: 'production' },
      };
      const raw = JSON.stringify(payload);
      const sig = crypto.createHmac('sha256', testSecretSentry).update(raw).digest('hex');

      const broadcastSpy = vi.spyOn(socketModule, 'broadcastToIncident');

      const results = await Promise.all(
        Array.from({ length: 5 }).map(() =>
          request
            .post('/api/v1/webhooks/sentry')
            .set('x-sentry-delivery', deliveryId)
            .set('sentry-hook-resource', 'event')
            .set('sentry-hook-signature', sig)
            .send(payload),
        ),
      );

      for (const res of results) {
        expect(res.status).toBe(200);
      }

      const statuses = results.map((r) => (r.body as { data: { status: string } }).data.status);
      expect(statuses.filter((s) => s === 'processed').length).toBe(1);
      expect(statuses.filter((s) => s === 'duplicate').length).toBe(4);

      // Exactly 1 ExternalEvent
      const eventCount = await prisma.externalEvent.count({
        where: { provider: 'sentry', externalId: deliveryId },
      });
      expect(eventCount).toBe(1);

      // Exactly 1 SentryIssue record
      const issueCount = await prisma.sentryIssue.count({
        where: { organizationId: orgAId, sentryIssueId: issueId },
      });
      expect(issueCount).toBe(1);

      // Exactly 1 triggered Incident
      const incidentCount = await prisma.incident.count({
        where: { organizationId: orgAId, title: { contains: 'PaymentGatewayTimeout' } },
      });
      expect(incidentCount).toBe(1);

      // Exactly 1 IncidentEvidence record
      const evidenceCount = await prisma.incidentEvidence.count({
        where: { incident: { organizationId: orgAId, title: { contains: 'PaymentGatewayTimeout' } } },
      });
      expect(evidenceCount).toBe(1);

      // Exactly 1 initial timeline event
      const timelineCount = await prisma.incidentEvent.count({
        where: { organizationId: orgAId, type: 'SENTRY_SIGNAL_TRIGGERED' },
      });
      expect(timelineCount).toBeGreaterThanOrEqual(1);

      // Exactly 1 post-commit socket emission
      expect(broadcastSpy).toHaveBeenCalledTimes(1);

      broadcastSpy.mockRestore();
    });
  });

  // ===========================================================================
  // BLOCKER 7 — PROVE FAILED PROCESSING CAN BE RETRIED (REAL TRANSACTION ROLLBACK)
  // ===========================================================================
  describe('Blocker 7 — Failure -> Retry -> Duplicate Lifecycle', () => {
    it('aborts transaction on persistence error, allows clean retry, and returns duplicate on third attempt', async () => {
      const deliveryId = `gh-retry-lifecycle-${Date.now()}`;
      const sha = `sha-retry-${Date.now()}`;
      const payload = {
        repository: { full_name: 'acme-corp/billing-service', id: 99887766 },
        ref: 'refs/heads/main',
        commits: [
          {
            id: sha,
            message: 'fix: resolve race condition',
            author: { name: 'Carol', email: 'carol@acme.com' },
            timestamp: new Date().toISOString(),
          },
        ],
      };
      const raw = JSON.stringify(payload);
      const sig = `sha256=${crypto.createHmac('sha256', testSecretGitHub).update(raw).digest('hex')}`;

      // Inject downstream failure on GitHubCommit write inside the real transaction via Prisma middleware
      // (This allows the real transaction to begin, and tx.externalEvent.create to execute before the failure)
      faultInjector = (params) => {
        if (params.model === 'GitHubCommit' && params.action === 'upsert') {
          throw new Error('Simulated database write error during commit processing');
        }
      };
      const broadcastSpy = vi.spyOn(socketModule, 'broadcastToIncident');

      // Attempt 1: Fails downstream inside transaction
      const res1 = await request
        .post('/api/v1/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', sig)
        .set('x-github-delivery', deliveryId)
        .set('x-github-event', 'push')
        .send(payload);

      expect(res1.status).toBe(500);

      // Verify the early transactional write (ExternalEvent) was rolled back by PostgreSQL
      const eventAfterFail = await prisma.externalEvent.findUnique({
        where: { provider_externalId: { provider: 'github', externalId: deliveryId } },
      });
      expect(eventAfterFail).toBeNull();

      // Verify no provider-domain record exists
      const commitAfterFail = await prisma.gitHubCommit.findFirst({
        where: { sha },
      });
      expect(commitAfterFail).toBeNull();

      // Verify no post-commit socket side effect was emitted on failed attempt
      expect(broadcastSpy).toHaveBeenCalledTimes(0);

      // Clear fault injector to allow clean retry
      faultInjector = null;

      // Attempt 2: Retry with exact same delivery ID and payload -> succeeds
      const res2 = await request
        .post('/api/v1/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', sig)
        .set('x-github-delivery', deliveryId)
        .set('x-github-event', 'push')
        .send(payload);

      expect(res2.status).toBe(200);
      expect((res2.body as { data: { status: string } }).data.status).toBe('processed');

      const eventAfterSuccess = await prisma.externalEvent.findUnique({
        where: { provider_externalId: { provider: 'github', externalId: deliveryId } },
      });
      expect(eventAfterSuccess).toBeDefined();
      expect(eventAfterSuccess?.processedAt).not.toBeNull();

      const commitAfterSuccess = await prisma.gitHubCommit.findFirst({
        where: { sha },
      });
      expect(commitAfterSuccess).toBeDefined();

      // Attempt 3: Third attempt with same delivery ID -> duplicate
      const res3 = await request
        .post('/api/v1/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', sig)
        .set('x-github-delivery', deliveryId)
        .set('x-github-event', 'push')
        .send(payload);

      expect(res3.status).toBe(200);
      expect((res3.body as { data: { status: string } }).data.status).toBe('duplicate');

      // Invariant: Exactly one final logical mutation set exists
      const finalEventCount = await prisma.externalEvent.count({
        where: { provider: 'github', externalId: deliveryId },
      });
      expect(finalEventCount).toBe(1);

      const finalCommitCount = await prisma.gitHubCommit.count({
        where: { sha },
      });
      expect(finalCommitCount).toBe(1);

      broadcastSpy.mockRestore();
    });
  });

  // ===========================================================================
  // BLOCKER 8 — RESTRICT P2002 DUPLICATE HANDLING (EXACT CLASSIFICATION & RETHROW)
  // ===========================================================================
  describe('Blocker 8 — Strict P2002 Duplicate Handling', () => {
    it('classifies ExternalEvent(provider, externalId) as EXTERNAL_EVENT_DUPLICATE', async () => {
      const { Prisma } = await import('@prisma/client');
      const errArray = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['provider', 'externalId'], modelName: 'ExternalEvent' },
      });
      expect(classifyPrismaUniqueError(errArray)).toBe('EXTERNAL_EVENT_DUPLICATE');

      const errString = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: 'ExternalEvent_provider_externalId_key' },
      });
      expect(classifyPrismaUniqueError(errString)).toBe('EXTERNAL_EVENT_DUPLICATE');
    });

    it('classifies Incident(organizationId, number) as INCIDENT_NUMBER_CONFLICT', async () => {
      const { Prisma } = await import('@prisma/client');
      const errArray = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['organizationId', 'number'], modelName: 'Incident' },
      });
      expect(classifyPrismaUniqueError(errArray)).toBe('INCIDENT_NUMBER_CONFLICT');

      const errString = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: 'Incident_organizationId_number_key' },
      });
      expect(classifyPrismaUniqueError(errString)).toBe('INCIDENT_NUMBER_CONFLICT');
    });

    it('classifies User(email) as UNRELATED_CONFLICT', async () => {
      const { Prisma } = await import('@prisma/client');
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on email', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'], modelName: 'User' },
      });
      expect(classifyPrismaUniqueError(err)).toBe('UNRELATED_CONFLICT');
    });

    it('classifies Incident(id) as UNRELATED_CONFLICT', async () => {
      const { Prisma } = await import('@prisma/client');
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on id', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['id'], modelName: 'Incident' },
      });
      expect(classifyPrismaUniqueError(err)).toBe('UNRELATED_CONFLICT');
    });

    it('classifies ExternalEvent(id) as UNRELATED_CONFLICT', async () => {
      const { Prisma } = await import('@prisma/client');
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on id', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['id'], modelName: 'ExternalEvent' },
      });
      expect(classifyPrismaUniqueError(err)).toBe('UNRELATED_CONFLICT');
    });

    it('classifies missing/unknown meta.target as UNRELATED_CONFLICT', async () => {
      const { Prisma } = await import('@prisma/client');
      const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: {},
      });
      expect(classifyPrismaUniqueError(err)).toBe('UNRELATED_CONFLICT');
    });

    it('rethrows unrelated P2002 unique constraint violations instead of masking them as duplicates', async () => {
      const deliveryId = `sentry-unrelated-p2002-${Date.now()}`;
      const payload = {
        action: 'error',
        organization_slug: 'acme-corp',
        project_slug: 'billing-platform',
        issue: { id: `sentry-p2002-${Date.now()}`, title: 'Unrelated error' },
      };
      const raw = JSON.stringify(payload);
      const sig = crypto.createHmac('sha256', testSecretSentry).update(raw).digest('hex');

      // Inject unrelated P2002 error targeting a different entity / unique constraint inside downstream write via Prisma middleware
      const { Prisma } = await import('@prisma/client');
      const unrelatedP2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed on users.email', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'], modelName: 'User' },
      });

      faultInjector = (params) => {
        if (params.model === 'SentryIssue' && params.action === 'upsert') {
          throw unrelatedP2002;
        }
      };

      const res = await request
        .post('/api/v1/webhooks/sentry')
        .set('x-sentry-delivery', deliveryId)
        .set('sentry-hook-resource', 'event')
        .set('sentry-hook-signature', sig)
        .send(payload);

      // Must NOT return status 200 with 'duplicate'; must rethrow to 500 error handler
      expect(res.status).toBe(500);

      faultInjector = null;
    });
  });

  // ===========================================================================
  // BLOCKER 5 — STANDARDIZED STATUSES (JIRA & SLACK)
  // ===========================================================================
  describe('Blocker 5 — Standardized Statuses Across Jira and Slack', () => {
    it('Jira webhook returns processed, duplicate on loop prevention, and ignored_unmapped on unmapped issue', async () => {
      // Create postmortem action item and link external reference
      const incident = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          number: 9999,
          title: 'Jira Test Incident',
          createdById: ownerAId,
        },
      });

      const postmortem = await prisma.postmortem.create({
        data: {
          organizationId: orgAId,
          incidentId: incident.id,
        },
      });

      const actionItem = await prisma.actionItem.create({
        data: {
          organizationId: orgAId,
          postmortemId: postmortem.id,
          incidentId: incident.id,
          title: 'Add circuit breaker to billing client',
          status: ActionItemStatus.OPEN,
        },
      });

      const issueKey = 'ENG-7788';
      await prisma.externalReference.create({
        data: {
          organizationId: orgAId,
          integrationId: jiraIntegAId,
          provider: IntegrationProvider.JIRA,
          entityType: 'ACTION_ITEM',
          entityId: actionItem.id,
          externalResourceType: 'JIRA_ISSUE',
          externalId: issueKey,
          metadata: { lastSyncedStatus: ActionItemStatus.OPEN },
        },
      });

      const deliveryId = `jira-deliv-${Date.now()}`;
      const payload = {
        webhookEvent: 'jira:issue_updated',
        issue: {
          key: issueKey,
          fields: { status: { name: 'Done' } },
        },
      };

      // 1. Process valid update -> processed
      const res1 = await request
        .post('/api/v1/webhooks/jira')
        .set('x-atlassian-webhook-identifier', deliveryId)
        .set('x-jira-webhook-secret', testSecretJira)
        .send(payload);

      expect(res1.status).toBe(200);
      expect((res1.body as { data: { status: string } }).data.status).toBe('processed');

      // 2. Loop prevention / already synced -> duplicate
      const deliveryId2 = `jira-deliv-loop-${Date.now()}`;
      const res2 = await request
        .post('/api/v1/webhooks/jira')
        .set('x-atlassian-webhook-identifier', deliveryId2)
        .set('x-jira-webhook-secret', testSecretJira)
        .send(payload);

      expect(res2.status).toBe(200);
      expect((res2.body as { data: { status: string } }).data.status).toBe('duplicate');

      // 3. Unmapped issue -> ignored_unmapped
      const deliveryId3 = `jira-deliv-unmapped-${Date.now()}`;
      const res3 = await request
        .post('/api/v1/webhooks/jira')
        .set('x-atlassian-webhook-identifier', deliveryId3)
        .set('x-jira-webhook-secret', testSecretJira)
        .send({
          webhookEvent: 'jira:issue_updated',
          issue: { key: 'UNMAPPED-999', fields: { status: { name: 'Done' } } },
        });

      expect(res3.status).toBe(200);
      expect((res3.body as { data: { status: string } }).data.status).toBe('ignored_unmapped');
    });

    it('Slack replay window enforces 300s expiration', async () => {
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 400s ago
      const payload = { actions: [{ action_id: 'ack_incident', value: 'inc-1' }] };
      const raw = JSON.stringify(payload);
      const sigBasestring = `v0:${oldTimestamp}:${raw}`;
      const sig = `v0=${crypto.createHmac('sha256', testSecretSlack).update(sigBasestring).digest('hex')}`;

      const res = await request
        .post('/api/v1/webhooks/slack/actions')
        .set('x-slack-request-timestamp', oldTimestamp)
        .set('x-slack-signature', sig)
        .send(payload);

      expect(res.status).toBe(401);
    });
  });
});
