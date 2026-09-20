import crypto from 'crypto';
import {
  Prisma,
  ReplayRunStatus,
  ReplayTriggerType,
  ReplayCategory,
  EventSource,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { redis, acquireDistributedLock, verifyLockOwnership, releaseDistributedLock } from '../../lib/redis';
import { logger } from '../../utils/logger';
import { NotFoundError, LockOwnershipLostError } from '../../utils/errors';
import { broadcastToIncident } from '../../lib/socket';
import { sanitizeString, sanitizeRecursive } from '../ai/sanitizer';
import type { NormalizedReplayEventInput } from './replay.types';
import {
  MAX_REPLAY_EVENTS,
  CATEGORY_WEIGHTS,
  calculateReplayWindow,
  resolveEvidenceTimestamp,
  deduplicateAndRetainEvents,
  createIncidentDetectedEvent,
  cleanReplayText,
} from './replay.engine';

export class ReplayService {
  private static localInFlight = new Set<string>();

  public static async runReplay(
    organizationId: string,
    incidentId: string,
    triggeredById?: string,
    triggerType: ReplayTriggerType = ReplayTriggerType.MANUAL_REQUEST,
  ): Promise<{ runId: string; status: string }> {
    // 1. Process-Local Concurrency Guard (synchronous check before any await)
    if (ReplayService.localInFlight.has(incidentId)) {
      logger.info({ incidentId }, 'Replay run already in progress locally');
      return { runId: 'none', status: 'skipped_lock_active' };
    }
    ReplayService.localInFlight.add(incidentId);

    // 2. Multi-tenant Guard & Incident Fetch
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
      include: {
        createdBy: true,
        assignee: true,
      },
    });

    if (!incident) {
      ReplayService.localInFlight.delete(incidentId);
      throw new NotFoundError('Incident not found in organization');
    }

    // 3. Redis Distributed Locking with Ownership-Safe Heartbeat (45s TTL)
    const lockKey = `lock:replay:${incidentId}`;
    const lockVal = crypto.randomUUID();
    const lockTtlMs = 45000;
    let renewalTimer: NodeJS.Timeout | null = null;
    let lockLost = false;
    let isRenewing = false;

    // Atomic lock acquisition: fails closed (503) in production if Redis is unavailable or throws
    const lockResult = await acquireDistributedLock(lockKey, lockVal, lockTtlMs, 'replay_execution');
    if (!lockResult.acquired) {
      ReplayService.localInFlight.delete(incidentId);
      logger.info({ incidentId }, 'Incident Replay run already in progress (lock active)');
      return { runId: 'none', status: 'skipped_lock_active' };
    }

    const redisLockAcquired = lockResult.isRedisLock;

    if (redisLockAcquired) {
      // Start safe background renewal timer (heartbeat every 10 seconds)
      renewalTimer = setInterval(() => {
        if (isRenewing || lockLost) return;
        isRenewing = true;
        const renewLua = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("pexpire", KEYS[1], ARGV[2])
          else
            return 0
          end
        `;
        redis
          .eval(renewLua, 1, lockKey, lockVal, lockTtlMs)
          .then((result) => {
            if (result !== 1) {
              lockLost = true;
              logger.warn({ incidentId, lockKey }, 'Redis replay lock ownership lost during renewal heartbeat');
            }
          })
          .catch((err) => {
            logger.warn({ err, incidentId }, 'Redis replay lock renewal heartbeat failed');
          })
          .finally(() => {
            isRenewing = false;
          });
      }, 10000);
    }

    const verifyAndExtendLockOwnership = async (): Promise<boolean> => {
      // 1. Stop scheduling new heartbeats
      if (renewalTimer) {
        clearInterval(renewalTimer);
        renewalTimer = null;
      }

      // 2. Await any heartbeat renewal currently in flight
      while (isRenewing) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      if (!redisLockAcquired) {
        // Redis was unavailable; process-local guard is active and owned
        return true;
      }

      if (lockLost) {
        return false;
      }

      // 3. Perform final compare-and-renew check
      const isOwner = await verifyLockOwnership(lockKey, lockVal, lockTtlMs);
      if (!isOwner) {
        lockLost = true;
      }
      return isOwner;
    };


    let runId = '';

    try {
      // 4. Capture single execution cutoff & compute stable window
      const executionCutoff = new Date();
      const { windowStart, windowEnd } = calculateReplayWindow(incident, executionCutoff);

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

      // 5. Final Lock-Ownership Gate (prior to entering DB transaction)
      const isOwner = await verifyAndExtendLockOwnership();
      if (!isOwner) {
        throw new LockOwnershipLostError();
      }

      // 6. Atomic Repeatable-Read Database Snapshot & Persistence
      const [completedRun] = await prisma.$transaction(
        async (tx) => {
          const QUERY_BOUND = MAX_REPLAY_EVENTS + 1;
          const RUN_SOURCE_CAP = 50;
          let anySourceOverflow = false;
          const candidateEvents: NormalizedReplayEventInput[] = [];

          // A. Incident Detection Event
          candidateEvents.push(createIncidentDetectedEvent(incident));

          // B. IncidentEvent records (State changes, actions, milestones)
          const incidentEventRecords = await tx.incidentEvent.findMany({
            where: {
              incidentId,
              organizationId,
              occurredAt: { gte: windowStart, lte: windowEnd },
            },
            include: { user: true },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            take: QUERY_BOUND,
          });

          if (incidentEventRecords.length > MAX_REPLAY_EVENTS) {
            anySourceOverflow = true;
          }

          for (const evt of incidentEventRecords.slice(0, MAX_REPLAY_EVENTS)) {
            const upperType = evt.type.toUpperCase();
            if (
              upperType === 'AI_INVESTIGATION_COMPLETED' ||
              upperType === 'INCIDENT_REPLAY_COMPLETED' ||
              upperType === 'CORRELATION_COMPLETED' ||
              upperType === 'INCIDENT_REPLAY_STARTED' ||
              upperType === 'INCIDENT_REPLAY_FAILED' ||
              upperType === 'REPLAY_STARTED' ||
              upperType === 'REPLAY_COMPLETED' ||
              upperType === 'REPLAY_FAILED'
            ) {
              continue;
            }

            candidateEvents.push({
              category: ReplayCategory.STATE_CHANGE,
              categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.STATE_CHANGE],
              eventType: evt.type,
              source: evt.source,
              sourceEventId: `incident_event:${evt.id}:${evt.type}:0`,
              timestamp: evt.occurredAt,
              actorName: evt.user?.name ? sanitizeString(evt.user.name) : (evt.source === EventSource.SYSTEM ? 'System' : 'Automated Monitor'),
              actorEmail: null,
              title: cleanReplayText(evt.message),
              description: cleanReplayText(evt.message),
              externalUrl: null,
              evidenceId: null,
              metadata: evt.metadata ? (sanitizeRecursive(evt.metadata) as Record<string, unknown>) : null,
            });
          }

          // C. IncidentEvidence records (GitHub Deployments, Commits, PRs, Sentry Errors)
          const evidenceRecords = await tx.incidentEvidence.findMany({
            where: {
              incidentId,
              addedAt: { gte: windowStart, lte: windowEnd },
            },
            orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
            take: QUERY_BOUND,
          });

          if (evidenceRecords.length > MAX_REPLAY_EVENTS) {
            anySourceOverflow = true;
          }

          for (const ev of evidenceRecords.slice(0, MAX_REPLAY_EVENTS)) {
            const meta = (ev.metadata as Record<string, unknown> | null) || {};
            const { timestamp, timestampBasis } = resolveEvidenceTimestamp(ev);

            if (timestamp < windowStart || timestamp > windowEnd) {
              continue;
            }

            const sanitizedMeta = sanitizeRecursive({
              ...meta,
              timestampBasis,
              evidenceType: ev.type,
              confidence: ev.confidence,
              confidenceTier: ev.confidenceTier,
            }) as Record<string, unknown>;

            const eventSource = ev.type.startsWith('GITHUB_')
              ? EventSource.GITHUB
              : ev.type.startsWith('SENTRY_')
                ? EventSource.SENTRY
                : ev.type.startsWith('SLACK_')
                  ? EventSource.SLACK
                  : EventSource.SYSTEM;

            candidateEvents.push({
              category: ReplayCategory.TELEMETRY,
              categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.TELEMETRY],
              eventType: ev.type,
              source: eventSource,
              sourceEventId: `incident_evidence:${ev.id}:${ev.type}:0`,
              timestamp,
              actorName: (meta['author'] as string) ? sanitizeString(meta['author'] as string) : ev.source,
              actorEmail: null,
              title: cleanReplayText(ev.title),
              description: ev.description ? cleanReplayText(ev.description) : `Confidence: ${ev.confidence ?? 'N/A'} (${ev.confidenceTier ?? 'N/A'})`,
              externalUrl: ev.url ? sanitizeString(ev.url) : null,
              evidenceId: ev.id,
              metadata: sanitizedMeta,
            });
          }

          // D. Team Discussion Comments & Replies
          const commentRecords = await tx.comment.findMany({
            where: {
              incidentId,
              createdAt: { gte: windowStart, lte: windowEnd },
            },
            include: { user: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: QUERY_BOUND,
          });

          if (commentRecords.length > MAX_REPLAY_EVENTS) {
            anySourceOverflow = true;
          }

          for (const c of commentRecords.slice(0, MAX_REPLAY_EVENTS)) {
            candidateEvents.push({
              category: ReplayCategory.COMMUNICATION,
              categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.COMMUNICATION],
              eventType: c.parentId ? 'COMMENT_REPLY' : 'COMMENT_CREATED',
              source: EventSource.USER,
              sourceEventId: `comment:${c.id}:${c.parentId ? 'COMMENT_REPLY' : 'COMMENT_CREATED'}:0`,
              timestamp: c.createdAt,
              actorName: c.user?.name ? sanitizeString(c.user.name) : 'Responder',
              actorEmail: null,
              title: cleanReplayText(`Comment by ${c.user?.name || 'Responder'}`),
              description: cleanReplayText(c.content),
              externalUrl: null,
              evidenceId: null,
              metadata: { commentId: c.id, parentId: c.parentId },
            });
          }

          // E. CorrelationRun Milestones (RUNNING, COMPLETED, FAILED)
          const correlationRuns = await tx.correlationRun.findMany({
            where: {
              incidentId,
              organizationId,
              startedAt: { gte: windowStart, lte: windowEnd },
            },
            orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
            take: RUN_SOURCE_CAP + 1,
          });

          if (correlationRuns.length > RUN_SOURCE_CAP) {
            anySourceOverflow = true;
          }

          for (const cr of correlationRuns.slice(0, RUN_SOURCE_CAP)) {
            candidateEvents.push({
              category: ReplayCategory.CORRELATION,
              categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.CORRELATION],
              eventType: 'CORRELATION_STARTED',
              source: EventSource.SYSTEM,
              sourceEventId: `correlation_run:${cr.id}:CORRELATION_STARTED:0`,
              timestamp: cr.startedAt,
              actorName: 'Correlation Engine',
              actorEmail: null,
              title: 'Correlation Engine Started',
              description: `Trigger: ${cr.triggerType}`,
              externalUrl: null,
              evidenceId: null,
              metadata: { runId: cr.id, triggerType: cr.triggerType },
            });

            if (cr.status === 'COMPLETED' && cr.completedAt) {
              candidateEvents.push({
                category: ReplayCategory.CORRELATION,
                categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.CORRELATION],
                eventType: 'CORRELATION_COMPLETED',
                source: EventSource.SYSTEM,
                sourceEventId: `correlation_run:${cr.id}:CORRELATION_COMPLETED:1`,
                timestamp: cr.completedAt,
                actorName: 'Correlation Engine',
                actorEmail: null,
                title: cleanReplayText(`Correlation Engine Completed (${cr.correlatedCount} evidence items)`),
                description: `Correlated ${cr.correlatedCount} evidence signals across window`,
                externalUrl: null,
                evidenceId: null,
                metadata: {
                  runId: cr.id,
                  candidateCount: cr.candidateCount,
                  correlatedCount: cr.correlatedCount,
                },
              });
            } else if (cr.status === 'FAILED') {
              candidateEvents.push({
                category: ReplayCategory.CORRELATION,
                categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.CORRELATION],
                eventType: 'CORRELATION_FAILED',
                source: EventSource.SYSTEM,
                sourceEventId: `correlation_run:${cr.id}:CORRELATION_FAILED:1`,
                timestamp: cr.completedAt || cr.startedAt,
                actorName: 'Correlation Engine',
                actorEmail: null,
                title: 'Correlation Engine Failed',
                description: cr.error ? cleanReplayText(cr.error) : 'Execution encountered an error',
                externalUrl: null,
                evidenceId: null,
                metadata: { runId: cr.id, error: cr.error ? sanitizeString(cr.error) : null },
              });
            }
          }

          // F. InvestigationRun Lifecycle Milestones (RUNNING, COMPLETED, FAILED)
          const investigationRuns = await tx.investigationRun.findMany({
            where: {
              incidentId,
              organizationId,
              startedAt: { gte: windowStart, lte: windowEnd },
            },
            orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
            take: RUN_SOURCE_CAP + 1,
          });

          if (investigationRuns.length > RUN_SOURCE_CAP) {
            anySourceOverflow = true;
          }

          for (const ir of investigationRuns.slice(0, RUN_SOURCE_CAP)) {
            candidateEvents.push({
              category: ReplayCategory.INVESTIGATION,
              categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.INVESTIGATION],
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

            if (ir.status === 'COMPLETED' && ir.completedAt) {
              candidateEvents.push({
                category: ReplayCategory.INVESTIGATION,
                categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.INVESTIGATION],
                eventType: 'INVESTIGATION_COMPLETED',
                source: EventSource.AI,
                sourceEventId: `investigation_run:${ir.id}:INVESTIGATION_COMPLETED:1`,
                timestamp: ir.completedAt,
                actorName: 'AI Investigation Engine',
                actorEmail: null,
                title: cleanReplayText(`AI Investigation Completed (${ir.confidenceTier || 'UNCERTAIN'})`),
                description: `Investigation finished in ${ir.latencyMs}ms`,
                externalUrl: null,
                evidenceId: null,
                metadata: {
                  runId: ir.id,
                  confidenceTier: ir.confidenceTier,
                  confidence: ir.confidence,
                  latencyMs: ir.latencyMs,
                },
              });
            } else if (ir.status === 'FAILED') {
              candidateEvents.push({
                category: ReplayCategory.INVESTIGATION,
                categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.INVESTIGATION],
                eventType: 'INVESTIGATION_FAILED',
                source: EventSource.AI,
                sourceEventId: `investigation_run:${ir.id}:INVESTIGATION_FAILED:1`,
                timestamp: ir.completedAt || ir.startedAt,
                actorName: 'AI Investigation Engine',
                actorEmail: null,
                title: 'AI Investigation Failed',
                description: ir.validationError ? cleanReplayText(ir.validationError) : 'Investigation execution failed',
                externalUrl: null,
                evidenceId: null,
                metadata: {
                  runId: ir.id,
                  error: ir.validationError ? sanitizeString(ir.validationError) : 'Failed',
                },
              });
            }
          }

          // Deterministic Deduplication, Category Preservation & Cap Truncation
          const { retained: retainedEvents, isTruncated: retentionTruncated } = deduplicateAndRetainEvents(
            candidateEvents,
            MAX_REPLAY_EVENTS,
          );

          const isTruncated = anySourceOverflow || retentionTruncated;
          const totalEventCount = retainedEvents.length;

          // Format ReplayEvents with 1-indexed gap-free sequenceIndex
          const replayEventCreateData: Prisma.ReplayEventCreateManyInput[] = retainedEvents.map((evt, idx) => ({
            replayRunId: replayRun.id,
            incidentId,
            organizationId,
            sequenceIndex: idx + 1, // 1-indexed, gap-free
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
            await tx.replayEvent.createMany({
              data: replayEventCreateData,
            });
          }

          const updatedRun = await tx.replayRun.update({
            where: { id: replayRun.id },
            data: {
              status: ReplayRunStatus.COMPLETED,
              totalEventCount,
              isTruncated,
              completedAt: new Date(),
            },
          });

          await tx.incidentEvent.create({
            data: {
              incidentId,
              organizationId,
              userId: triggeredById || null,
              source: EventSource.SYSTEM,
              type: 'INCIDENT_REPLAY_COMPLETED',
              message: `Incident Replay timeline reconstructed (${updatedRun.totalEventCount} events)`,
              metadata: {
                automated: true,
                replayRun: true,
                runId: updatedRun.id,
                totalEventCount: updatedRun.totalEventCount,
              },
            },
          });

          // Pre-commit lock ownership verification inside transaction
          const isOwnerInTx = await verifyAndExtendLockOwnership();
          if (!isOwnerInTx) {
            throw new LockOwnershipLostError();
          }

          return [updatedRun];
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 10000,
          timeout: 30000,
        },
      );

      // 10. Broadcast Socket.IO Event: REPLAY_COMPLETED (only after successful commit)
      broadcastToIncident(incidentId, 'REPLAY_COMPLETED', {
        incidentId,
        runId: completedRun.id,
        totalEventCount: completedRun.totalEventCount,
      });

      return { runId: completedRun.id, status: 'completed' };
    } catch (err) {
      const sanitizedErrMsg = sanitizeString((err as Error).message || 'Incident Replay execution failed');
      logger.error({ err, incidentId }, 'Incident Replay execution failed');

      if (runId) {
        await prisma.replayRun
          .update({
            where: { id: runId },
            data: {
              status: ReplayRunStatus.FAILED,
              error: sanitizedErrMsg,
              completedAt: new Date(),
            },
          })
          .catch(() => undefined);

        broadcastToIncident(incidentId, 'REPLAY_FAILED', {
          incidentId,
          runId,
          error: sanitizedErrMsg,
        });
      }

      throw err;
    } finally {
      if (renewalTimer) {
        clearInterval(renewalTimer);
      }
      ReplayService.localInFlight.delete(incidentId);

      // Safe Lock Release
      if (redisLockAcquired) {
        await releaseDistributedLock(lockKey, lockVal);
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
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
      include: {
        events: {
          orderBy: { sequenceIndex: 'asc' },
          take: MAX_REPLAY_EVENTS,
        },
      },
    });

    const latestCompletedRun = await prisma.replayRun.findFirst({
      where: { incidentId, organizationId, status: ReplayRunStatus.COMPLETED },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
      include: {
        events: {
          orderBy: { sequenceIndex: 'asc' },
          take: MAX_REPLAY_EVENTS,
        },
      },
    });

    const latestFailedRun = await prisma.replayRun.findFirst({
      where: { incidentId, organizationId, status: ReplayRunStatus.FAILED },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    });

    const isRunning = latestRun?.status === ReplayRunStatus.RUNNING;

    return {
      incidentId,
      latestRun: latestCompletedRun || latestRun,
      latestCompletedRun,
      latestFailure: latestFailedRun && latestFailedRun.completedAt
        ? {
            runId: latestFailedRun.id,
            error: latestFailedRun.error || 'Execution failed',
            completedAt: latestFailedRun.completedAt.toISOString(),
          }
        : null,
      isRunning,
    };
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
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
      take: 50,
    });
  }
}
