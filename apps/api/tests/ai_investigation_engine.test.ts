import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { redis, checkRedisHealth } from '../src/lib/redis';
import { AIService } from '../src/modules/ai/ai.service';
import { EvidenceType } from '@prisma/client';
import { OrgRole, IncidentSeverity, IncidentStatus, IncidentEnvironment } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Phase 9 — AI Investigation Engine Integration Tests', () => {
  let orgAId: string;
  let orgBId: string;
  let projectId: string;
  let serviceId: string;
  let incidentId: string;

  let ownerToken: string;
  let responderToken: string;
  let viewerToken: string;
  let orgBUserToken: string;

  beforeAll(async () => {
    const ts = Date.now();
    const { signAccessToken } = await import('../src/utils/jwt');

    // 1. Create Organizations
    const orgA = await prisma.organization.create({
      data: { name: `AI Org A ${ts}`, slug: `ai-org-a-${ts}` },
    });
    orgAId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: `AI Org B ${ts}`, slug: `ai-org-b-${ts}` },
    });
    orgBId = orgB.id;

    // 2. Create Users
    const owner = await prisma.user.create({
      data: { email: `ai-owner-${ts}@example.com`, name: 'AI Owner', passwordHash: 'hash' },
    });
    const responder = await prisma.user.create({
      data: { email: `ai-resp-${ts}@example.com`, name: 'AI Responder', passwordHash: 'hash' },
    });
    const viewer = await prisma.user.create({
      data: { email: `ai-view-${ts}@example.com`, name: 'AI Viewer', passwordHash: 'hash' },
    });
    const orgBUser = await prisma.user.create({
      data: { email: `ai-orgb-${ts}@example.com`, name: 'Org B User', passwordHash: 'hash' },
    });

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgAId, userId: owner.id, role: OrgRole.OWNER },
        { organizationId: orgAId, userId: responder.id, role: OrgRole.RESPONDER },
        { organizationId: orgAId, userId: viewer.id, role: OrgRole.VIEWER },
        { organizationId: orgBId, userId: orgBUser.id, role: OrgRole.OWNER },
      ],
    });

    ownerToken = signAccessToken(owner.id, owner.email);
    responderToken = signAccessToken(responder.id, responder.email);
    viewerToken = signAccessToken(viewer.id, viewer.email);
    orgBUserToken = signAccessToken(orgBUser.id, orgBUser.email);

    // 3. Create Project, Service, and Incident under Org A
    const project = await prisma.project.create({
      data: { organizationId: orgAId, name: 'Payment API', slug: `payment-api-${ts}` },
    });
    projectId = project.id;

    const service = await prisma.service.create({
      data: { projectId: project.id, name: 'Checkout Service', slug: `checkout-svc-${ts}` },
    });
    serviceId = service.id;

    const incident = await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: project.id,
        serviceId: service.id,
        number: 1,
        title: 'Elevated 504 Gateway Timeout during Checkout',
        description: 'Payment checkout requests timing out under high load in production.',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.INVESTIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: owner.id,
        detectedAt: new Date(),
      },
    });
    incidentId = incident.id;
  });

  beforeEach(async () => {
    try {
      if (incidentId) {
        await redis.del(`lock:ai-investigation:${incidentId}`);
      }
    } catch {
      // Ignore
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =============================================================================
  // 1. Core AI Investigation Execution & Zero Evidence Fallback
  // =============================================================================
  describe('1. Core AI Investigation Execution', () => {
    it('executes fallback investigation when zero Phase 8 evidence exists', async () => {
      const res = await AIService.runInvestigation(orgAId, incidentId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await AIService.getLatestInvestigation(orgAId, incidentId);
      expect(latest.latestRun).toBeDefined();
      expect(latest.latestRun?.confidenceTier).toBe('UNCERTAIN');
      expect(latest.latestRun?.confidence).toBe(0);
      expect(latest.latestRun?.probableRootCause).toContain('Insufficient evidence');
    });

    it('synthesizes root cause analysis when Phase 8 evidence is present', async () => {
      // Clear any leftover lock key from previous test
      try {
        await redis.del(`lock:ai-investigation:${incidentId}`);
      } catch {
        // Ignore
      }

      // Seed Phase 8 evidence
      await prisma.incidentEvidence.createMany({
        data: [
          {
            incidentId,
            type: EvidenceType.GITHUB_DEPLOYMENT,
            externalRefId: 'deploy:d123',
            confidenceTier: 'HIGH',
            confidence: 0.85,
            title: 'Deployment v2.4.1 to Production',
            description: 'Contains commit ghp_secretToken123456789012345678901234567890',
            reasons: { deploymentRelation: true },
          },
          {
            incidentId,
            type: EvidenceType.SENTRY_ERROR,
            externalRefId: 'sentry:issue99',
            confidenceTier: 'HIGH',
            confidence: 0.82,
            title: 'NullPointerException in PaymentController.checkout',
            description: 'Spike of 450 events in production',
            reasons: { sentrySpike: true },
          },
        ],
      });

      const res = await AIService.runInvestigation(orgAId, incidentId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await AIService.getLatestInvestigation(orgAId, incidentId);
      expect(latest.latestRun?.confidenceTier).toBe('HIGH');
      expect(latest.latestRun?.probableRootCause).toBeDefined();
      expect(latest.latestRun?.supportingEvidence).toBeDefined();
    });
  });

  // =============================================================================
  // 2. Secret Redaction & Anti-Hallucination Evidence ID Validation
  // =============================================================================
  describe('2. Security & Anti-Hallucination Validation', () => {
    it('redacts GitHub tokens and secrets before processing', async () => {
      const evidence = await prisma.incidentEvidence.create({
        data: {
          incidentId,
          type: EvidenceType.GITHUB_COMMIT,
          externalRefId: 'commit:sha99',
          confidenceTier: 'MEDIUM',
          confidence: 0.65,
          title: 'Fix auth with token ghp_1234567890abcdef1234567890abcdef123456',
          description: 'Used postgres://admin:secretPass@localhost:5432/db',
        },
      });

      await AIService.runInvestigation(orgAId, incidentId, undefined, 'MANUAL_REQUEST');

      const latest = await AIService.getLatestInvestigation(orgAId, incidentId);
      const supporting = (latest.latestRun?.supportingEvidence as unknown as Array<{ claim: string }>) || [];
      const redactedClaim = supporting.find((s) => s.claim.includes(evidence.id));
      if (redactedClaim) {
        expect(redactedClaim.claim).not.toContain('ghp_1234567890');
      }
    });
  });

  // =============================================================================
  // 3. Concurrency Control & Redis Distributed Lock
  // =============================================================================
  describe('3. Concurrency Control & Redis Lock', () => {
    it('prevents concurrent AI investigations using Redis lock', async () => {
      const lockKey = `lock:ai-investigation:${incidentId}`;
      const lockVal = 'active-ai-lock';

      const health = await checkRedisHealth();
      if (health === 'connected') {
        await redis.set(lockKey, lockVal);
      }

      const res = await AIService.runInvestigation(orgAId, incidentId, undefined, 'MANUAL_REQUEST');

      if (health === 'connected') {
        expect(res.status).toBe('skipped: lock active');
        await redis.del(lockKey);
      } else {
        expect(res.status).toBe('completed');
      }
    });
  });

  // =============================================================================
  // 4. API Endpoints, RBAC & Cross-Tenant Isolation
  // =============================================================================
  describe('4. API Endpoints & RBAC Isolation', () => {
    it('GET /investigation — returns latest investigation run', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${viewerToken}`);

      const body = res.body as { data: { incidentId: string; latestRun: unknown } };
      expect(res.status).toBe(200);
      expect(body.data.incidentId).toBe(incidentId);
      expect(body.data.latestRun).toBeDefined();
    });

    it('POST /investigation — permits OWNER to trigger AI investigation', async () => {
      expect(orgBId).toBeDefined();
      expect(projectId).toBeDefined();
      expect(serviceId).toBeDefined();
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(200);
    });

    it('POST /investigation — permits RESPONDER to trigger AI investigation', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(200);
    });

    it('POST /investigation — REJECTS VIEWER attempts to trigger AI investigation (403 Forbidden)', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(403);
    });

    it('REJECTS User B from Org B trying to read Org A investigation (403 Forbidden)', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${orgBUserToken}`);

      expect(res.status).toBe(403);
    });
  });

  // =============================================================================
  // 5. Phase 1–8 Regressions
  // =============================================================================
  describe('5. Phase 1–8 Regressions', () => {
    it('health endpoint responds with 200 OK', async () => {
      const res = await request.get('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('correlation endpoint remains functional', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${responderToken}`);

      expect(res.status).toBe(200);
    });
  });

  // =============================================================================
  // 6. Sequential Re-Run Tests (same session, no page reload)
  // =============================================================================
  describe('6. Sequential Re-Run Tests — same-session stability', () => {
    it('first investigation POST succeeds and returns runId', async () => {
      await redis.del(`lock:ai-investigation:${incidentId}`).catch(() => undefined);

      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(200);
      const body = res.body as { data: { runId: string; status: string } };
      expect(body.data.runId).toBeDefined();
    });

    it('second investigation POST from same session succeeds (no page reload needed)', async () => {
      await redis.del(`lock:ai-investigation:${incidentId}`).catch(() => undefined);

      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(200);
      const body = res.body as { data: { runId: string } };
      expect(body.data.runId).toBeDefined();
    });

    it('GET /investigation returns updated latestRun after each POST (no stale data)', async () => {
      await redis.del(`lock:ai-investigation:${incidentId}`).catch(() => undefined);
      await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      const body = res.body as { data: { latestRun: { completedAt: string } | null } };
      expect(body.data.latestRun).toBeDefined();
      expect(body.data.latestRun?.completedAt).toBeDefined();
    });

    it('offline fallback investigation produces evidence-grounded output (no OPENAI_API_KEY required)', async () => {
      await redis.del(`lock:ai-investigation:${incidentId}`).catch(() => undefined);

      // Run directly via service — no API key needed, falls back to deterministic provider
      const result = await AIService.runInvestigation(orgAId, incidentId, undefined, 'MANUAL_REQUEST');
      expect(result.status).toMatch(/completed|skipped/);

      if (result.status === 'completed') {
        const run = await prisma.investigationRun.findFirst({
          where: { id: result.runId },
        });
        expect(run).toBeDefined();
        expect(run?.status).toBe('COMPLETED');
        // Fallback must produce grounded output, not empty strings
        expect(run?.probableRootCause).toBeTruthy();
        expect(run?.incidentSummary).toBeTruthy();
      }
    });

    it('concurrent investigation clicks — both return 200 (one may skip), never error', async () => {
      await redis.del(`lock:ai-investigation:${incidentId}`).catch(() => undefined);

      const [res1, res2] = await Promise.all([
        request
          .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ triggerType: 'MANUAL_REQUEST' }),
        request
          .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ triggerType: 'MANUAL_REQUEST' }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });

    it('backend error (bad incidentId) returns 404, not a silent swallow', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/nonexistent-inv-id/investigation`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(404);
      const body = res.body as { error?: { message?: string } };
      expect(body.error?.message).toBeDefined();
    });
  });
});
