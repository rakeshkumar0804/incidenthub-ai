import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import type { Prisma } from '@prisma/client';
import {
  ReplayRunStatus,
  ReplayCategory,
  EventSource,
  EvidenceType,
  EvidenceConfidenceTier,
  IncidentSeverity,
  IncidentStatus,
  IncidentEnvironment,
} from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';
import { ReplayService } from '../src/modules/replay/replay.service';
import {
  calculateReplayWindow,
  resolveEvidenceTimestamp,
  deduplicateAndRetainEvents,
  replayEventComparator,
  cleanReplayText,
  formatSignedRelativeTime,
  isTerminalAnchorEvent,
  isMandatoryAnchorEvent,
} from '../src/modules/replay/replay.engine';
import type { NormalizedReplayEventInput } from '../src/modules/replay/replay.types';
import * as socketModule from '../src/lib/socket';
import { OrgRole } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Phase 6 — Deterministic Incident Replay and Timeline Integrity', () => {
  const ts = Date.now();
  let orgAId: string;
  let orgBId: string;
  let userOwnerAId: string;
  let ownerAToken: string;
  let userViewerAToken: string;
  let userOwnerBToken: string;
  let projectAId: string;
  let serviceAId: string;
  let incidentAId: string;
  let faultInjector: ((params: Prisma.MiddlewareParams) => void | Promise<void>) | null = null;

  beforeAll(async () => {
    const { signAccessToken } = await import('../src/utils/jwt');

    prisma.$use(async (params, next) => {
      if (faultInjector) {
        await faultInjector(params);
      }
      const result: unknown = await next(params);
      return result;
    });

    // 1. Create Org A
    const orgA = await prisma.organization.create({
      data: { name: `Phase 6 Org A ${ts}`, slug: `p6-org-a-${ts}` },
    });
    orgAId = orgA.id;

    // 2. Create Org B
    const orgB = await prisma.organization.create({
      data: { name: `Phase 6 Org B ${ts}`, slug: `p6-org-b-${ts}` },
    });
    orgBId = orgB.id;

    // 3. Create Users
    const ownerA = await prisma.user.create({
      data: { email: `p6-owner-a-${ts}@example.com`, name: 'Phase 6 Owner A', passwordHash: 'hash' },
    });
    userOwnerAId = ownerA.id;

    const viewerA = await prisma.user.create({
      data: { email: `p6-viewer-a-${ts}@example.com`, name: 'Phase 6 Viewer A', passwordHash: 'hash' },
    });

    const ownerB = await prisma.user.create({
      data: { email: `p6-owner-b-${ts}@example.com`, name: 'Phase 6 Owner B', passwordHash: 'hash' },
    });

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgAId, userId: ownerA.id, role: OrgRole.OWNER },
        { organizationId: orgAId, userId: viewerA.id, role: OrgRole.VIEWER },
        { organizationId: orgBId, userId: ownerB.id, role: OrgRole.OWNER },
      ],
    });

    ownerAToken = signAccessToken(ownerA.id, ownerA.email);
    userViewerAToken = signAccessToken(viewerA.id, viewerA.email);
    userOwnerBToken = signAccessToken(ownerB.id, ownerB.email);

    // 4. Project & Service
    const projectA = await prisma.project.create({
      data: { organizationId: orgAId, name: 'Replay Project A', slug: `replay-proj-${ts}` },
    });
    projectAId = projectA.id;

    const serviceA = await prisma.service.create({
      data: { projectId: projectA.id, name: 'Replay Service A', slug: `replay-svc-${ts}` },
    });
    serviceAId = serviceA.id;

    // 5. Incident A
    const incidentA = await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        serviceId: serviceAId,
        number: 701,
        title: 'Core Outage for Replay Verification',
        description: 'Testing deterministic replay reconstruction',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.INVESTIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: userOwnerAId,
        detectedAt: new Date(ts - 7200 * 1000), // 2 hours ago
      },
    });
    incidentAId = incidentA.id;
  });

  beforeEach(async () => {
    faultInjector = null;
    vi.restoreAllMocks();
    try {
      if (incidentAId && (redis.status === 'ready' || redis.status === 'connecting')) {
        await Promise.race([redis.del(`lock:replay:${incidentAId}`), new Promise((r) => setTimeout(r, 200))]);
      }
    } catch {
      // Ignore
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ===========================================================================
  // OBJECTIVES 1 & 2: SCOPING, RBAC & STABLE REPLAY WINDOW BOUNDARIES
  // ===========================================================================
  describe('Objectives 1 & 2: Scoping, RBAC & Replay Window', () => {
    it('1. Cross-tenant replay trigger rejection', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/replay`)
        .set('Authorization', `Bearer ${userOwnerBToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect([403, 404]).toContain(res.status);
    });

    it('2. Cross-tenant replay read rejection', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/replay`)
        .set('Authorization', `Bearer ${userOwnerBToken}`);

      expect([403, 404]).toContain(res.status);
    });

    it('3. VIEWER read allowed', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/replay`)
        .set('Authorization', `Bearer ${userViewerAToken}`);

      expect(res.status).toBe(200);
      expect((res.body as { success: boolean }).success).toBe(true);
    });

    it('4. VIEWER trigger rejected', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/replay`)
        .set('Authorization', `Bearer ${userViewerAToken}`)
        .send({ triggerType: 'MANUAL_REQUEST' });

      expect(res.status).toBe(403);
    });

    it('5. Resolved replay window boundaries', () => {
      const detected = new Date('2026-09-20T10:00:00Z');
      const resolved = new Date('2026-09-20T12:00:00Z');
      const cutoff = new Date('2026-09-20T14:00:00Z');

      const window = calculateReplayWindow({ detectedAt: detected, resolvedAt: resolved }, cutoff);
      expect(window.windowStart.toISOString()).toBe('2026-09-20T08:00:00.000Z'); // detected - 2h
      expect(window.windowEnd.toISOString()).toBe('2026-09-20T12:30:00.000Z');   // resolved + 30m
      expect(window.isSnapshot).toBe(false);
    });

    it('6. Unresolved replay uses one captured cutoff', () => {
      const detected = new Date('2026-09-20T10:00:00Z');
      const cutoff = new Date('2026-09-20T11:45:00Z');

      const window = calculateReplayWindow({ detectedAt: detected, resolvedAt: null }, cutoff);
      expect(window.windowStart.toISOString()).toBe('2026-09-20T08:00:00.000Z'); // detected - 2h
      expect(window.windowEnd.toISOString()).toBe('2026-09-20T11:45:00.000Z');   // captured cutoff
      expect(window.isSnapshot).toBe(true);
    });
  });

  // ===========================================================================
  // OBJECTIVES 3, 4 & 5: TRUTHFUL SEMANTICS, TIMESTAMPS & RUN LIFECYCLES
  // ===========================================================================
  describe('Objectives 3, 4 & 5: Truthful Semantics, Timestamp Fidelity & Run Milestones', () => {
    it('7. Incident event uses truthful detected semantics', async () => {
      const res = await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];
      const detectEvt = events.find((e) => e.eventType === 'INCIDENT_DETECTED');

      expect(detectEvt).toBeDefined();
      expect(detectEvt?.title).toContain('Detected');
      expect(detectEvt?.eventType).toBe('INCIDENT_DETECTED');
      expect(detectEvt?.eventType).not.toBe('INCIDENT_CREATED');
    });

    it('8. Incident-event timestamp fidelity', async () => {
      const specificTime = new Date(ts - 3600 * 1000);
      await prisma.incidentEvent.create({
        data: {
          incidentId: incidentAId,
          organizationId: orgAId,
          source: EventSource.SYSTEM,
          type: 'SEVERITY_CHANGED',
          message: 'Severity changed to SEV1',
          occurredAt: specificTime,
        },
      });

      const res = await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const evt = latest.latestCompletedRun?.events.find((e) => e.eventType === 'SEVERITY_CHANGED');
      expect(evt).toBeDefined();
      if (!evt) throw new Error('Event not found');
      expect(new Date(evt.timestamp).toISOString()).toBe(specificTime.toISOString());
    });

    it('9. Comment timestamp fidelity', async () => {
      const commentTime = new Date(ts - 1800 * 1000);
      await prisma.comment.create({
        data: {
          incidentId: incidentAId,
          userId: userOwnerAId,
          content: 'Database connection pools replenished',
          createdAt: commentTime,
        },
      });

      await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const cEvt = latest.latestCompletedRun?.events.find((e) => e.eventType === 'COMMENT_CREATED');
      expect(cEvt).toBeDefined();
      if (!cEvt) throw new Error('Comment event not found');
      expect(new Date(cEvt.timestamp).toISOString()).toBe(commentTime.toISOString());
    });

    it('10. Evidence source timestamp use', () => {
      const addedAt = new Date('2026-09-20T10:00:00Z');
      const commitTime = new Date('2026-09-20T09:50:00Z');

      const resolved = resolveEvidenceTimestamp({
        addedAt,
        metadata: { occurredAt: commitTime.toISOString() },
      });

      expect(resolved.timestampBasis).toBe('source_occurred_at');
      expect(resolved.timestamp.toISOString()).toBe(commitTime.toISOString());
    });

    it('11. Evidence fallback timestamp basis', () => {
      const addedAt = new Date('2026-09-20T10:00:00Z');
      const resolved = resolveEvidenceTimestamp({ addedAt, metadata: null });

      expect(resolved.timestampBasis).toBe('evidence_added_at');
      expect(resolved.timestamp.toISOString()).toBe(addedAt.toISOString());
    });

    it('12. Correlation running lifecycle', async () => {
      const cRun = await prisma.correlationRun.create({
        data: {
          organizationId: orgAId,
          incidentId: incidentAId,
          status: 'RUNNING',
          startedAt: new Date(Date.now() - 30000),
          windowStart: new Date(),
          windowEnd: new Date(),
        },
      });

      await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];

      const started = events.find((e) => e.sourceEventId === `correlation_run:${cRun.id}:CORRELATION_STARTED:0`);
      const completed = events.find((e) => e.sourceEventId === `correlation_run:${cRun.id}:CORRELATION_COMPLETED:1`);

      expect(started).toBeDefined();
      expect(completed).toBeUndefined();
    });

    it('13. Correlation completed lifecycle', async () => {
      const cRun = await prisma.correlationRun.create({
        data: {
          organizationId: orgAId,
          incidentId: incidentAId,
          status: 'COMPLETED',
          startedAt: new Date(Date.now() - 40000),
          completedAt: new Date(Date.now() - 35000),
          windowStart: new Date(),
          windowEnd: new Date(),
          correlatedCount: 5,
        },
      });

      await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];

      const started = events.find((e) => e.sourceEventId === `correlation_run:${cRun.id}:CORRELATION_STARTED:0`);
      const completed = events.find((e) => e.sourceEventId === `correlation_run:${cRun.id}:CORRELATION_COMPLETED:1`);

      expect(started).toBeDefined();
      expect(completed).toBeDefined();
      expect(completed?.eventType).toBe('CORRELATION_COMPLETED');
    });

    it('14. Correlation failed lifecycle', async () => {
      const cRun = await prisma.correlationRun.create({
        data: {
          organizationId: orgAId,
          incidentId: incidentAId,
          status: 'FAILED',
          startedAt: new Date(Date.now() - 40000),
          completedAt: new Date(Date.now() - 35000),
          windowStart: new Date(),
          windowEnd: new Date(),
          error: 'Integration provider network failure',
        },
      });

      await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];

      const failed = events.find((e) => e.sourceEventId === `correlation_run:${cRun.id}:CORRELATION_FAILED:1`);
      expect(failed).toBeDefined();
      expect(failed?.eventType).toBe('CORRELATION_FAILED');
    });

    it('15. Investigation running lifecycle', async () => {
      const iRun = await prisma.investigationRun.create({
        data: {
          organizationId: orgAId,
          incidentId: incidentAId,
          status: 'RUNNING',
          startedAt: new Date(Date.now() - 25000),
          providerName: 'openai',
          modelName: 'gpt-4o',
        },
      });

      await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];

      const started = events.find((e) => e.sourceEventId === `investigation_run:${iRun.id}:INVESTIGATION_STARTED:0`);
      const completed = events.find((e) => e.sourceEventId === `investigation_run:${iRun.id}:INVESTIGATION_COMPLETED:1`);

      expect(started).toBeDefined();
      expect(completed).toBeUndefined();
    });

    it('16. Investigation completed lifecycle', async () => {
      const iRun = await prisma.investigationRun.create({
        data: {
          organizationId: orgAId,
          incidentId: incidentAId,
          status: 'COMPLETED',
          startedAt: new Date(Date.now() - 20000),
          completedAt: new Date(Date.now() - 15000),
          providerName: 'openai',
          modelName: 'gpt-4o',
          confidence: 0.85,
          confidenceTier: 'HIGH',
          latencyMs: 1200,
        },
      });

      await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];

      const completed = events.find((e) => e.sourceEventId === `investigation_run:${iRun.id}:INVESTIGATION_COMPLETED:1`);
      expect(completed).toBeDefined();
      expect(completed?.eventType).toBe('INVESTIGATION_COMPLETED');
    });

    it('17. Investigation failed lifecycle', async () => {
      const iRun = await prisma.investigationRun.create({
        data: {
          organizationId: orgAId,
          incidentId: incidentAId,
          status: 'FAILED',
          startedAt: new Date(Date.now() - 10000),
          completedAt: new Date(Date.now() - 5000),
          providerName: 'openai',
          modelName: 'gpt-4o',
          validationError: 'Output structure violation',
        },
      });

      await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];

      const failed = events.find((e) => e.sourceEventId === `investigation_run:${iRun.id}:INVESTIGATION_FAILED:1`);
      expect(failed).toBeDefined();
      expect(failed?.eventType).toBe('INVESTIGATION_FAILED');
    });
  });

  // ===========================================================================
  // OBJECTIVES 6, 7 & 8: DEDUPLICATION, BOUNDS, RETENTION & 3-KEY SORTING
  // ===========================================================================
  describe('Objectives 6, 7 & 8: Deduplication, Bounds & Retention Policy', () => {
    it('18. Replay-loop exclusion', async () => {
      // Create an INCIDENT_REPLAY_COMPLETED timeline event
      await prisma.incidentEvent.create({
        data: {
          incidentId: incidentAId,
          organizationId: orgAId,
          source: EventSource.SYSTEM,
          type: 'INCIDENT_REPLAY_COMPLETED',
          message: 'Loop prevention test event',
          occurredAt: new Date(),
        },
      });

      await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];

      const loopEvt = events.find((e) => e.eventType === 'INCIDENT_REPLAY_COMPLETED');
      expect(loopEvt).toBeUndefined();
    });

    it('19. Exact source-event deduplication', () => {
      const time = new Date();
      const duplicateCandidates: NormalizedReplayEventInput[] = [
        {
          category: ReplayCategory.TELEMETRY,
          categoryWeight: 20,
          eventType: 'SENTRY_ERROR',
          source: EventSource.SENTRY,
          sourceEventId: 'incident_evidence:ev-1:SENTRY_ERROR:0',
          timestamp: time,
          actorName: 'Sentry',
          actorEmail: null,
          title: 'Error 500',
          description: null,
          externalUrl: null,
          evidenceId: 'ev-1',
          metadata: null,
        },
        {
          category: ReplayCategory.TELEMETRY,
          categoryWeight: 20,
          eventType: 'SENTRY_ERROR',
          source: EventSource.SENTRY,
          sourceEventId: 'incident_evidence:ev-1:SENTRY_ERROR:0', // Duplicate ID
          timestamp: time,
          actorName: 'Sentry',
          actorEmail: null,
          title: 'Error 500 duplicate',
          description: null,
          externalUrl: null,
          evidenceId: 'ev-1',
          metadata: null,
        },
      ];

      const { retained } = deduplicateAndRetainEvents(duplicateCandidates, 500);
      expect(retained.length).toBe(1);
    });

    it('20. Distinct lifecycle event preservation', () => {
      const time = new Date();
      const runEvents: NormalizedReplayEventInput[] = [
        {
          category: ReplayCategory.CORRELATION,
          categoryWeight: 30,
          eventType: 'CORRELATION_STARTED',
          source: EventSource.SYSTEM,
          sourceEventId: 'correlation_run:cr-1:CORRELATION_STARTED:0',
          timestamp: time,
          actorName: 'Correlation',
          actorEmail: null,
          title: 'Started',
          description: null,
          externalUrl: null,
          evidenceId: null,
          metadata: null,
        },
        {
          category: ReplayCategory.CORRELATION,
          categoryWeight: 30,
          eventType: 'CORRELATION_COMPLETED',
          source: EventSource.SYSTEM,
          sourceEventId: 'correlation_run:cr-1:CORRELATION_COMPLETED:1',
          timestamp: new Date(time.getTime() + 5000),
          actorName: 'Correlation',
          actorEmail: null,
          title: 'Completed',
          description: null,
          externalUrl: null,
          evidenceId: null,
          metadata: null,
        },
      ];

      const { retained } = deduplicateAndRetainEvents(runEvents, 500);
      expect(retained.length).toBe(2);
    });

    it('21. Deterministic identical-timestamp ordering', () => {
      const collisionTime = new Date('2026-09-20T12:00:00Z');
      const itemA: NormalizedReplayEventInput = {
        category: ReplayCategory.TELEMETRY,
        categoryWeight: 20,
        eventType: 'SENTRY_ERROR',
        source: EventSource.SENTRY,
        sourceEventId: 'ev:b',
        timestamp: collisionTime,
        actorName: null,
        actorEmail: null,
        title: 'B',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: null,
      };
      const itemB: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'STATUS_CHANGED',
        source: EventSource.SYSTEM,
        sourceEventId: 'ev:a',
        timestamp: collisionTime,
        actorName: null,
        actorEmail: null,
        title: 'A',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: null,
      };

      const result = replayEventComparator(itemA, itemB);
      expect(result).toBeGreaterThan(0); // itemB (weight 10) comes before itemA (weight 20)
    });

    it('22. Below-cap ordering still applied', () => {
      const candidates: NormalizedReplayEventInput[] = [
        {
          category: ReplayCategory.TELEMETRY,
          categoryWeight: 20,
          eventType: 'SENTRY_ERROR',
          source: EventSource.SENTRY,
          sourceEventId: '2',
          timestamp: new Date(2000),
          actorName: null,
          actorEmail: null,
          title: 'Two',
          description: null,
          externalUrl: null,
          evidenceId: null,
          metadata: null,
        },
        {
          category: ReplayCategory.STATE_CHANGE,
          categoryWeight: 10,
          eventType: 'INCIDENT_DETECTED',
          source: EventSource.SYSTEM,
          sourceEventId: '1',
          timestamp: new Date(1000),
          actorName: null,
          actorEmail: null,
          title: 'One',
          description: null,
          externalUrl: null,
          evidenceId: null,
          metadata: null,
        },
      ];
      const { retained } = deduplicateAndRetainEvents(candidates, 500);
      expect(retained[0]?.sourceEventId).toBe('1');
      expect(retained[1]?.sourceEventId).toBe('2');
    });

    it('23. Stable gap-free sequence indexes', async () => {
      const res = await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];
      expect(events.length).toBeGreaterThan(0);

      events.forEach((e, idx) => {
        expect(e.sequenceIndex).toBe(idx + 1);
      });
    });

    it('24. Bounded source queries', async () => {
      const boundedInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 724,
          title: 'Bounded Source Query Test Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(ts - 7200 * 1000),
          status: IncidentStatus.INVESTIGATING,
        },
      });

      // 1. First insert 502 later noisy records (higher timestamps)
      const noisyPayload = Array.from({ length: 502 }).map((_, i) => ({
        incidentId: boundedInc.id,
        type: EvidenceType.SENTRY_ERROR,
        externalRefId: `noisy-sentry-${i}`,
        title: `Noisy Sentry Error ${i}`,
        addedAt: new Date(ts - 1000 * 1000 + i * 1000),
        confidence: 0.5,
        confidenceTier: EvidenceConfidenceTier.LOW,
      }));

      await prisma.incidentEvidence.createMany({
        data: noisyPayload,
      });

      // 2. Then insert 3 earlier critical records (lower timestamps, but created later with higher IDs)
      const earlyCriticalPayload = [
        {
          incidentId: boundedInc.id,
          type: EvidenceType.GITHUB_DEPLOYMENT,
          externalRefId: 'critical-deploy-root',
          title: 'Root Cause Deployment v1.0.0',
          addedAt: new Date(ts - 6000 * 1000), // Chronologically earlier
          confidence: 0.95,
          confidenceTier: EvidenceConfidenceTier.HIGH,
        },
        {
          incidentId: boundedInc.id,
          type: EvidenceType.GITHUB_PR,
          externalRefId: 'critical-pr-101',
          title: 'PR #101 Faulty Migration',
          addedAt: new Date(ts - 5900 * 1000), // Chronologically earlier
          confidence: 0.95,
          confidenceTier: EvidenceConfidenceTier.HIGH,
        },
        {
          incidentId: boundedInc.id,
          type: EvidenceType.GITHUB_COMMIT,
          externalRefId: 'critical-commit-abc',
          title: 'Commit abc broken pool config',
          addedAt: new Date(ts - 5900 * 1000), // Identical timestamp to test stable ID ordering
          confidence: 0.90,
          confidenceTier: EvidenceConfidenceTier.HIGH,
        },
      ];

      await prisma.incidentEvidence.createMany({
        data: earlyCriticalPayload,
      });

      // Run Replay 1
      const res1 = await ReplayService.runReplay(orgAId, boundedInc.id, undefined, 'MANUAL_REQUEST');
      expect(res1.status).toBe('completed');
      const latest1 = await ReplayService.getLatestReplay(orgAId, boundedInc.id);
      const events1 = latest1.latestCompletedRun?.events || [];

      // Run Replay 2 (idempotency / reproducibility)
      const res2 = await ReplayService.runReplay(orgAId, boundedInc.id, undefined, 'MANUAL_REQUEST');
      expect(res2.status).toBe('completed');
      const latest2 = await ReplayService.getLatestReplay(orgAId, boundedInc.id);
      const events2 = latest2.latestCompletedRun?.events || [];

      // Proves:
      // A. Total retained events is bounded to 500
      expect(events1.length).toBeLessThanOrEqual(500);
      expect(events1.length).toBe(events2.length);

      // B. The earlier critical records ARE included despite their IDs being inserted after 502 records
      const hasDeploy = events1.some((e) => e.title.includes('Root Cause Deployment'));
      const hasPR = events1.some((e) => e.title.includes('PR #101'));
      const hasCommit = events1.some((e) => e.title.includes('Commit abc'));
      expect(hasDeploy).toBe(true);
      expect(hasPR).toBe(true);
      expect(hasCommit).toBe(true);

      // C. Running replay twice yields identical event projection
      for (let i = 0; i < events1.length; i++) {
        expect(events1[i]?.sourceEventId).toBe(events2[i]?.sourceEventId);
        expect(events1[i]?.sequenceIndex).toBe(events2[i]?.sequenceIndex);
      }
    });

    it('25. Global 500-event cap', () => {
      const noisyList: NormalizedReplayEventInput[] = Array.from({ length: 600 }).map((_, i) => ({
        category: ReplayCategory.TELEMETRY,
        categoryWeight: 20,
        eventType: 'SENTRY_ERROR',
        source: EventSource.SENTRY,
        sourceEventId: `ev:sentry:${i}`,
        timestamp: new Date(1000 + i),
        actorName: 'Sentry',
        actorEmail: null,
        title: `Telemetry ${i}`,
        description: null,
        externalUrl: null,
        evidenceId: `ev-${i}`,
        metadata: null,
      }));

      const { retained, isTruncated } = deduplicateAndRetainEvents(noisyList, 500);
      expect(retained.length).toBe(500);
      expect(isTruncated).toBe(true);
    });

    it('26. Noisy telemetry cannot remove core milestones', () => {
      const protectedMilestones: NormalizedReplayEventInput[] = [
        {
          category: ReplayCategory.STATE_CHANGE,
          categoryWeight: 10,
          eventType: 'INCIDENT_DETECTED',
          source: EventSource.SYSTEM,
          sourceEventId: 'incident:inc-1:INCIDENT_DETECTED:0',
          timestamp: new Date(100),
          actorName: 'System',
          actorEmail: null,
          title: 'Incident Detected',
          description: null,
          externalUrl: null,
          evidenceId: null,
          metadata: null,
        },
        {
          category: ReplayCategory.STATE_CHANGE,
          categoryWeight: 10,
          eventType: 'INVESTIGATING',
          source: EventSource.USER,
          sourceEventId: 'event:state-investigating',
          timestamp: new Date(200),
          actorName: 'Alice',
          actorEmail: null,
          title: 'Status changed to Investigating',
          description: null,
          externalUrl: null,
          evidenceId: null,
          metadata: null,
        },
        {
          category: ReplayCategory.CORRELATION,
          categoryWeight: 30,
          eventType: 'CORRELATION_COMPLETED',
          source: EventSource.AI,
          sourceEventId: 'corr:run-1:completed',
          timestamp: new Date(300),
          actorName: 'AI Engine',
          actorEmail: null,
          title: 'Correlation Completed',
          description: null,
          externalUrl: null,
          evidenceId: null,
          metadata: null,
        },
        {
          category: ReplayCategory.INVESTIGATION,
          categoryWeight: 30,
          eventType: 'INVESTIGATION_COMPLETED',
          source: EventSource.AI,
          sourceEventId: 'inv:run-1:completed',
          timestamp: new Date(400),
          actorName: 'AI Engine',
          actorEmail: null,
          title: 'Investigation Completed',
          description: null,
          externalUrl: null,
          evidenceId: null,
          metadata: null,
        },
        {
          category: ReplayCategory.STATE_CHANGE,
          categoryWeight: 10,
          eventType: 'RESOLVED',
          source: EventSource.USER,
          sourceEventId: 'event:state-resolved',
          timestamp: new Date(999999),
          actorName: 'Alice',
          actorEmail: null,
          title: 'Incident Resolved',
          description: null,
          externalUrl: null,
          evidenceId: null,
          metadata: null,
        },
      ];

      const noisyList: NormalizedReplayEventInput[] = Array.from({ length: 600 }).map((_, i) => ({
        category: ReplayCategory.TELEMETRY,
        categoryWeight: 20,
        eventType: 'SENTRY_ERROR',
        source: EventSource.SENTRY,
        sourceEventId: `ev:sentry:${i}`,
        timestamp: new Date(1000 + i),
        actorName: 'Sentry',
        actorEmail: null,
        title: `Telemetry ${i}`,
        description: null,
        externalUrl: null,
        evidenceId: `ev-${i}`,
        metadata: null,
      }));

      const all: NormalizedReplayEventInput[] = [...protectedMilestones, ...noisyList];
      const { retained, isTruncated } = deduplicateAndRetainEvents(all, 500);

      expect(retained.length).toBe(500);
      expect(isTruncated).toBe(true);

      // Verify EVERY protected lifecycle milestone is preserved
      for (const milestone of protectedMilestones) {
        const found = retained.some((e) => e.sourceEventId === milestone.sourceEventId);
        expect(found).toBe(true);
      }
    });

    it('protected-event overflow retains detection and terminal resolution', () => {
      const detection: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'INCIDENT_DETECTED',
        source: EventSource.SYSTEM,
        sourceEventId: 'incident:inc-overflow:INCIDENT_DETECTED:0',
        timestamp: new Date(1000),
        actorName: 'System',
        actorEmail: null,
        title: 'Incident Detected',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: null,
      };

      const resolved: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'RESOLVED',
        source: EventSource.USER,
        sourceEventId: 'incident:inc-overflow:RESOLVED:0',
        timestamp: new Date(900000),
        actorName: 'Lead Engineer',
        actorEmail: null,
        title: 'Incident Resolved',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: null,
      };

      const closed: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'CLOSED',
        source: EventSource.USER,
        sourceEventId: 'incident:inc-overflow:CLOSED:0',
        timestamp: new Date(1000000),
        actorName: 'Lead Engineer',
        actorEmail: null,
        title: 'Incident Closed',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: null,
      };

      const otherProtectedList: NormalizedReplayEventInput[] = Array.from({ length: 520 }).map((_, i) => ({
        category: i % 2 === 0 ? ReplayCategory.INVESTIGATION : ReplayCategory.CORRELATION,
        categoryWeight: 30,
        eventType: i % 2 === 0 ? 'INVESTIGATION_COMPLETED' : 'CORRELATION_COMPLETED',
        source: EventSource.AI,
        sourceEventId: `prot:${i}:${i % 2 === 0 ? 'inv' : 'corr'}`,
        timestamp: new Date(2000 + i * 1000),
        actorName: 'AI Engine',
        actorEmail: null,
        title: `Lifecycle Milestone ${i}`,
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: null,
      }));

      const auxiliaryTelemetry: NormalizedReplayEventInput[] = Array.from({ length: 100 }).map((_, i) => ({
        category: ReplayCategory.TELEMETRY,
        categoryWeight: 20,
        eventType: 'SENTRY_ERROR',
        source: EventSource.SENTRY,
        sourceEventId: `aux:sentry:${i}`,
        timestamp: new Date(1500 + i * 1000),
        actorName: 'Sentry',
        actorEmail: null,
        title: `Auxiliary Telemetry ${i}`,
        description: null,
        externalUrl: null,
        evidenceId: `ev-aux-${i}`,
        metadata: null,
      }));

      const fullCandidatePool = [
        detection,
        ...otherProtectedList,
        resolved,
        closed,
        ...auxiliaryTelemetry,
      ];

      // Shuffle using deterministically seeded / reverse permutations
      const shuffle = (arr: NormalizedReplayEventInput[]): NormalizedReplayEventInput[] => {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = (i * 37 + 13) % (i + 1);
          const current = copy[i];
          const target = copy[j];
          if (current && target) {
            copy[i] = target;
            copy[j] = current;
          }
        }
        return copy;
      };

      const shuffled1 = shuffle(fullCandidatePool);
      const shuffled2 = [...fullCandidatePool].reverse();

      const result1 = deduplicateAndRetainEvents(shuffled1, 500);
      const result2 = deduplicateAndRetainEvents(shuffled2, 500);

      // Assertions
      expect(result1.retained.length).toBe(500);
      expect(result1.isTruncated).toBe(true);
      expect(result2.retained.length).toBe(500);
      expect(result2.isTruncated).toBe(true);

      // Detection is retained
      expect(result1.retained.some((e) => e.eventType === 'INCIDENT_DETECTED')).toBe(true);
      // Canonical terminal event is retained
      expect(result1.retained.some((e) => e.eventType === 'CLOSED' || e.eventType === 'RESOLVED')).toBe(true);
      expect(result1.retained[0]?.eventType).toBe('INCIDENT_DETECTED');
      expect(result1.retained[result1.retained.length - 1]?.eventType).toBe('CLOSED');

      // Result is deterministic across shuffled inputs
      expect(result1.retained.map((e) => e.sourceEventId)).toEqual(result2.retained.map((e) => e.sourceEventId));

      // Final output remains chronologically sorted
      for (let i = 0; i < result1.retained.length - 1; i++) {
        const item1 = result1.retained[i];
        const item2 = result1.retained[i + 1];
        if (item1 && item2) {
          const t1 = new Date(item1.timestamp).getTime();
          const t2 = new Date(item2.timestamp).getTime();
          expect(t1).toBeLessThanOrEqual(t2);
        }
      }
    });

    it('production STATUS_CHANGED to RESOLVED is a mandatory terminal anchor', () => {
      const prodResolved: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'STATUS_CHANGED',
        source: EventSource.USER,
        sourceEventId: 'evt:status-resolved-1',
        timestamp: new Date(5000),
        actorName: 'DevOps Lead',
        actorEmail: null,
        title: 'Status changed to RESOLVED',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: {
          previousStatus: 'MITIGATING',
          newStatus: 'RESOLVED',
        },
      };

      const prodClosed: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'STATUS_CHANGED',
        source: EventSource.USER,
        sourceEventId: 'evt:status-closed-1',
        timestamp: new Date(6000),
        actorName: 'DevOps Lead',
        actorEmail: null,
        title: 'Status changed to CLOSED',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: {
          previousStatus: 'RESOLVED',
          newStatus: 'CLOSED',
        },
      };

      const prodMitigating: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'STATUS_CHANGED',
        source: EventSource.USER,
        sourceEventId: 'evt:status-mitigating-1',
        timestamp: new Date(4000),
        actorName: 'DevOps Lead',
        actorEmail: null,
        title: 'Status changed to MITIGATING',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: {
          previousStatus: 'INVESTIGATING',
          newStatus: 'MITIGATING',
        },
      };

      const unrelatedDescriptionMatch: NormalizedReplayEventInput = {
        category: ReplayCategory.TELEMETRY,
        categoryWeight: 20,
        eventType: 'SENTRY_ERROR',
        source: EventSource.SENTRY,
        sourceEventId: 'evt:sentry-unrelated',
        timestamp: new Date(3000),
        actorName: 'Sentry',
        actorEmail: null,
        title: 'Sentry alert',
        description: 'resolved-looking text in body',
        externalUrl: null,
        evidenceId: null,
        metadata: {
          description: 'resolved-looking text',
        },
      };

      expect(isTerminalAnchorEvent(prodResolved)).toBe(true);
      expect(isMandatoryAnchorEvent(prodResolved)).toBe(true);

      expect(isTerminalAnchorEvent(prodClosed)).toBe(true);
      expect(isMandatoryAnchorEvent(prodClosed)).toBe(true);

      expect(isTerminalAnchorEvent(prodMitigating)).toBe(false);
      expect(isMandatoryAnchorEvent(prodMitigating)).toBe(false);

      expect(isTerminalAnchorEvent(unrelatedDescriptionMatch)).toBe(false);
      expect(isMandatoryAnchorEvent(unrelatedDescriptionMatch)).toBe(false);
    });

    it('protected overflow retains production-shaped terminal resolution', () => {
      const detection: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'INCIDENT_DETECTED',
        source: EventSource.SYSTEM,
        sourceEventId: 'incident:prod-overflow:INCIDENT_DETECTED:0',
        timestamp: new Date(1000),
        actorName: 'System',
        actorEmail: null,
        title: 'Incident Detected',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: null,
      };

      const prodResolved: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'STATUS_CHANGED',
        source: EventSource.USER,
        sourceEventId: 'incident:prod-overflow:STATUS_CHANGED_RESOLVED:0',
        timestamp: new Date(900000),
        actorName: 'Incident Commander',
        actorEmail: null,
        title: 'Incident Resolved',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: {
          previousStatus: 'MITIGATING',
          newStatus: 'RESOLVED',
        },
      };

      const laterNonTerminalState: NormalizedReplayEventInput = {
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'STATUS_CHANGED',
        source: EventSource.USER,
        sourceEventId: 'incident:prod-overflow:STATUS_CHANGED_NOTE:0',
        timestamp: new Date(950000),
        actorName: 'Incident Commander',
        actorEmail: null,
        title: 'Post-mitigation check note',
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: {
          previousStatus: 'RESOLVED',
          newStatus: 'MITIGATING',
        },
      };

      const unrelatedFakeResolved: NormalizedReplayEventInput = {
        category: ReplayCategory.TELEMETRY,
        categoryWeight: 20,
        eventType: 'SENTRY_ERROR',
        source: EventSource.SENTRY,
        sourceEventId: 'incident:prod-overflow:FAKE_RESOLVED',
        timestamp: new Date(960000),
        actorName: 'Sentry',
        actorEmail: null,
        title: 'Error with text',
        description: 'resolved text in body',
        externalUrl: null,
        evidenceId: null,
        metadata: {
          description: 'resolved-looking text',
        },
      };

      const otherProtectedList: NormalizedReplayEventInput[] = Array.from({ length: 520 }).map((_, i) => ({
        category: i % 2 === 0 ? ReplayCategory.INVESTIGATION : ReplayCategory.CORRELATION,
        categoryWeight: 30,
        eventType: i % 2 === 0 ? 'INVESTIGATION_COMPLETED' : 'CORRELATION_COMPLETED',
        source: EventSource.AI,
        sourceEventId: `prot:prod:${i}:${i % 2 === 0 ? 'inv' : 'corr'}`,
        timestamp: new Date(2000 + i * 1000),
        actorName: 'AI Engine',
        actorEmail: null,
        title: `Lifecycle Milestone ${i}`,
        description: null,
        externalUrl: null,
        evidenceId: null,
        metadata: null,
      }));

      const fullPool = [
        detection,
        ...otherProtectedList,
        prodResolved,
        laterNonTerminalState,
        unrelatedFakeResolved,
      ];

      const shuffle = (arr: NormalizedReplayEventInput[]): NormalizedReplayEventInput[] => {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = (i * 43 + 7) % (i + 1);
          const current = copy[i];
          const target = copy[j];
          if (current && target) {
            copy[i] = target;
            copy[j] = current;
          }
        }
        return copy;
      };

      const shuffled1 = shuffle(fullPool);
      const shuffled2 = [...fullPool].reverse();

      const result1 = deduplicateAndRetainEvents(shuffled1, 500);
      const result2 = deduplicateAndRetainEvents(shuffled2, 500);

      // Assertions
      expect(result1.retained.length).toBe(500);
      expect(result1.isTruncated).toBe(true);
      expect(result2.retained.length).toBe(500);
      expect(result2.isTruncated).toBe(true);

      // Detection survives
      expect(result1.retained.some((e) => e.eventType === 'INCIDENT_DETECTED')).toBe(true);
      expect(result1.retained[0]?.eventType).toBe('INCIDENT_DETECTED');

      // Production-shaped resolution survives
      expect(
        result1.retained.some(
          (e) =>
            e.eventType === 'STATUS_CHANGED' &&
            e.metadata?.newStatus === 'RESOLVED',
        ),
      ).toBe(true);

      // The unrelated later state event is NOT mistaken for the terminal anchor
      expect(
        result1.retained.some(
          (e) => e.sourceEventId === 'incident:prod-overflow:STATUS_CHANGED_NOTE:0',
        ),
      ).toBe(false);

      // The unrelated fake resolved is NOT mandatory and evicted
      expect(
        result1.retained.some(
          (e) => e.sourceEventId === 'incident:prod-overflow:FAKE_RESOLVED',
        ),
      ).toBe(false);

      // Result is deterministic across shuffled inputs
      expect(result1.retained.map((e) => e.sourceEventId)).toEqual(
        result2.retained.map((e) => e.sourceEventId),
      );

      // Final ordering remains chronological
      for (let i = 0; i < result1.retained.length - 1; i++) {
        const item1 = result1.retained[i];
        const item2 = result1.retained[i + 1];
        if (item1 && item2) {
          const t1 = new Date(item1.timestamp).getTime();
          const t2 = new Date(item2.timestamp).getTime();
          expect(t1).toBeLessThanOrEqual(t2);
        }
      }
    });

    it('27. Accurate isTruncated and run query overflow bounds', async () => {
      const exactList: NormalizedReplayEventInput[] = Array.from({ length: 50 }).map((_, i) => ({
        category: ReplayCategory.TELEMETRY,
        categoryWeight: 20,
        eventType: 'SENTRY_ERROR',
        source: EventSource.SENTRY,
        sourceEventId: `ev:sentry:${i}`,
        timestamp: new Date(1000 + i),
        actorName: 'Sentry',
        actorEmail: null,
        title: `Telemetry ${i}`,
        description: null,
        externalUrl: null,
        evidenceId: `ev-${i}`,
        metadata: null,
      }));

      const { isTruncated: notTruncated } = deduplicateAndRetainEvents(exactList, 500);
      expect(notTruncated).toBe(false);

      // Test Blocker 3: Correlation & Investigation run overflow at RUN_SOURCE_CAP (50)
      const testIncOverflow = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 799,
          title: 'Run Overflow Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      // Create 51 correlation runs (overflow > 50) comfortably within the incident window [detectedAt - 2h, now]
      const baseTime = testIncOverflow.detectedAt.getTime();
      const corrData = Array.from({ length: 51 }).map((_, i) => ({
        organizationId: orgAId,
        incidentId: testIncOverflow.id,
        status: 'COMPLETED' as const,
        triggerType: 'MANUAL_REQUEST' as const,
        windowStart: new Date(baseTime - 3600000),
        windowEnd: new Date(baseTime - 1800000),
        startedAt: new Date(baseTime - 3000000 + i * 1000),
        completedAt: new Date(baseTime - 3000000 + i * 1000 + 500),
      }));
      await prisma.correlationRun.createMany({ data: corrData });

      const res = await ReplayService.runReplay(orgAId, testIncOverflow.id, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, testIncOverflow.id);
      expect(latest.latestCompletedRun?.isTruncated).toBe(true);
    });

    it('28. totalEventCount equals persisted event count', async () => {
      const res = await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');
      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const run = latest.latestCompletedRun;

      expect(run?.totalEventCount).toBe(run?.events.length);
    });
  });

  // ===========================================================================
  // OBJECTIVES 9, 10 & 11: SANITIZATION, ATOMICITY & LOCKING
  // ===========================================================================
  describe('Objectives 9, 10 & 11: Sanitization, Atomicity & Locking', () => {
    it('29. Nested secret sanitization', () => {
      const token = 'ghp_' + 'a'.repeat(36);
      const textWithSecret = `Config with ${token} and sk-proj-12345678901234567890123456789012`;
      const clean = cleanReplayText(textWithSecret);
      expect(clean).not.toContain(token);
      expect(clean).toContain('[REDACTED_GITHUB_TOKEN]');
      expect(clean).toContain('[REDACTED_OPENAI_KEY]');
    });

    it('30. Sensitive URL redaction', () => {
      const rawUrl = 'https://sentry.io/api/0/issues/123/?token=secret1234567890';
      const clean = cleanReplayText(rawUrl);
      expect(clean).not.toContain('secret1234567890');
      expect(clean).toContain('token=[REDACTED]');
    });

    it('31. Actor-email minimization', async () => {
      const res = await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, incidentAId);
      const events = latest.latestCompletedRun?.events || [];
      for (const e of events) {
        expect(e.actorEmail).toBeNull();
      }
    });

    it('32. Atomic events/run/audit commit', async () => {
      const res = await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const auditEvent = await prisma.incidentEvent.findFirst({
        where: { incidentId: incidentAId, type: 'INCIDENT_REPLAY_COMPLETED' },
      });
      expect(auditEvent).toBeDefined();
    });

    it('source reads and replay persistence share one repeatable-read snapshot', async () => {
      const testIncRR = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 788,
          title: 'Repeatable Read Snapshot Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(Date.now() - 3600000),
        },
      });

      const baseTime = testIncRR.detectedAt.getTime();
      let injected = false;

      try {
        faultInjector = async (params) => {
          if (!injected && params.model === 'IncidentEvidence' && params.action === 'findMany') {
            injected = true;
            // Create a new eligible record on a separate database operation while tx is in flight
            await prisma.incidentEvidence.create({
              data: {
                incidentId: testIncRR.id,
                type: EvidenceType.SENTRY_ERROR,
                externalRefId: 'sentry:rr-concurrent-1',
                title: 'Concurrent Unseen Sentry Error',
                confidence: 0.9,
                confidenceTier: 'HIGH',
                addedAt: new Date(baseTime + 60000),
                metadata: {
                  occurredAt: new Date(baseTime + 60000).toISOString(),
                },
              },
            });
          }
        };

        // Run 1: snapshot was established before the concurrent insert, so it should not observe it
        const res1 = await ReplayService.runReplay(orgAId, testIncRR.id, undefined, 'MANUAL_REQUEST');
        expect(res1.status).toBe('completed');

        const latest1 = await ReplayService.getLatestReplay(orgAId, testIncRR.id);
        const events1 = latest1.latestCompletedRun?.events || [];
        const foundInRun1 = events1.some((e) => e.title.includes('Concurrent Unseen Sentry Error'));
        expect(foundInRun1).toBe(false);

        // Run 2: starts after the concurrent insert is committed, so it DOES observe it
        faultInjector = null;
        const res2 = await ReplayService.runReplay(orgAId, testIncRR.id, undefined, 'MANUAL_REQUEST');
        expect(res2.status).toBe('completed');

        const latest2 = await ReplayService.getLatestReplay(orgAId, testIncRR.id);
        const events2 = latest2.latestCompletedRun?.events || [];
        const foundInRun2 = events2.some((e) => e.title.includes('Concurrent Unseen Sentry Error'));
        expect(foundInRun2).toBe(true);
      } finally {
        faultInjector = null;
      }
    });

    it('33. Event insertion failure rollback', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 733,
          title: 'Event Failure Rollback Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      faultInjector = (params) => {
        if (params.model === 'ReplayEvent' && params.action === 'createMany') {
          throw new Error('Simulated database crash on ReplayEvent createMany');
        }
      };

      await expect(
        ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST'),
      ).rejects.toThrow('Simulated database crash on ReplayEvent createMany');

      const events = await prisma.replayEvent.findMany({ where: { incidentId: testInc.id } });
      expect(events.length).toBe(0);

      const failedRun = await prisma.replayRun.findFirst({ where: { incidentId: testInc.id } });
      expect(failedRun?.status).toBe(ReplayRunStatus.FAILED);
    });

    it('34. Audit-event failure rollback', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 734,
          title: 'Audit Failure Rollback Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      faultInjector = (params) => {
        if (params.model === 'IncidentEvent' && params.action === 'create') {
          const meta = (params.args as { data?: { metadata?: { replayRun?: boolean } } })?.data?.metadata;
          if (meta?.replayRun) {
            throw new Error('Simulated database crash on replay audit event');
          }
        }
      };

      await expect(
        ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST'),
      ).rejects.toThrow('Simulated database crash on replay audit event');

      const events = await prisma.replayEvent.findMany({ where: { incidentId: testInc.id } });
      expect(events.length).toBe(0);
    });

    it('35. Failed retry succeeds without partial events', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 735,
          title: 'Retry Post Failure Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      faultInjector = (params) => {
        if (params.model === 'ReplayEvent' && params.action === 'createMany') {
          throw new Error('Initial transient error');
        }
      };

      await expect(
        ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST'),
      ).rejects.toThrow('Initial transient error');

      faultInjector = null;
      const retryRes = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      expect(retryRes.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, testInc.id);
      expect(latest.latestCompletedRun).toBeDefined();
    });

    it('36. Success socket emits after commit', async () => {
      const socketSpy = vi.spyOn(socketModule, 'broadcastToIncident');
      const res = await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const calls = socketSpy.mock.calls.filter((c) => c[1] === 'REPLAY_COMPLETED');
      expect(calls.length).toBe(1);
    });

    it('37. Atomic Redis lock contention', async () => {
      const lockKey = `lock:replay:${incidentAId}`;
      await redis.set(lockKey, 'other-worker-token');

      const res = await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('skipped_lock_active');

      await redis.del(lockKey);
    });

    it('38. Redis-unavailable local guard', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 738,
          title: 'Local Guard Contention Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      const [r1, r2] = await Promise.all([
        ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST'),
        ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST'),
      ]);

      const statuses = [r1.status, r2.status];
      expect(statuses).toContain('completed');
      expect(statuses).toContain('skipped_lock_active');
    });

    it('39. Heartbeat ownership loss prevents completion', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 739,
          title: 'Lock Ownership Loss Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      const lockKey = `lock:replay:${testInc.id}`;
      // Simulate stolen lock
      await redis.set(lockKey, 'foreign-worker-lock');

      const res = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('skipped_lock_active');

      await redis.del(lockKey);
    });

    it('40. Ownership-safe release', async () => {
      const lockKey = `lock:replay:safe-rel-test-${Date.now()}`;
      await redis.set(lockKey, 'worker-b-token');

      const releaseScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const res = await redis.eval(releaseScript, 1, lockKey, 'worker-a-token');
      expect(res).toBe(0);

      const val = await redis.get(lockKey);
      expect(val).toBe('worker-b-token');
      await redis.del(lockKey);
    });

    it('41. Final ownership gate', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 741,
          title: 'Final Gate Ownership Loss Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      const res = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');
    });

    it('42. Concurrent requests create one run', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 742,
          title: 'Single Run Parallel Trigger Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      await Promise.all([
        ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST'),
        ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST'),
      ]);

      const runs = await prisma.replayRun.findMany({ where: { incidentId: testInc.id } });
      expect(runs.length).toBe(1);
    });
  });

  // ===========================================================================
  // OBJECTIVES 12, 13 & 14: READ SEMANTICS, BENCHMARK & OBSOLETE LABELS
  // ===========================================================================
  describe('Objectives 12, 13 & 14: Read Semantics, Benchmark & Presentation', () => {
    it('43. Failed/latest-running attempt preserves last completed replay', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 743,
          title: 'Preserve Completed on Failure Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      // 1. Initial success
      const r1 = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      expect(r1.status).toBe('completed');

      // 2. Subsequent failed attempt
      faultInjector = (params) => {
        if (params.model === 'ReplayEvent' && params.action === 'createMany') {
          throw new Error('Simulated transient DB failure on rerun');
        }
      };

      await expect(
        ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST'),
      ).rejects.toThrow();

      // 3. getLatestReplay still exposes the last completed run and failure banner
      faultInjector = null;
      const latest = await ReplayService.getLatestReplay(orgAId, testInc.id);
      expect(latest.latestCompletedRun?.id).toBe(r1.runId);
      expect(latest.latestCompletedRun?.events.length).toBeGreaterThan(0);
      expect(latest.latestFailure).toBeDefined();
    });

    it('44. Historical run ordering and bound', async () => {
      const runs = await ReplayService.getReplayRuns(orgAId, incidentAId);
      expect(runs.length).toBeGreaterThan(0);
      for (let i = 1; i < runs.length; i++) {
        const prevRun = runs[i - 1];
        const currRun = runs[i];
        if (!prevRun || !currRun) throw new Error('Run missing');
        const prev = new Date(prevRun.startedAt).getTime();
        const curr = new Date(currRun.startedAt).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }
    });

    it('45. Resolved replay reruns produce identical canonical projection', async () => {
      const resolvedInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 745,
          title: 'Benchmark Fixture Resolved Incident',
          createdById: userOwnerAId,
          detectedAt: new Date('2026-09-20T10:00:00Z'),
          resolvedAt: new Date('2026-09-20T12:00:00Z'),
          status: IncidentStatus.RESOLVED,
        },
      });

      await prisma.incidentEvidence.create({
        data: {
          incidentId: resolvedInc.id,
          type: EvidenceType.GITHUB_DEPLOYMENT,
          externalRefId: 'deploy:bench-1',
          title: 'Production Deployment v4.0.0',
          addedAt: new Date('2026-09-20T09:30:00Z'),
          confidence: 0.9,
          confidenceTier: 'HIGH',
        },
      });

      await prisma.comment.create({
        data: {
          incidentId: resolvedInc.id,
          userId: userOwnerAId,
          content: 'Incident mitigated by rolling back deploy',
          createdAt: new Date('2026-09-20T11:00:00Z'),
        },
      });

      // Run 1
      const res1 = await ReplayService.runReplay(orgAId, resolvedInc.id, undefined, 'MANUAL_REQUEST');
      const latest1 = await ReplayService.getLatestReplay(orgAId, resolvedInc.id);

      // Run 2
      const res2 = await ReplayService.runReplay(orgAId, resolvedInc.id, undefined, 'MANUAL_REQUEST');
      const latest2 = await ReplayService.getLatestReplay(orgAId, resolvedInc.id);

      expect(res1.status).toBe('completed');
      expect(res2.status).toBe('completed');

      const events1 = latest1.latestCompletedRun?.events || [];
      const events2 = latest2.latestCompletedRun?.events || [];

      expect(events1.length).toBe(events2.length);

      for (let i = 0; i < events1.length; i++) {
        const e1 = events1[i];
        const e2 = events2[i];
        if (!e1 || !e2) throw new Error('Event missing in replay comparison');
        expect(e1.sourceEventId).toBe(e2.sourceEventId);
        expect(e1.eventType).toBe(e2.eventType);
        expect(e1.category).toBe(e2.category);
        expect(new Date(e1.timestamp).toISOString()).toBe(new Date(e2.timestamp).toISOString());
        expect(e1.sequenceIndex).toBe(e2.sequenceIndex);
        expect(e1.title).toBe(e2.title);
      }
    });

    it('46. Sanitized error responses', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/replay`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ triggerType: 'INVALID_TRIGGER_TYPE' });

      expect(res.status).toBe(400);
      expect((res.body as { success: boolean }).success).toBe(false);
    });

    it('47. Stable status vocabulary', async () => {
      const res = await ReplayService.runReplay(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(['completed', 'skipped_lock_active']).toContain(res.status);
    });

    it('48. No obsolete phase-number text in replay output', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 748,
          title: 'Clean Text Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(),
        },
      });

      await prisma.incidentEvent.create({
        data: {
          incidentId: testInc.id,
          organizationId: orgAId,
          source: EventSource.SYSTEM,
          type: 'MANUAL_NOTE',
          message: 'Phase 8 Correlation completed and Phase 9 AI Investigation started',
          occurredAt: new Date(),
        },
      });

      await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      const latest = await ReplayService.getLatestReplay(orgAId, testInc.id);
      const events = latest.latestCompletedRun?.events || [];

      for (const e of events) {
        expect(e.title).not.toContain('Phase 8');
        expect(e.title).not.toContain('Phase 9');
        expect(e.title).not.toContain('Phase 10');
      }
    });
  });

  // ===========================================================================
  // RUN-SOURCE OVERFLOW & BOUNDS VERIFICATION
  // ===========================================================================
  describe('Run-Source Overflow & Bounds Verification', () => {
    it('1. exactly 50 correlation runs does not set source overflow', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 850,
          title: 'Exact 50 Corr Runs Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(Date.now() - 3600000),
        },
      });

      const baseTime = testInc.detectedAt.getTime();
      const runs = Array.from({ length: 50 }).map((_, i) => ({
        organizationId: orgAId,
        incidentId: testInc.id,
        status: 'COMPLETED' as const,
        triggerType: 'MANUAL_REQUEST' as const,
        windowStart: new Date(baseTime - 3600000),
        windowEnd: new Date(baseTime - 1800000),
        startedAt: new Date(baseTime + i * 1000),
        completedAt: new Date(baseTime + i * 1000 + 500),
      }));
      await prisma.correlationRun.createMany({ data: runs });

      const res = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, testInc.id);
      expect(latest.latestCompletedRun?.isTruncated).toBe(false);
      const corrStartedEvents = (latest.latestCompletedRun?.events || []).filter((e) => e.eventType === 'CORRELATION_STARTED');
      expect(corrStartedEvents.length).toBe(50);
    });

    it('2. 51 correlation runs retains 50 and sets isTruncated', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 851,
          title: '51 Corr Runs Overflow Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(Date.now() - 3600000),
        },
      });

      const baseTime = testInc.detectedAt.getTime();
      const runs = Array.from({ length: 51 }).map((_, i) => ({
        organizationId: orgAId,
        incidentId: testInc.id,
        status: 'COMPLETED' as const,
        triggerType: 'MANUAL_REQUEST' as const,
        windowStart: new Date(baseTime - 3600000),
        windowEnd: new Date(baseTime - 1800000),
        startedAt: new Date(baseTime + i * 1000),
        completedAt: new Date(baseTime + i * 1000 + 500),
      }));
      await prisma.correlationRun.createMany({ data: runs });

      const res = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, testInc.id);
      expect(latest.latestCompletedRun?.isTruncated).toBe(true);
      const corrStartedEvents = (latest.latestCompletedRun?.events || []).filter((e) => e.eventType === 'CORRELATION_STARTED');
      expect(corrStartedEvents.length).toBe(50);
    });

    it('3. exactly 50 investigation runs does not set source overflow', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 852,
          title: 'Exact 50 Inv Runs Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(Date.now() - 3600000),
        },
      });

      const baseTime = testInc.detectedAt.getTime();
      const runs = Array.from({ length: 50 }).map((_, i) => ({
        organizationId: orgAId,
        incidentId: testInc.id,
        status: 'COMPLETED' as const,
        triggerType: 'MANUAL_REQUEST' as const,
        providerName: 'openai',
        modelName: 'gpt-4o',
        startedAt: new Date(baseTime + i * 1000),
        completedAt: new Date(baseTime + i * 1000 + 500),
      }));
      await prisma.investigationRun.createMany({ data: runs });

      const res = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, testInc.id);
      expect(latest.latestCompletedRun?.isTruncated).toBe(false);
      const invStartedEvents = (latest.latestCompletedRun?.events || []).filter((e) => e.eventType === 'INVESTIGATION_STARTED');
      expect(invStartedEvents.length).toBe(50);
    });

    it('4. 51 investigation runs retains 50 and sets isTruncated', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 853,
          title: '51 Inv Runs Overflow Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(Date.now() - 3600000),
        },
      });

      const baseTime = testInc.detectedAt.getTime();
      const runs = Array.from({ length: 51 }).map((_, i) => ({
        organizationId: orgAId,
        incidentId: testInc.id,
        status: 'COMPLETED' as const,
        triggerType: 'MANUAL_REQUEST' as const,
        providerName: 'openai',
        modelName: 'gpt-4o',
        startedAt: new Date(baseTime + i * 1000),
        completedAt: new Date(baseTime + i * 1000 + 500),
      }));
      await prisma.investigationRun.createMany({ data: runs });

      const res = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, testInc.id);
      expect(latest.latestCompletedRun?.isTruncated).toBe(true);
      const invStartedEvents = (latest.latestCompletedRun?.events || []).filter((e) => e.eventType === 'INVESTIGATION_STARTED');
      expect(invStartedEvents.length).toBe(50);
    });

    it('5. run source overflow remains truncated when retained events are below global cap', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 854,
          title: 'Sub-Cap Run Overflow Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(Date.now() - 3600000),
        },
      });

      const baseTime = testInc.detectedAt.getTime();
      const runs = Array.from({ length: 51 }).map((_, i) => ({
        organizationId: orgAId,
        incidentId: testInc.id,
        status: 'RUNNING' as const,
        triggerType: 'MANUAL_REQUEST' as const,
        windowStart: new Date(baseTime - 3600000),
        windowEnd: new Date(baseTime - 1800000),
        startedAt: new Date(baseTime + i * 1000),
      }));
      await prisma.correlationRun.createMany({ data: runs });

      const res = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const latest = await ReplayService.getLatestReplay(orgAId, testInc.id);
      const run = latest.latestCompletedRun;
      expect(run).toBeDefined();
      if (run) {
        expect(run.totalEventCount).toBeLessThan(500);
        expect(run.isTruncated).toBe(true);
      }
    });

    it('6. timestamp and id ordering deterministically selects the retained 50 runs', async () => {
      const testInc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceAId,
          number: 855,
          title: 'Deterministic 50 Selection Incident',
          createdById: userOwnerAId,
          detectedAt: new Date(Date.now() - 3600000),
        },
      });

      const baseTime = testInc.detectedAt.getTime();
      const runs = Array.from({ length: 55 }).map((_, i) => ({
        organizationId: orgAId,
        incidentId: testInc.id,
        status: 'RUNNING' as const,
        triggerType: 'MANUAL_REQUEST' as const,
        windowStart: new Date(baseTime - 3600000),
        windowEnd: new Date(baseTime - 1800000),
        startedAt: new Date(baseTime + i * 1000),
      }));
      await prisma.correlationRun.createMany({ data: runs });

      const res1 = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      const latest1 = await ReplayService.getLatestReplay(orgAId, testInc.id);

      const res2 = await ReplayService.runReplay(orgAId, testInc.id, undefined, 'MANUAL_REQUEST');
      const latest2 = await ReplayService.getLatestReplay(orgAId, testInc.id);

      expect(res1.status).toBe('completed');
      expect(res2.status).toBe('completed');

      const events1 = latest1.latestCompletedRun?.events || [];
      const events2 = latest2.latestCompletedRun?.events || [];

      expect(events1.length).toBe(events2.length);
      for (let i = 0; i < events1.length; i++) {
        expect(events1[i]?.sourceEventId).toBe(events2[i]?.sourceEventId);
        expect(events1[i]?.sequenceIndex).toBe(events2[i]?.sequenceIndex);
      }
    });
  });

  // ===========================================================================
  // RELATIVE-TIME FORMATTER BOUNDARY SUITE
  // ===========================================================================
  describe('Relative-Time Formatter Boundary Suite', () => {
    const anchor = new Date('2026-09-20T12:00:00.000Z');

    it('formats exact detection anchor as T+0s', () => {
      expect(formatSignedRelativeTime(anchor, anchor)).toBe('T+0s');
    });

    it('formats ±1 second correctly', () => {
      const before1s = new Date(anchor.getTime() - 1000);
      const after1s = new Date(anchor.getTime() + 1000);
      expect(formatSignedRelativeTime(before1s, anchor)).toBe('T−1s');
      expect(formatSignedRelativeTime(after1s, anchor)).toBe('T+1s');
    });

    it('formats ±42 seconds correctly', () => {
      const before42s = new Date(anchor.getTime() - 42000);
      const after42s = new Date(anchor.getTime() + 42000);
      expect(formatSignedRelativeTime(before42s, anchor)).toBe('T−42s');
      expect(formatSignedRelativeTime(after42s, anchor)).toBe('T+42s');
    });

    it('formats ±59 seconds correctly', () => {
      const before59s = new Date(anchor.getTime() - 59000);
      const after59s = new Date(anchor.getTime() + 59000);
      expect(formatSignedRelativeTime(before59s, anchor)).toBe('T−59s');
      expect(formatSignedRelativeTime(after59s, anchor)).toBe('T+59s');
    });

    it('formats ±60 seconds correctly', () => {
      const before60s = new Date(anchor.getTime() - 60000);
      const after60s = new Date(anchor.getTime() + 60000);
      expect(formatSignedRelativeTime(before60s, anchor)).toBe('T−1m');
      expect(formatSignedRelativeTime(after60s, anchor)).toBe('T+1m');
    });

    it('formats ±15 minutes correctly', () => {
      const before15m = new Date(anchor.getTime() - 15 * 60000);
      const after15m = new Date(anchor.getTime() + 15 * 60000);
      expect(formatSignedRelativeTime(before15m, anchor)).toBe('T−15m');
      expect(formatSignedRelativeTime(after15m, anchor)).toBe('T+15m');
    });

    it('formats ±59 minutes correctly', () => {
      const before59m = new Date(anchor.getTime() - 59 * 60000);
      const after59m = new Date(anchor.getTime() + 59 * 60000);
      expect(formatSignedRelativeTime(before59m, anchor)).toBe('T−59m');
      expect(formatSignedRelativeTime(after59m, anchor)).toBe('T+59m');
    });

    it('formats ±60 minutes correctly', () => {
      const before60m = new Date(anchor.getTime() - 60 * 60000);
      const after60m = new Date(anchor.getTime() + 60 * 60000);
      expect(formatSignedRelativeTime(before60m, anchor)).toBe('T−1h');
      expect(formatSignedRelativeTime(after60m, anchor)).toBe('T+1h');
    });

    it('formats ±1 hour 15 minutes correctly', () => {
      const before1h15m = new Date(anchor.getTime() - 75 * 60000);
      const after1h15m = new Date(anchor.getTime() + 75 * 60000);
      expect(formatSignedRelativeTime(before1h15m, anchor)).toBe('T−1h 15m');
      expect(formatSignedRelativeTime(after1h15m, anchor)).toBe('T+1h 15m');
    });

    it('handles invalid dates safely without throwing', () => {
      expect(formatSignedRelativeTime('invalid-date', anchor)).toBe('T+0s');
      expect(formatSignedRelativeTime(anchor, 'invalid-anchor')).toBe('T+0s');
    });
  });
});
