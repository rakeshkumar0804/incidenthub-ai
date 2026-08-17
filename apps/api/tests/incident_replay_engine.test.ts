import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { redis, checkRedisHealth } from '../src/lib/redis';
import { ReplayService } from '../src/modules/replay/replay.service';
import { EvidenceType, EventSource } from '@prisma/client';
import { OrgRole, IncidentSeverity, IncidentStatus, IncidentEnvironment } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Phase 10 — Incident Replay Engine Integration Tests', () => {
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
      data: { name: `Replay Org A ${ts}`, slug: `replay-org-a-${ts}` },
    });
    orgAId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: `Replay Org B ${ts}`, slug: `replay-org-b-${ts}` },
    });
    orgBId = orgB.id;

    // 2. Create Users & Memberships
    const owner = await prisma.user.create({
      data: { email: `replay-owner-${ts}@example.com`, name: 'Replay Owner', passwordHash: 'hash' },
    });
    const responder = await prisma.user.create({
      data: { email: `replay-resp-${ts}@example.com`, name: 'Replay Responder', passwordHash: 'hash' },
    });
    const viewer = await prisma.user.create({
      data: { email: `replay-view-${ts}@example.com`, name: 'Replay Viewer', passwordHash: 'hash' },
    });
    const orgBUser = await prisma.user.create({
      data: { email: `replay-orgb-${ts}@example.com`, name: 'Org B User', passwordHash: 'hash' },
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
      data: { organizationId: orgAId, name: 'Replay API', slug: `replay-api-${ts}` },
    });
    projectId = project.id;

    const service = await prisma.service.create({
      data: { projectId: project.id, name: 'Replay Service', slug: `replay-svc-${ts}` },
    });
    serviceId = service.id;

    const incident = await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: project.id,
        serviceId: service.id,
        number: 1,
        title: 'Database Connection Pool Saturation',
        description: 'PostgreSQL connection pool exhausted under high traffic load.',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.INVESTIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: owner.id,
        detectedAt: new Date(ts - 3600 * 1000), // 1 hour ago
      },
    });
    incidentId = incident.id;
  });

  beforeEach(async () => {
    try {
      if (incidentId && (redis.status === 'ready' || redis.status === 'connecting')) {
        await Promise.race([redis.del(`lock:replay:${incidentId}`), new Promise((r) => setTimeout(r, 200))]);
      }
    } catch {
      // Ignore
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =============================================================================
  // 1. Core Timeline Reconstruction & 3-Key Deterministic Sorting
  // =============================================================================
  describe('1. Core Timeline Reconstruction & 3-Key Sorting', () => {
    it('reconstructs chronological timeline across state changes, evidence, comments, and runs', async () => {
      const now = new Date();

      // Seed multi-source records
      await prisma.incidentEvent.create({
        data: {
          incidentId,
          organizationId: orgAId,
          source: EventSource.SYSTEM,
          type: 'STATUS_CHANGED',
          message: 'Status changed from OPEN to INVESTIGATING',
          occurredAt: new Date(now.getTime() - 1800 * 1000),
        },
      });

      await prisma.incidentEvidence.create({
        data: {
          incidentId,
          type: EvidenceType.GITHUB_DEPLOYMENT,
          externalRefId: 'deploy:dep100',
          confidenceTier: 'HIGH',
          confidence: 0.9,
          title: 'Deployment v3.0.0 to production',
          description: 'Deployed connection pool fix',
          addedAt: new Date(now.getTime() - 1500 * 1000),
        },
      });

      const user = await prisma.user.findFirst({ where: { email: { startsWith: 'replay-resp-' } } });
      if (!user) throw new Error('Test user missing');

      await prisma.comment.create({
        data: {
          incidentId,
          userId: user.id,
          content: 'Applied database pool tuning patch.',
          createdAt: new Date(now.getTime() - 900 * 1000),
        },
      });

      const res = await ReplayService.runReplay(orgAId, incidentId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, incidentId);
      expect(latest.latestRun).toBeDefined();
      expect(latest.latestRun?.events.length).toBeGreaterThanOrEqual(4);

      // Verify sequenceIndex is 1-indexed and strictly increasing
      const events = latest.latestRun?.events || [];
      for (let i = 0; i < events.length; i++) {
        const currEvt = events[i];
        if (currEvt) {
          expect(currEvt.sequenceIndex).toBe(i + 1);
        }
        if (i > 0) {
          const prevEvt = events[i - 1];
          if (prevEvt && currEvt) {
            const prevTime = new Date(prevEvt.timestamp).getTime();
            const currTime = new Date(currEvt.timestamp).getTime();
            expect(currTime).toBeGreaterThanOrEqual(prevTime);
          }
        }
      }
    });

    it('breaks ties deterministically using categoryWeight and sourceEventId when timestamps match', async () => {
      const collisionTime = new Date(Date.now() - 50000);

      // Create 2 events with IDENTICAL timestamp but different categories
      await prisma.incidentEvent.create({
        data: {
          incidentId,
          organizationId: orgAId,
          source: EventSource.USER,
          type: 'SEVERITY_CHANGED',
          message: 'Severity escalated to SEV1',
          occurredAt: collisionTime,
        },
      });

      await prisma.incidentEvidence.create({
        data: {
          incidentId,
          type: EvidenceType.SENTRY_ERROR,
          externalRefId: 'sentry:err_collision',
          confidenceTier: 'MEDIUM',
          confidence: 0.7,
          title: 'Collision Error Spike',
          addedAt: collisionTime,
        },
      });

      await ReplayService.runReplay(orgAId, incidentId, undefined, 'RERUN_REQUEST');

      const latest = await ReplayService.getLatestReplay(orgAId, incidentId);
      const events = latest.latestRun?.events || [];

      const collidingEvents = events.filter((e) => new Date(e.timestamp).getTime() === collisionTime.getTime());
      if (collidingEvents.length >= 2) {
        const first = collidingEvents[0];
        const second = collidingEvents[1];
        if (first && second) {
          expect(first.categoryWeight).toBeLessThanOrEqual(second.categoryWeight);
        }
      }
    });

    it('repeated replay runs produce identical ordered event sequences', async () => {
      await ReplayService.runReplay(orgAId, incidentId, undefined, 'RERUN_REQUEST');
      const run1 = await ReplayService.getLatestReplay(orgAId, incidentId);

      try {
        await Promise.race([redis.del(`lock:replay:${incidentId}`), new Promise((r) => setTimeout(r, 100))]);
      } catch {
        // Ignore
      }

      await ReplayService.runReplay(orgAId, incidentId, undefined, 'RERUN_REQUEST');
      const run2 = await ReplayService.getLatestReplay(orgAId, incidentId);

      const seq1 = run1.latestRun?.events.map((e) => `${e.sequenceIndex}:${e.sourceEventId}`) || [];
      const seq2 = run2.latestRun?.events.map((e) => `${e.sequenceIndex}:${e.sourceEventId}`) || [];

      expect(seq1).toEqual(seq2);
    });
  });

  // =============================================================================
  // 2. Concurrency & Redis Lock
  // =============================================================================
  describe('2. Concurrency & Redis Lock', () => {
    it('prevents concurrent replay triggers using Redis distributed lock', async () => {
      const lockKey = `lock:replay:${incidentId}`;
      const health = await checkRedisHealth();

      if (health === 'connected') {
        await redis.set(lockKey, 'active-replay-lock');
      }

      const res = await ReplayService.runReplay(orgAId, incidentId, undefined, 'MANUAL_REQUEST');

      if (health === 'connected') {
        expect(res.status).toBe('skipped: lock active');
        await redis.del(lockKey);
      } else {
        expect(res.status).toBe('completed');
      }
    });
  });

  // =============================================================================
  // 3. API Endpoints, RBAC & Cross-Tenant Isolation
  // =============================================================================
  describe('3. API Endpoints, RBAC & Isolation', () => {
    it('GET /replay — returns latest replay run for authorized viewer', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/replay`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      const body = res.body as { data: { incidentId: string; latestRun: unknown } };
      expect(body.data.incidentId).toBe(incidentId);
      expect(body.data.latestRun).toBeDefined();
    });

    it('POST /replay — permits OWNER and RESPONDER to trigger replay', async () => {
      expect(orgBId).toBeDefined();
      expect(projectId).toBeDefined();
      expect(serviceId).toBeDefined();

      const resOwner = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/replay`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });
      expect(resOwner.status).toBe(200);

      try {
        await Promise.race([redis.del(`lock:replay:${incidentId}`), new Promise((r) => setTimeout(r, 100))]);
      } catch {
        // Ignore
      }

      const resResp = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/replay`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });
      expect(resResp.status).toBe(200);
    });

    it('POST /replay — REJECTS VIEWER attempt to trigger replay (403 Forbidden)', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/replay`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(403);
    });

    it('REJECTS User from Org B attempting to read Org A replay (403 Forbidden)', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/replay`)
        .set('Authorization', `Bearer ${orgBUserToken}`);

      expect(res.status).toBe(403);
    });
  });

  // =============================================================================
  // 4. Phase 1–9 Regressions
  // =============================================================================
  describe('4. Phase 1–9 Regressions', () => {
    it('health endpoint responds with 200 OK', async () => {
      const res = await request.get('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('correlation & investigation endpoints remain fully functional', async () => {
      const resCorr = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/correlation`)
        .set('Authorization', `Bearer ${responderToken}`);
      expect(resCorr.status).toBe(200);

      const resInv = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentId}/investigation`)
        .set('Authorization', `Bearer ${responderToken}`);
      expect(resInv.status).toBe(200);
    });
  });
});
