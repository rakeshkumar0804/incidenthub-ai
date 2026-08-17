import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  ReplayRunStatus,
  ReplayTriggerType,
  ReplayCategory,
  EventSource,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { logger } from '../../utils/logger';
import { NotFoundError } from '../../utils/errors';
import { broadcastToIncident } from '../../lib/socket';
import type { NormalizedReplayEventInput } from './replay.types';

export class ReplayService {
  public static async runReplay(
    organizationId: string,
    incidentId: string,
    triggeredById?: string,
    triggerType: ReplayTriggerType = ReplayTriggerType.MANUAL_REQUEST,
  ): Promise<{ runId: string; status: string }> {
    // 1. Multi-tenant Guard & Incident Fetch
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
      include: {
        createdBy: true,
        assignee: true,
      },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    // 2. Redis Distributed Locking (45s TTL)
    const lockKey = `lock:replay:${incidentId}`;
    const lockVal = crypto.randomUUID();
    let lockAcquired = true;

    try {
      if (redis.status !== 'ready' && redis.status !== 'connecting') {
        await Promise.race([redis.connect(), new Promise((r) => setTimeout(r, 300))]);
      }

      if (redis.status === 'ready') {
        const existingLock = await redis.get(lockKey);
        if (existingLock) {
          lockAcquired = false;
        } else {
          await redis.set(lockKey, lockVal, 'PX', 45000, 'NX');
        }
      }
    } catch {
      // Fallback if Redis is unavailable
    }

    if (!lockAcquired) {
      logger.info({ incidentId }, 'Incident Replay run already in progress (Redis lock active)');
      return { runId: 'none', status: 'skipped: lock active' };
    }

    let runId = '';

    try {
      // 3. Define Replay Window
      const windowStart = new Date(incident.detectedAt.getTime() - 2 * 60 * 60 * 1000); // detectedAt - 2h
      const endAnchor = incident.resolvedAt || new Date();
      const windowEnd = new Date(endAnchor.getTime() + 30 * 60 * 1000); // resolvedAt/now + 30m

      // Create ReplayRun audit record (RUNNING)
      const replayRun = await prisma.replayRun.create({
        data: {
          organizationId,
          incidentId,
          triggerType,
          status: ReplayRunStatus.RUNNING,
          windowStart,
          windowEnd,
          triggeredById: triggeredById || null,
        },
      });

      runId = replayRun.id;

      // Broadcast Socket.IO event: REPLAY_STARTED
      broadcastToIncident(incidentId, 'REPLAY_STARTED', {
        incidentId,
        runId: replayRun.id,
        startedAt: replayRun.startedAt.toISOString(),
      });

      // 4. Source Aggregation & Ingestion (Bounded Limit 500 + 1)
      const MAX_BOUND = 500;
      let totalRawEvents = 0;
      let isTruncated = false;

      const rawEvents: NormalizedReplayEventInput[] = [];

      // A. Incident Creation Event
      rawEvents.push({
        category: ReplayCategory.STATE_CHANGE,
        categoryWeight: 10,
        eventType: 'INCIDENT_CREATED',
        source: EventSource.USER,
        sourceEventId: `incident:${incident.id}:INCIDENT_CREATED:0`,
        timestamp: incident.detectedAt,
        actorName: incident.createdBy.name,
        actorEmail: incident.createdBy.email,
        title: `Incident ${incident.number} Detected: ${incident.title}`,
        description: incident.description || `Severity: ${incident.severity}, Environment: ${incident.environment}`,
        externalUrl: null,
        evidenceId: null,
        metadata: {
          number: incident.number,
          severity: incident.severity,
          environment: incident.environment,
          status: incident.status,
        },
      });

      // B. IncidentEvent records
      const incidentEventRecords = await prisma.incidentEvent.findMany({
        where: {
          incidentId,
          organizationId,
          occurredAt: { gte: windowStart, lte: windowEnd },
        },
        include: { user: true },
        take: MAX_BOUND + 1,
      });

      if (incidentEventRecords.length > MAX_BOUND) {
        isTruncated = true;
      }

      for (const evt of incidentEventRecords.slice(0, MAX_BOUND)) {
        // Skip internal engine completion messages if already handled to prevent duplicates/loops
        if (
          evt.type === 'AI_INVESTIGATION_COMPLETED' ||
          evt.type === 'INCIDENT_REPLAY_COMPLETED' ||
          evt.type === 'CORRELATION_COMPLETED'
        ) {
          continue;
        }

        rawEvents.push({
          category: ReplayCategory.STATE_CHANGE,
          categoryWeight: 10,
          eventType: evt.type,
          source: evt.source,
          sourceEventId: `incident_event:${evt.id}:${evt.type}:0`,
          timestamp: evt.occurredAt,
          actorName: evt.user?.name || (evt.source === EventSource.SYSTEM ? 'System Automator' : 'Automated Signal'),
          actorEmail: evt.user?.email || null,
          title: evt.message,
          description: evt.message,
          externalUrl: null,
          evidenceId: null,
          metadata: (evt.metadata as Record<string, unknown> | null) || null,
        });
      }

      // C. IncidentEvidence records (GitHub Deployments, Commits, PRs, Sentry Errors)
      const evidenceRecords = await prisma.incidentEvidence.findMany({
        where: {
          incidentId,
          addedAt: { gte: windowStart, lte: windowEnd },
        },
        take: MAX_BOUND + 1,
      });

      if (evidenceRecords.length > MAX_BOUND) {
        isTruncated = true;
      }

      for (const ev of evidenceRecords.slice(0, MAX_BOUND)) {
        const meta = (ev.metadata as Record<string, unknown> | null) || {};
        let cat: ReplayCategory = ReplayCategory.TELEMETRY;
        let weight = 20;

        if (ev.type.startsWith('GITHUB_') || ev.type.startsWith('SENTRY_')) {
          cat = ReplayCategory.TELEMETRY;
          weight = 20;
        }

        rawEvents.push({
          category: cat,
          categoryWeight: weight,
          eventType: ev.type,
          source: ev.type.startsWith('GITHUB_') ? EventSource.GITHUB : ev.type.startsWith('SENTRY_') ? EventSource.SENTRY : EventSource.SYSTEM,
          sourceEventId: `incident_evidence:${ev.id}:${ev.type}:0`,
          timestamp: ev.addedAt,
          actorName: (meta['author'] as string) || ev.source,
          actorEmail: null,
          title: ev.title,
          description: ev.description || `Confidence: ${ev.confidence ?? 'N/A'} (${ev.confidenceTier ?? 'N/A'})`,
          externalUrl: ev.url || null,
          evidenceId: ev.id,
          metadata: meta,
        });
      }

      // D. Team Discussion Comments
      const commentRecords = await prisma.comment.findMany({
        where: {
          incidentId,
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        include: { user: true },
        take: MAX_BOUND + 1,
      });

      if (commentRecords.length > MAX_BOUND) {
        isTruncated = true;
      }

      for (const c of commentRecords.slice(0, MAX_BOUND)) {
        rawEvents.push({
          category: ReplayCategory.COMMUNICATION,
          categoryWeight: 40,
          eventType: c.parentId ? 'COMMENT_REPLY' : 'COMMENT_CREATED',
          source: EventSource.USER,
          sourceEventId: `comment:${c.id}:COMMENT_CREATED:0`,
          timestamp: c.createdAt,
          actorName: c.user.name,
          actorEmail: c.user.email,
          title: `Comment by ${c.user.name}`,
          description: c.content,
          externalUrl: null,
          evidenceId: null,
          metadata: { commentId: c.id, parentId: c.parentId },
        });
      }

      // E. CorrelationRun Milestones
      const correlationRuns = await prisma.correlationRun.findMany({
        where: {
          incidentId,
          organizationId,
          startedAt: { gte: windowStart, lte: windowEnd },
        },
        take: 20,
      });

      for (const cr of correlationRuns) {
        rawEvents.push({
          category: ReplayCategory.CORRELATION,
          categoryWeight: 30,
          eventType: 'CORRELATION_COMPLETED',
          source: EventSource.SYSTEM,
          sourceEventId: `correlation_run:${cr.id}:CORRELATION_COMPLETED:0`,
          timestamp: cr.completedAt || cr.startedAt,
          actorName: 'Correlation Engine',
          actorEmail: null,
          title: `Phase 8 Correlation Completed (${cr.correlatedCount} evidence items)`,
          description: `Correlated ${cr.correlatedCount} evidence signals across window`,
          externalUrl: null,
          evidenceId: null,
          metadata: {
            runId: cr.id,
            candidateCount: cr.candidateCount,
            correlatedCount: cr.correlatedCount,
          },
        });
      }

      // F. InvestigationRun Lifecycle Milestones ONLY (Zero AI hypothesis text converted)
      const investigationRuns = await prisma.investigationRun.findMany({
        where: {
          incidentId,
          organizationId,
          startedAt: { gte: windowStart, lte: windowEnd },
        },
        take: 20,
      });

      for (const ir of investigationRuns) {
        // Started Milestone
        rawEvents.push({
          category: ReplayCategory.INVESTIGATION,
          categoryWeight: 30,
          eventType: 'INVESTIGATION_STARTED',
          source: EventSource.AI,
          sourceEventId: `investigation_run:${ir.id}:INVESTIGATION_STARTED:0`,
          timestamp: ir.startedAt,
          actorName: 'AI Investigation Engine',
          actorEmail: null,
          title: 'AI Investigation Triggered',
          description: `Provider: ${ir.providerName} (${ir.modelName})`,
          externalUrl: null,
          evidenceId: null,
          metadata: { runId: ir.id, providerName: ir.providerName },
        });

        // Completed or Failed Milestone
        if (ir.completedAt) {
          rawEvents.push({
            category: ReplayCategory.INVESTIGATION,
            categoryWeight: 30,
            eventType: ir.status === 'COMPLETED' ? 'INVESTIGATION_COMPLETED' : 'INVESTIGATION_FAILED',
            source: EventSource.AI,
            sourceEventId: `investigation_run:${ir.id}:${ir.status}:1`,
            timestamp: ir.completedAt,
            actorName: 'AI Investigation Engine',
            actorEmail: null,
            title: ir.status === 'COMPLETED' ? `AI Investigation Completed (${ir.confidenceTier || 'UNCERTAIN'})` : 'AI Investigation Failed',
            description: ir.status === 'COMPLETED' ? `Investigation finished in ${ir.latencyMs}ms` : (ir.validationError || 'Execution failed'),
            externalUrl: null,
            evidenceId: null,
            metadata: {
              runId: ir.id,
              confidenceTier: ir.confidenceTier,
              confidence: ir.confidence,
              latencyMs: ir.latencyMs,
            },
          });
        }
      }

      // 5. Deterministic 3-Key Sorting Algorithm
      // Key 1: timestamp ASC
      // Key 2: categoryWeight ASC (tie-breaker for identical timestamps)
      // Key 3: sourceEventId ASC (lexicographical string tie-breaker)
      rawEvents.sort((a, b) => {
        const timeDiff = a.timestamp.getTime() - b.timestamp.getTime();
        if (timeDiff !== 0) return timeDiff;

        const weightDiff = a.categoryWeight - b.categoryWeight;
        if (weightDiff !== 0) return weightDiff;

        return a.sourceEventId.localeCompare(b.sourceEventId);
      });

      totalRawEvents = rawEvents.length;

      // 6. Bulk Create Normalized ReplayEvents with Sequential Indexes
      const replayEventCreateData: Prisma.ReplayEventCreateManyInput[] = rawEvents.map((evt, idx) => ({
        replayRunId: replayRun.id,
        incidentId,
        organizationId,
        sequenceIndex: idx + 1, // 1-indexed
        category: evt.category,
        categoryWeight: evt.categoryWeight,
        eventType: evt.eventType,
        source: evt.source,
        sourceEventId: evt.sourceEventId,
        timestamp: evt.timestamp,
        actorName: evt.actorName,
        actorEmail: evt.actorEmail,
        title: evt.title,
        description: evt.description,
        externalUrl: evt.externalUrl,
        evidenceId: evt.evidenceId,
        metadata: evt.metadata as Prisma.InputJsonValue,
      }));

      if (replayEventCreateData.length > 0) {
        await prisma.replayEvent.createMany({
          data: replayEventCreateData,
          skipDuplicates: true,
        });
      }

      // Update ReplayRun to COMPLETED
      const completedRun = await prisma.replayRun.update({
        where: { id: replayRun.id },
        data: {
          status: ReplayRunStatus.COMPLETED,
          totalEventCount: totalRawEvents,
          isTruncated,
          completedAt: new Date(),
        },
      });

      // 7. Audit Timeline Event (Loop Prevention Flagged)
      await prisma.incidentEvent.create({
        data: {
          incidentId,
          organizationId,
          userId: triggeredById || null,
          source: EventSource.SYSTEM,
          type: 'INCIDENT_REPLAY_COMPLETED',
          message: `Incident Replay timeline reconstructed (${completedRun.totalEventCount} events)`,
          metadata: {
            automated: true,
            replayRun: true,
            runId: completedRun.id,
            totalEventCount: completedRun.totalEventCount,
          },
        },
      });

      // 8. Broadcast Socket.IO Event: REPLAY_COMPLETED
      broadcastToIncident(incidentId, 'REPLAY_COMPLETED', {
        incidentId,
        runId: completedRun.id,
        totalEventCount: completedRun.totalEventCount,
      });

      return { runId: completedRun.id, status: 'completed' };
    } catch (err) {
      logger.error({ err, incidentId }, 'Incident Replay execution failed');

      if (runId) {
        await prisma.replayRun.update({
          where: { id: runId },
          data: {
            status: ReplayRunStatus.FAILED,
            error: (err as Error).message,
            completedAt: new Date(),
          },
        });

        broadcastToIncident(incidentId, 'REPLAY_FAILED', {
          incidentId,
          runId,
          error: (err as Error).message,
        });
      }

      throw err;
    } finally {
      // Safe Redis Lock Release
      try {
        if (redis.status === 'ready') {
          const releaseScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          await redis.eval(releaseScript, 1, lockKey, lockVal);
        }
      } catch {
        // Ignore lock release error
      }
    }
  }

  public static async getLatestReplay(organizationId: string, incidentId: string) {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    const latestRun = await prisma.replayRun.findFirst({
      where: { incidentId, organizationId },
      orderBy: { startedAt: 'desc' },
      include: {
        events: {
          orderBy: { sequenceIndex: 'asc' },
        },
      },
    });

    return { incidentId, latestRun };
  }

  public static async getReplayRuns(organizationId: string, incidentId: string) {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    return prisma.replayRun.findMany({
      where: { incidentId, organizationId },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
  }
}
