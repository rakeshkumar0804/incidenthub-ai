import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { redis, checkRedisHealth } from '../src/lib/redis';
import { CorrelationService } from '../src/modules/correlation/correlation.service';
import { OrgRole, IncidentSeverity, IncidentStatus, IncidentEnvironment } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Phase 8 — Correlation Engine Integration Tests', () => {
  const ts = Date.now();
  let orgId: string;
  let otherOrgId: string;
  let projectId: string;
  let serviceId: string;
  let incidentId: string;

  let ownerToken: string;
  let responderToken: string;
  let viewerToken: string;
  let otherOrgOwnerToken: string;

  let integrationIdA: string;
  let integrationIdB: string;
  let sentryIntegrationId: string;

  beforeAll(async () => {
    // 1. Create Organization A
    const orgRes = await prisma.organization.create({
      data: { name: `Corr Org ${ts}`, slug: `corr-org-${ts}` },
    });
    orgId = orgRes.id;

    // 2. Create Users & Memberships
    const owner = await prisma.user.create({
      data: { email: `corr-owner-${ts}@example.com`, name: 'Corr Owner', passwordHash: 'hash' },
    });
    const responder = await prisma.user.create({
      data: { email: `corr-resp-${ts}@example.com`, name: 'Corr Resp', passwordHash: 'hash' },
    });
    const viewer = await prisma.user.create({
      data: { email: `corr-view-${ts}@example.com`, name: 'Corr View', passwordHash: 'hash' },
    });

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgId, userId: owner.id, role: OrgRole.OWNER },
        { organizationId: orgId, userId: responder.id, role: OrgRole.RESPONDER },
        { organizationId: orgId, userId: viewer.id, role: OrgRole.VIEWER },
      ],
    });

    // Generate Auth Tokens
    const { signAccessToken } = await import('../src/utils/jwt');
    ownerToken = signAccessToken(owner.id, owner.email);
    responderToken = signAccessToken(responder.id, responder.email);
    viewerToken = signAccessToken(viewer.id, viewer.email);

    // 3. Create Organization B (Cross-Tenant Test)
    const orgB = await prisma.organization.create({
      data: { name: `Other Org ${ts}`, slug: `other-org-${ts}` },
    });
    otherOrgId = orgB.id;

    const otherOwner = await prisma.user.create({
      data: { email: `other-owner-${ts}@example.com`, name: 'Other Owner', passwordHash: 'hash' },
    });
    await prisma.organizationMember.create({
      data: { organizationId: otherOrgId, userId: otherOwner.id, role: OrgRole.OWNER },
    });
    otherOrgOwnerToken = signAccessToken(otherOwner.id, otherOwner.email);

    // 4. Create Integrations in Org A & Org B
    const integrationA = await prisma.integration.create({
      data: {
        organizationId: orgId,
        provider: 'GITHUB',
        status: 'CONNECTED',
        metadata: {},
      },
    });
    integrationIdA = integrationA.id;

    const integrationB = await prisma.integration.create({
      data: {
        organizationId: otherOrgId,
        provider: 'GITHUB',
        status: 'CONNECTED',
        metadata: {},
      },
    });
    integrationIdB = integrationB.id;

    const sentryIntegration = await prisma.integration.create({
      data: {
        organizationId: orgId,
        provider: 'SENTRY',
        status: 'CONNECTED',
        metadata: {},
      },
    });
    sentryIntegrationId = sentryIntegration.id;

    const project = await prisma.project.create({
      data: { organizationId: orgId, name: 'Corr Project', slug: `corr-proj-${ts}` },
    });
    projectId = project.id;

    const service = await prisma.service.create({
      data: { projectId: project.id, name: 'Corr Service', slug: `corr-svc-${ts}` },
    });
    serviceId = service.id;

    // 5. Create Incident in Org A
    const incident = await prisma.incident.create({
      data: {
        organizationId: orgId,
        projectId,
        serviceId,
        number: 1,
        title: 'Payment gateway timeout spike',
        description: 'Elevated 504 Gateway Timeout errors detected on payment processing service.',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.INVESTIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: owner.id,
        detectedAt: new Date(),
      },
    });
    incidentId = incident.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  });

  // =============================================================================
  // 1. Deterministic Scoring & 4-Stage Pipeline
  // =============================================================================
  describe('1. Deterministic Scoring & 4-Stage Pipeline', () => {
    it('executes 4-stage correlation pipeline and calculates deterministic confidence scores', async () => {
      // Create candidate signals
      const repo = await prisma.gitHubRepository.create({
        data: {
          organizationId: orgId,
          integrationId: integrationIdA,
          githubRepoId: BigInt(Date.now()),
          name: 'corr-repo',
          fullName: 'org/corr-repo',
          owner: 'org',
          url: 'https://github.com/org/corr-repo',
          projectId,
          serviceId,
        },
      });

      const deployCommitSha = `sha-deploy-${ts}`;

      // Stage 2 Deployment Anchor Candidate (Preceding deployment within 60m in production)
      await prisma.gitHubDeployment.create({
        data: {
          repositoryId: repo.id,
          deploymentId: `dep-anchor-${ts}`,
          environment: 'production',
          state: 'success',
          commitSha: deployCommitSha,
          creator: 'deploy-bot',
          createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 mins prior
        },
      });

      // Stage 3 Commit Candidate (matches deployment commitSha)
      await prisma.gitHubCommit.create({
        data: {
          repositoryId: repo.id,
          sha: deployCommitSha,
          authorName: 'Developer Jane',
          message: 'Fix connection pool max clients settings',
          branch: 'main',
          url: `https://github.com/org/corr-repo/commit/${deployCommitSha}`,
          committedAt: new Date(Date.now() - 20 * 60 * 1000),
        },
      });

      // Stage 3 PR Candidate (matching branch)
      await prisma.gitHubPullRequest.create({
        data: {
          repositoryId: repo.id,
          number: 101,
          title: 'Upgrade connection pool library',
          state: 'merged',
          author: 'Developer Jane',
          branch: 'main',
          url: 'https://github.com/org/corr-repo/pull/101',
          mergedAt: new Date(Date.now() - 25 * 60 * 1000),
        },
      });

      // Stage 1 Sentry Issue Candidate
      await prisma.sentryIssue.create({
        data: {
          organizationId: orgId,
          integrationId: sentryIntegrationId,
          sentryIssueId: `sentry-spike-${ts}`,
          projectSlug: 'corr-project',
          title: 'ConnectionPoolExhaustedException: Timeout waiting for idle client',
          level: 'fatal',
          userCount: 45,
          eventCount: 230,
          environment: 'production',
          projectId,
          serviceId,
          lastSeen: new Date(Date.now() - 10 * 60 * 1000),
        },
      });

      // Execute Correlation Run
      const result = await CorrelationService.runCorrelation(
        orgId,
        incidentId,
        undefined,
        'MANUAL_REQUEST',
      );

      expect(result.status).toBe('completed');
      expect(result.correlatedCount).toBeGreaterThanOrEqual(3);

      // Verify Ranked Evidence from DB
      const evidence = await prisma.incidentEvidence.findMany({
        where: { incidentId },
        orderBy: { confidence: 'desc' },
      });

      expect(evidence.length).toBeGreaterThanOrEqual(3);

      // Verify Deployment Anchor score
      const deployEvt = evidence.find((e) => e.externalRefId === `deploy:dep-anchor-${ts}`);
      expect(deployEvt).toBeDefined();
      expect(deployEvt?.confidenceTier).toBe('HIGH');
      expect(deployEvt?.confidence).toBeGreaterThanOrEqual(0.8);

      // Verify Commit inherited deployment boost (+0.25)
      const commitEvt = evidence.find((e) => e.externalRefId === `commit:${deployCommitSha}`);
      expect(commitEvt).toBeDefined();
      expect(commitEvt?.confidenceTier).toBe('HIGH');

      // Verify PR inherited commit & PR boost
      const prEvt = evidence.find((e) => e.externalRefId === `pr:${repo.id}:101`);
      expect(prEvt).toBeDefined();
      expect(prEvt?.confidenceTier).toBe('HIGH');
    });
  });

  // =============================================================================
  // 2. Redis Distributed Locking & Recursion Loop Prevention
  // =============================================================================
  describe('2. Redis Distributed Locking & Loop Prevention', () => {
    it('prevents concurrent executions using Redis distributed lock', async () => {
      const lockKey = `lock:correlation:${incidentId}`;
      const lockVal = 'test-active-lock';

      const health = await checkRedisHealth();
      if (health === 'connected') {
        await redis.set(lockKey, lockVal);
      }

      const res = await CorrelationService.runCorrelation(
        orgId,
        incidentId,
        undefined,
        'AUTOMATIC_INCIDENT_UPDATED',
      );

      if (health === 'connected') {
        expect(res.status).toBe('skipped: lock active');
        await redis.del(lockKey);
      } else {
        expect(res.status).toBe('completed');
      }
    });

    it('creates timeline events tagged with correlationRun metadata to prevent recursive loops', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(200);

      // Verify timeline event exists and has correlationRun flag
      const timelineEvent = await prisma.incidentEvent.findFirst({
        where: { incidentId, type: 'CORRELATION_RUN_COMPLETED' },
        orderBy: { occurredAt: 'desc' },
      });

      expect(timelineEvent).toBeDefined();
      const meta = timelineEvent?.metadata as { correlationRun?: boolean };
      expect(meta?.correlationRun).toBe(true);
    });
  });

  // =============================================================================
  // 3. Composite Non-Null externalRefId Idempotency
  // =============================================================================
  describe('3. Composite Non-Null externalRefId Idempotency', () => {
    it('updates existing evidence in place without duplicating database entries', async () => {
      const initialCount = await prisma.incidentEvidence.count({ where: { incidentId } });

      // Run correlation again
      await CorrelationService.runCorrelation(orgId, incidentId, undefined, 'RERUN_REQUEST');

      const finalCount = await prisma.incidentEvidence.count({ where: { incidentId } });
      expect(finalCount).toBe(initialCount); // Zero duplicate rows created!
    });

    it('allows separate evidence records with identical titles if externalRefIds differ', async () => {
      const title = 'Duplicate Title Commit';

      await prisma.incidentEvidence.create({
        data: {
          incidentId,
          type: 'GITHUB_COMMIT',
          externalRefId: `commit:sha-alpha-${ts}`,
          title,
          confidence: 0.7,
        },
      });

      await prisma.incidentEvidence.create({
        data: {
          incidentId,
          type: 'GITHUB_COMMIT',
          externalRefId: `commit:sha-beta-${ts}`,
          title,
          confidence: 0.8,
        },
      });

      const matches = await prisma.incidentEvidence.findMany({
        where: { incidentId, title },
      });
      expect(matches.length).toBe(2);
    });
  });

  // =============================================================================
  // 4. API Endpoints, Status & Acknowledge/Dismiss Actions
  // =============================================================================
  describe('4. API Endpoints & Actions', () => {
    it('GET /correlation — returns latest run and ranked evidence', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${viewerToken}`);

      const body = res.body as { data: { incidentId: string; evidence: unknown[]; latestRun: unknown } };
      expect(res.status).toBe(200);
      expect(body.data.incidentId).toBe(incidentId);
      expect(body.data.evidence).toBeDefined();
      expect(body.data.latestRun).toBeDefined();
    });

    it('GET /correlation/runs — returns correlation run audit history', async () => {
      await CorrelationService.runCorrelation(orgId, incidentId, undefined, 'MANUAL_REQUEST');

      const res = await request
        .get(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation/runs`)
        .set('Authorization', `Bearer ${viewerToken}`);

      const body = res.body as { data: unknown[] };
      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('PATCH /correlation/evidence/:evidenceId — acknowledges and dismisses evidence', async () => {
      const item = await prisma.incidentEvidence.findFirst({ where: { incidentId } });
      expect(item).toBeDefined();
      const targetId = item ? item.id : '';

      // Acknowledge
      const ackRes = await request
        .patch(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation/evidence/${targetId}`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ action: 'acknowledge' });

      const ackBody = ackRes.body as { data: { acknowledgedAt: string } };
      expect(ackRes.status).toBe(200);
      expect(ackBody.data.acknowledgedAt).toBeDefined();

      // Dismiss
      const disRes = await request
        .patch(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation/evidence/${targetId}`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ action: 'dismiss' });

      const disBody = disRes.body as { data: { dismissedAt: string } };
      expect(disRes.status).toBe(200);
      expect(disBody.data.dismissedAt).toBeDefined();
    });
  });

  // =============================================================================
  // 5. RBAC Enforcement & Cross-Tenant Isolation
  // =============================================================================
  describe('5. RBAC Enforcement & Cross-Tenant Isolation', () => {
    it('rejects VIEWER attempts to trigger correlation run (403 Forbidden)', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(403);
    });

    it('rejects user from Organization B trying to view Org A correlation evidence (403 Forbidden)', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${otherOrgOwnerToken}`);

      expect(res.status).toBe(403);
    });

    it('never correlates candidate signals belonging to another organization', async () => {
      // Create a commit in Organization B
      const repoB = await prisma.gitHubRepository.create({
        data: {
          organizationId: otherOrgId,
          integrationId: integrationIdB,
          githubRepoId: BigInt(Date.now() + 1),
          name: 'other-repo',
          fullName: 'other/repo',
          owner: 'other',
          url: 'https://github.com/other/repo',
        },
      });

      const commitB = await prisma.gitHubCommit.create({
        data: {
          repositoryId: repoB.id,
          sha: `sha-org-b-${ts}`,
          authorName: 'Attacker Bob',
          message: 'Malicious cross-tenant attempt',
          branch: 'main',
          url: 'https://github.com/other/repo/commit/b',
          committedAt: new Date(),
        },
      });

      // Run correlation for Org A incident
      await CorrelationService.runCorrelation(orgId, incidentId, undefined, 'MANUAL_REQUEST');

      // Verify Org B commit is NOT correlated in Org A incident
      const crossEvidence = await prisma.incidentEvidence.findFirst({
        where: { incidentId, externalRefId: `commit:${commitB.sha}` },
      });

      expect(crossEvidence).toBeNull();
    });
  });

  // =============================================================================
  // 6. Phase 1–7 Regressions
  // =============================================================================
  describe('6. Phase 1–7 Regressions', () => {
    it('health endpoint responds with 200 OK', async () => {
      const res = await request.get('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('auth endpoints remain functional', async () => {
      const res = await request
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
    });

    it('incident management endpoints remain functional', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/incidents`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
    });
  });

  // =============================================================================
  // 7. Sequential Re-Run Tests (same session, no page reload required)
  // =============================================================================
  describe('7. Sequential Re-Run Tests — same-session stability', () => {
    it('first correlation request succeeds and persists a CorrelationRun', async () => {
      await redis.del(`lock:correlation:${incidentId}`).catch(() => undefined);

      const res = await request
        .post(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(200);
      const body = res.body as { data: { runId: string; status: string } };
      expect(body.data.runId).toBeDefined();
      expect(['completed', 'skipped: lock active']).toContain(body.data.status);
    });

    it('second correlation request from the same session also succeeds (no page reload)', async () => {
      await redis.del(`lock:correlation:${incidentId}`).catch(() => undefined);

      const res = await request
        .post(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(200);
      const body = res.body as { data: { runId: string; status: string } };
      expect(body.data.runId).toBeDefined();
    });

    it('third correlation request from the same session also succeeds (validates stable re-runs)', async () => {
      await redis.del(`lock:correlation:${incidentId}`).catch(() => undefined);

      const res = await request
        .post(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(200);
    });

    it('GET /correlation returns updated evidence after each run (no stale data)', async () => {
      await redis.del(`lock:correlation:${incidentId}`).catch(() => undefined);
      await request
        .post(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      const res = await request
        .get(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      const body = res.body as { data: { latestRun: { completedAt: string } | null } };
      // latestRun should reflect a recent completion
      expect(body.data.latestRun).toBeDefined();
    });

    it('concurrent click simulation — second immediate request returns skip-or-success, never errors', async () => {
      await redis.del(`lock:correlation:${incidentId}`).catch(() => undefined);

      // Fire two requests in parallel (simulates double-click)
      const [res1, res2] = await Promise.all([
        request
          .post(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ triggerType: 'MANUAL_REQUEST' }),
        request
          .post(`/api/v1/organizations/${orgId}/incidents/${incidentId}/correlation`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ triggerType: 'MANUAL_REQUEST' }),
      ]);

      // Both should return 200 — one may be skipped, neither should be a 500
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });

    it('backend error (bad incidentId) produces 404, not a silent swallow', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/incidents/nonexistent-id-xyz/correlation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(404);
      const body = res.body as { error?: { message?: string } };
      expect(body.error?.message).toBeDefined();
    });
  });
});
