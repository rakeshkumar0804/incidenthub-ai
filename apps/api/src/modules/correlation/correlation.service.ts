import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { logger } from '../../utils/logger';
import { NotFoundError } from '../../utils/errors';
import { broadcastToIncident } from '../../lib/socket';
import type { Prisma } from '@prisma/client';
import {
  EvidenceType,
  EvidenceSource,
  CorrelationRunStatus,
  CorrelationTriggerType,
} from '@prisma/client';
import type { CandidateSignal, IncidentScoringContext } from './correlation.types';
import { scoreAllCandidates, selectNearestCandidates } from './correlation.engine';

export class CorrelationService {
  // In-process per-incident lock guard when Redis is disconnected or during concurrency
  private static inProcessLocks = new Set<string>();

  /**
   * Triggers a multi-stage, deterministic correlation run for an incident.
   * Uses Redis distributed locking with atomic SET NX PX and an in-process fallback guard.
   */
  public static async runCorrelation(
    organizationId: string,
    incidentId: string,
    triggeredById?: string,
    triggerType: CorrelationTriggerType = CorrelationTriggerType.MANUAL_REQUEST,
  ): Promise<{ runId: string; status: string; correlatedCount: number }> {
    // 1. Verify Incident exists and belongs strictly to organizationId (Tenant Boundary)
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
      include: { project: true, service: true },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    // 2. Acquire Concurrency Lock (Atomic Redis SET NX PX + In-Process Guard)
    const lockKey = `lock:correlation:${incidentId}`;
    const lockVal = crypto.randomUUID();
    let lockAcquired = false;
    let redisLockAcquired = false;

    // Check in-process lock first
    if (CorrelationService.inProcessLocks.has(incidentId)) {
      logger.info({ incidentId }, 'Correlation run already in progress (in-process lock active)');
      return { runId: 'none', status: 'skipped_lock_active', correlatedCount: 0 };
    }

    try {
      if (redis.status !== 'ready' && redis.status !== 'connecting') {
        await Promise.race([
          redis.connect(),
          new Promise((r) => setTimeout(r, 300)),
        ]);
      }

      if (redis.status === 'ready') {
        const setRes = await redis.set(lockKey, lockVal, 'PX', 30000, 'NX');
        if (setRes === 'OK') {
          lockAcquired = true;
          redisLockAcquired = true;
        } else {
          lockAcquired = false;
        }
      } else {
        // Fallback: Redis unavailable, rely on in-process per-incident guard
        lockAcquired = true;
      }
    } catch {
      // Fallback on Redis error
      lockAcquired = true;
    }

    if (!lockAcquired) {
      logger.info({ incidentId }, 'Correlation run already in progress (Redis lock active)');
      return { runId: 'none', status: 'skipped_lock_active', correlatedCount: 0 };
    }

    CorrelationService.inProcessLocks.add(incidentId);

    let correlationRunId = '';

    try {
      // Create CorrelationRun audit record
      const windowStart = new Date(incident.detectedAt.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days prior
      const windowEnd = new Date(incident.detectedAt.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days after

      const correlationRun = await prisma.correlationRun.create({
        data: {
          organizationId,
          incidentId,
          triggerType,
          status: CorrelationRunStatus.RUNNING,
          windowStart,
          windowEnd,
          triggeredById: triggeredById || null,
        },
      });

      correlationRunId = correlationRun.id;

      // Broadcast Socket.IO event: CORRELATION_STARTED
      broadcastToIncident(incidentId, 'CORRELATION_STARTED', {
        incidentId,
        runId: correlationRun.id,
        startedAt: correlationRun.startedAt.toISOString(),
      });

      // =========================================================================
      // STAGE 1: Candidate Ingestion with Bidirectional Bounded Queries & Truncation Detection
      // =========================================================================
      let isTruncated = false;
      const allCandidates: CandidateSignal[] = [];

      // A. Deployments (Bidirectional bounded queries: cap at 50 nearest)
      const depCap = 50;
      const [precursorDeployments, postDeployments] = await Promise.all([
        prisma.gitHubDeployment.findMany({
          where: {
            repository: {
              organizationId,
              projectId: incident.projectId,
              ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            },
            createdAt: { gte: windowStart, lte: incident.detectedAt },
          },
          orderBy: { createdAt: 'desc' },
          take: depCap + 1,
          include: { repository: true },
        }),
        prisma.gitHubDeployment.findMany({
          where: {
            repository: {
              organizationId,
              projectId: incident.projectId,
              ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            },
            createdAt: { gt: incident.detectedAt, lte: windowEnd },
          },
          orderBy: { createdAt: 'asc' },
          take: depCap + 1,
          include: { repository: true },
        }),
      ]);

      if (precursorDeployments.length > depCap || postDeployments.length > depCap) {
        isTruncated = true;
      }

      const mergedDeployments = [
        ...precursorDeployments.slice(0, depCap),
        ...postDeployments.slice(0, depCap),
      ];

      const deploymentSignals: CandidateSignal[] = mergedDeployments.map((d) => ({
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: `deploy:${d.deploymentId}`,
        title: `GitHub Deployment to ${d.environment} (${d.state})`,
        description: `Environment: ${d.environment} | State: ${d.state} | Commit: ${d.commitSha.substring(0, 7)}`,
        url: d.url || d.repository.url,
        occurredAt: d.createdAt,
        serviceId: d.repository.serviceId,
        environment: d.environment,
        metadata: {
          deploymentId: d.deploymentId,
          commitSha: d.commitSha,
          environment: d.environment,
          state: d.state,
          creator: d.creator,
          projectId: d.repository.projectId,
        },
        rawEntity: d,
      }));

      const depSelection = selectNearestCandidates(deploymentSignals, incident.detectedAt, depCap);
      if (depSelection.isTruncated) isTruncated = true;
      allCandidates.push(...depSelection.retained);

      // B. Commits (Bidirectional bounded queries: cap at 100 nearest)
      const commitCap = 100;
      const [precursorCommits, postCommits] = await Promise.all([
        prisma.gitHubCommit.findMany({
          where: {
            repository: {
              organizationId,
              projectId: incident.projectId,
              ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            },
            committedAt: { gte: windowStart, lte: incident.detectedAt },
          },
          orderBy: { committedAt: 'desc' },
          take: commitCap + 1,
          include: { repository: true },
        }),
        prisma.gitHubCommit.findMany({
          where: {
            repository: {
              organizationId,
              projectId: incident.projectId,
              ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            },
            committedAt: { gt: incident.detectedAt, lte: windowEnd },
          },
          orderBy: { committedAt: 'asc' },
          take: commitCap + 1,
          include: { repository: true },
        }),
      ]);

      if (precursorCommits.length > commitCap || postCommits.length > commitCap) {
        isTruncated = true;
      }

      const mergedCommits = [
        ...precursorCommits.slice(0, commitCap),
        ...postCommits.slice(0, commitCap),
      ];

      const commitSignals: CandidateSignal[] = mergedCommits.map((c) => ({
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: `commit:${c.sha}`,
        title: `Commit ${c.sha.substring(0, 7)}: ${c.message.split('\n')[0]}`,
        description: `Author: ${c.authorName} | Branch: ${c.branch}`,
        url: c.url,
        occurredAt: c.committedAt,
        serviceId: c.repository.serviceId,
        environment: 'UNKNOWN', // Environment-neutral unless deployment linked
        metadata: {
          sha: c.sha,
          authorName: c.authorName,
          branch: c.branch,
          message: c.message,
          projectId: c.repository.projectId,
        },
        rawEntity: c,
      }));

      const commitSelection = selectNearestCandidates(commitSignals, incident.detectedAt, commitCap);
      if (commitSelection.isTruncated) isTruncated = true;
      allCandidates.push(...commitSelection.retained);

      // C. Pull Requests (Bidirectional bounded queries: cap at 50 nearest)
      const prCap = 50;
      const [precursorPRs, postPRs] = await Promise.all([
        prisma.gitHubPullRequest.findMany({
          where: {
            repository: {
              organizationId,
              projectId: incident.projectId,
              ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            },
            updatedAt: { gte: windowStart, lte: incident.detectedAt },
          },
          orderBy: { updatedAt: 'desc' },
          take: prCap + 1,
          include: { repository: true },
        }),
        prisma.gitHubPullRequest.findMany({
          where: {
            repository: {
              organizationId,
              projectId: incident.projectId,
              ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            },
            updatedAt: { gt: incident.detectedAt, lte: windowEnd },
          },
          orderBy: { updatedAt: 'asc' },
          take: prCap + 1,
          include: { repository: true },
        }),
      ]);

      if (precursorPRs.length > prCap || postPRs.length > prCap) {
        isTruncated = true;
      }

      const mergedPRs = [
        ...precursorPRs.slice(0, prCap),
        ...postPRs.slice(0, prCap),
      ];

      const prSignals: CandidateSignal[] = mergedPRs.map((pr) => ({
        type: EvidenceType.GITHUB_PR,
        externalRefId: `pr:${pr.repositoryId}:${pr.number}`,
        title: `PR #${pr.number}: ${pr.title}`,
        description: `State: ${pr.state} | Author: ${pr.author} | Target: ${pr.targetBranch}`,
        url: pr.url,
        occurredAt: pr.mergedAt || pr.updatedAt,
        serviceId: pr.repository.serviceId,
        environment: 'UNKNOWN', // Environment-neutral
        metadata: {
          number: pr.number,
          state: pr.state,
          author: pr.author,
          branch: pr.branch,
          mergedAt: pr.mergedAt,
          projectId: pr.repository.projectId,
        },
        rawEntity: pr,
      }));

      const prSelection = selectNearestCandidates(prSignals, incident.detectedAt, prCap);
      if (prSelection.isTruncated) isTruncated = true;
      allCandidates.push(...prSelection.retained);

      // D. Sentry Issues (Bidirectional bounded queries: cap at 50 nearest)
      const sentryCap = 50;
      const [precursorSentry, postSentry] = await Promise.all([
        prisma.sentryIssue.findMany({
          where: {
            organizationId,
            projectId: incident.projectId,
            ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            lastSeen: { gte: windowStart, lte: incident.detectedAt },
          },
          orderBy: { lastSeen: 'desc' },
          take: sentryCap + 1,
        }),
        prisma.sentryIssue.findMany({
          where: {
            organizationId,
            projectId: incident.projectId,
            ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            lastSeen: { gt: incident.detectedAt, lte: windowEnd },
          },
          orderBy: { lastSeen: 'asc' },
          take: sentryCap + 1,
        }),
      ]);

      if (precursorSentry.length > sentryCap || postSentry.length > sentryCap) {
        isTruncated = true;
      }

      const mergedSentry = [
        ...precursorSentry.slice(0, sentryCap),
        ...postSentry.slice(0, sentryCap),
      ];

      const sentrySignals: CandidateSignal[] = mergedSentry.map((s) => ({
        type: EvidenceType.SENTRY_ERROR,
        externalRefId: `sentry:${s.sentryIssueId}`,
        title: `Sentry Issue ${s.sentryIssueId}: ${s.title}`,
        description: `Level: ${s.level} | Users: ${s.userCount} | Events: ${s.eventCount} | Culprit: ${s.culprit || 'N/A'}`,
        url: s.permalink,
        occurredAt: s.lastSeen,
        serviceId: s.serviceId,
        environment: s.environment,
        metadata: {
          sentryIssueId: s.sentryIssueId,
          level: s.level,
          userCount: s.userCount,
          eventCount: s.eventCount,
          culprit: s.culprit,
          release: s.release,
          firstSeen: s.firstSeen,
          lastSeen: s.lastSeen,
          projectId: s.projectId,
        },
        rawEntity: s,
      }));

      const sentrySelection = selectNearestCandidates(sentrySignals, incident.detectedAt, sentryCap);
      if (sentrySelection.isTruncated) isTruncated = true;
      allCandidates.push(...sentrySelection.retained);

      // E. Workflow Runs (Bidirectional bounded queries: cap at 50 nearest)
      const wfCap = 50;
      const [precursorWorkflows, postWorkflows] = await Promise.all([
        prisma.gitHubWorkflowRun.findMany({
          where: {
            repository: {
              organizationId,
              projectId: incident.projectId,
              ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            },
            createdAt: { gte: windowStart, lte: incident.detectedAt },
          },
          orderBy: { createdAt: 'desc' },
          take: wfCap + 1,
          include: { repository: true },
        }),
        prisma.gitHubWorkflowRun.findMany({
          where: {
            repository: {
              organizationId,
              projectId: incident.projectId,
              ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
            },
            createdAt: { gt: incident.detectedAt, lte: windowEnd },
          },
          orderBy: { createdAt: 'asc' },
          take: wfCap + 1,
          include: { repository: true },
        }),
      ]);

      if (precursorWorkflows.length > wfCap || postWorkflows.length > wfCap) {
        isTruncated = true;
      }

      const mergedWorkflows = [
        ...precursorWorkflows.slice(0, wfCap),
        ...postWorkflows.slice(0, wfCap),
      ];

      const workflowSignals: CandidateSignal[] = mergedWorkflows.map((wf) => ({
        type: EvidenceType.GITHUB_WORKFLOW_RUN,
        externalRefId: `workflow:${wf.runId}`,
        title: `Workflow ${wf.name} (${wf.conclusion || wf.status})`,
        description: `Event: ${wf.event} | Branch: ${wf.branch} | Commit: ${wf.commitSha.substring(0, 7)}`,
        url: wf.url,
        occurredAt: wf.createdAt,
        serviceId: wf.repository.serviceId,
        environment: 'UNKNOWN', // Environment-neutral
        metadata: {
          runId: wf.runId,
          name: wf.name,
          conclusion: wf.conclusion,
          status: wf.status,
          commitSha: wf.commitSha,
          projectId: wf.repository.projectId,
        },
        rawEntity: wf,
      }));

      const workflowSelection = selectNearestCandidates(workflowSignals, incident.detectedAt, wfCap);
      if (workflowSelection.isTruncated) isTruncated = true;
      allCandidates.push(...workflowSelection.retained);

      // =========================================================================
      // STAGE 2: Pure Deterministic Scoring Core
      // =========================================================================
      const scoringContext: IncidentScoringContext = {
        incidentId,
        organizationId,
        projectId: incident.projectId,
        serviceId: incident.serviceId,
        environment: incident.environment,
        detectedAt: incident.detectedAt,
      };

      const scoredCandidates = scoreAllCandidates(allCandidates, scoringContext);

      // =========================================================================
      // STAGE 3: Atomic Persistence Transaction
      // =========================================================================
      await prisma.$transaction(async (tx) => {
        // 1. Upsert all current-run scored evidence
        for (const sc of scoredCandidates) {
          await tx.incidentEvidence.upsert({
            where: {
              incidentId_type_externalRefId: {
                incidentId,
                type: sc.candidate.type,
                externalRefId: sc.candidate.externalRefId,
              },
            },
            create: {
              incidentId,
              correlationRunId: correlationRun.id,
              type: sc.candidate.type,
              source: EvidenceSource.CORRELATION_ENGINE,
              externalRefId: sc.candidate.externalRefId,
              confidenceTier: sc.confidenceTier,
              title: sc.candidate.title,
              description: sc.candidate.description,
              url: sc.candidate.url,
              confidence: sc.confidence,
              reasons: sc.reasons as unknown as Prisma.InputJsonValue,
              scoreBreakdown: sc.scoreBreakdown,
              metadata: sc.candidate.metadata as unknown as Prisma.InputJsonValue,
            },
            update: {
              correlationRunId: correlationRun.id,
              confidenceTier: sc.confidenceTier,
              confidence: sc.confidence,
              reasons: sc.reasons as unknown as Prisma.InputJsonValue,
              scoreBreakdown: sc.scoreBreakdown,
              metadata: sc.candidate.metadata as unknown as Prisma.InputJsonValue,
              title: sc.candidate.title,
              description: sc.candidate.description,
              url: sc.candidate.url,
              updatedAt: new Date(),
            },
          });
        }

        // 2. Mark CorrelationRun completed
        await tx.correlationRun.update({
          where: { id: correlationRun.id },
          data: {
            status: CorrelationRunStatus.COMPLETED,
            candidateCount: allCandidates.length,
            correlatedCount: scoredCandidates.length,
            isTruncated,
            completedAt: new Date(),
          },
        });

        // 3. Create exactly one completion timeline event
        await tx.incidentEvent.create({
          data: {
            incidentId,
            organizationId,
            userId: triggeredById || null,
            source: 'SYSTEM',
            type: 'CORRELATION_RUN_COMPLETED',
            message: `Correlation Engine executed (${scoredCandidates.length} evidence items ranked, isTruncated=${isTruncated})`,
            metadata: {
              automated: true,
              correlationRun: true,
              runId: correlationRun.id,
              candidateCount: allCandidates.length,
              correlatedCount: scoredCandidates.length,
              isTruncated,
            },
            occurredAt: new Date(),
          },
        });
      });

      // Post-commit broadcast
      broadcastToIncident(incidentId, 'CORRELATION_COMPLETED', {
        incidentId,
        runId: correlationRun.id,
        correlatedCount: scoredCandidates.length,
        isTruncated,
        completedAt: new Date().toISOString(),
      });

      return { runId: correlationRun.id, status: 'completed', correlatedCount: scoredCandidates.length };
    } catch (err: unknown) {
      logger.error({ err, incidentId }, 'Correlation run failed');
      if (correlationRunId) {
        try {
          const sanitizedError =
            err instanceof Error ? err.message.replace(/[\r\n]+/g, ' ').substring(0, 200) : 'Internal correlation failure';
          await prisma.correlationRun.update({
            where: { id: correlationRunId },
            data: {
              status: CorrelationRunStatus.FAILED,
              error: sanitizedError,
              completedAt: new Date(),
            },
          });
        } catch (updateErr) {
          logger.error({ updateErr }, 'Failed to record failed correlation run status');
        }
      }
      throw err;
    } finally {
      // Safe Redis Lock Release (Lua Script)
      try {
        if (redisLockAcquired && redis.status === 'ready') {
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
      } finally {
        CorrelationService.inProcessLocks.delete(incidentId);
      }
    }
  }

  /**
   * Retrieves latest completed correlation run and its ranked evidence for an incident.
   * Stale evidence from previous runs is hidden from the active list, while preserving manual evidence.
   */
  public static async getCorrelationEvidence(
    organizationId: string,
    incidentId: string,
  ) {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    const latestCompletedRun = await prisma.correlationRun.findFirst({
      where: { organizationId, incidentId, status: CorrelationRunStatus.COMPLETED },
      orderBy: { completedAt: 'desc' },
    });

    const latestRun = await prisma.correlationRun.findFirst({
      where: { organizationId, incidentId },
      orderBy: { startedAt: 'desc' },
    });

    const whereClause: Prisma.IncidentEvidenceWhereInput = latestCompletedRun
      ? {
          incidentId,
          OR: [
            { source: { not: EvidenceSource.CORRELATION_ENGINE } },
            {
              source: EvidenceSource.CORRELATION_ENGINE,
              correlationRunId: latestCompletedRun.id,
            },
          ],
        }
      : {
          incidentId,
          source: { not: EvidenceSource.CORRELATION_ENGINE },
        };

    const evidenceList = await prisma.incidentEvidence.findMany({
      where: whereClause,
      orderBy: [{ confidence: 'desc' }, { addedAt: 'desc' }],
    });

    return {
      incidentId,
      latestRun,
      latestCompletedRun,
      evidence: evidenceList,
    };
  }

  /**
   * Lists correlation run audit history.
   */
  public static async getCorrelationRuns(
    organizationId: string,
    incidentId: string,
  ) {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    return prisma.correlationRun.findMany({
      where: { organizationId, incidentId },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
      take: 20,
    });
  }

  /**
   * Updates acknowledgment or dismissal status of correlation evidence.
   */
  public static async updateEvidenceStatus(
    organizationId: string,
    incidentId: string,
    evidenceId: string,
    action: 'acknowledge' | 'dismiss' | 'reset',
    userId: string,
  ) {
    const evidence = await prisma.incidentEvidence.findFirst({
      where: { id: evidenceId, incidentId },
      include: { incident: true },
    });

    if (!evidence || evidence.incident.organizationId !== organizationId) {
      throw new NotFoundError('Evidence item not found');
    }

    let updateData: Record<string, unknown> = {};
    if (action === 'acknowledge') {
      updateData = { acknowledgedAt: new Date(), dismissedAt: null, dismissedById: null };
    } else if (action === 'dismiss') {
      updateData = { dismissedAt: new Date(), dismissedById: userId, acknowledgedAt: null };
    } else if (action === 'reset') {
      updateData = { acknowledgedAt: null, dismissedAt: null, dismissedById: null };
    }

    const updated = await prisma.incidentEvidence.update({
      where: { id: evidenceId },
      data: updateData,
    });

    broadcastToIncident(incidentId, 'CORRELATION_EVIDENCE_UPDATED', {
      incidentId,
      evidence: updated,
    });

    return updated;
  }
}
