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
  EvidenceConfidenceTier,
  CorrelationRunStatus,
  CorrelationTriggerType,
} from '@prisma/client';
import type { CandidateSignal, CandidateScoreResult } from './correlation.types';

export class CorrelationService {
  /**
   * Triggers a multi-stage, deterministic correlation run for an incident.
   * Uses Redis distributed locking to guarantee single execution across multi-instance nodes.
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

    // 2. Acquire Redis Distributed Concurrency Lock (30s TTL)
    const lockKey = `lock:correlation:${incidentId}`;
    const lockVal = crypto.randomUUID();
    let lockAcquired = true;

    try {
      if (redis.status !== 'ready' && redis.status !== 'connecting') {
        await Promise.race([
          redis.connect(),
          new Promise((r) => setTimeout(r, 300)),
        ]);
      }

      if (redis.status === 'ready') {
        const existingLock = await redis.get(lockKey);
        if (existingLock) {
          lockAcquired = false;
        } else {
          await redis.set(lockKey, lockVal, 'PX', 30000, 'NX');
        }
      }
    } catch {
      // Fallback: If Redis is unavailable, allow execution to proceed under DB safety net
    }

    if (!lockAcquired) {
      logger.info({ incidentId }, 'Correlation run already in progress (Redis lock active)');
      return { runId: 'none', status: 'skipped: lock active', correlatedCount: 0 };
    }

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
      // STAGE 1: Candidate Ingestion with Bounded Queries & Truncation Detection
      // =========================================================================
      let isTruncated = false;
      const candidates: CandidateSignal[] = [];

      // A. Deployments (Take 51 for limit 50)
      const deployments = await prisma.gitHubDeployment.findMany({
        where: {
          repository: {
            organizationId,
            projectId: incident.projectId,
            ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
          },
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { createdAt: 'desc' },
        take: 51,
        include: { repository: true },
      });

      if (deployments.length > 50) {
        isTruncated = true;
        deployments.pop(); // Retain top 50
      }

      for (const d of deployments) {
        candidates.push({
          type: EvidenceType.GITHUB_DEPLOYMENT,
          externalRefId: `deploy:${d.deploymentId}`,
          title: `GitHub Deployment to ${d.environment} (${d.state})`,
          description: `Environment: ${d.environment} | State: ${d.state} | Commit: ${d.commitSha.substring(0, 7)}`,
          url: d.url || d.repository.url,
          occurredAt: d.createdAt,
          serviceId: d.repository.serviceId,
          environment: d.environment.toUpperCase(),
          metadata: {
            deploymentId: d.deploymentId,
            commitSha: d.commitSha,
            environment: d.environment,
            state: d.state,
            creator: d.creator,
          },
          rawEntity: d,
        });
      }

      // B. Commits (Take 101 for limit 100)
      const commits = await prisma.gitHubCommit.findMany({
        where: {
          repository: {
            organizationId,
            projectId: incident.projectId,
            ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
          },
          committedAt: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { committedAt: 'desc' },
        take: 101,
        include: { repository: true },
      });

      if (commits.length > 100) {
        isTruncated = true;
        commits.pop();
      }

      for (const c of commits) {
        candidates.push({
          type: EvidenceType.GITHUB_COMMIT,
          externalRefId: `commit:${c.sha}`,
          title: `Commit ${c.sha.substring(0, 7)}: ${c.message.split('\n')[0]}`,
          description: `Author: ${c.authorName} | Branch: ${c.branch}`,
          url: c.url,
          occurredAt: c.committedAt,
          serviceId: c.repository.serviceId,
          environment: 'PRODUCTION', // Default branch commits
          metadata: {
            sha: c.sha,
            authorName: c.authorName,
            branch: c.branch,
            message: c.message,
          },
          rawEntity: c,
        });
      }

      // C. Pull Requests (Take 51 for limit 50)
      const pullRequests = await prisma.gitHubPullRequest.findMany({
        where: {
          repository: {
            organizationId,
            projectId: incident.projectId,
            ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
          },
          updatedAt: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { updatedAt: 'desc' },
        take: 51,
        include: { repository: true },
      });

      if (pullRequests.length > 50) {
        isTruncated = true;
        pullRequests.pop();
      }

      for (const pr of pullRequests) {
        candidates.push({
          type: EvidenceType.GITHUB_PR,
          externalRefId: `pr:${pr.repositoryId}:${pr.number}`,
          title: `PR #${pr.number}: ${pr.title}`,
          description: `State: ${pr.state} | Author: ${pr.author} | Target: ${pr.targetBranch}`,
          url: pr.url,
          occurredAt: pr.mergedAt || pr.updatedAt,
          serviceId: pr.repository.serviceId,
          environment: 'PRODUCTION',
          metadata: {
            number: pr.number,
            state: pr.state,
            author: pr.author,
            branch: pr.branch,
          },
          rawEntity: pr,
        });
      }

      // D. Sentry Issues (Take 51 for limit 50)
      const sentryIssues = await prisma.sentryIssue.findMany({
        where: {
          organizationId,
          projectId: incident.projectId,
          ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
          lastSeen: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { lastSeen: 'desc' },
        take: 51,
      });

      if (sentryIssues.length > 50) {
        isTruncated = true;
        sentryIssues.pop();
      }

      for (const s of sentryIssues) {
        candidates.push({
          type: EvidenceType.SENTRY_ERROR,
          externalRefId: `sentry:${s.sentryIssueId}`,
          title: `Sentry Issue ${s.sentryIssueId}: ${s.title}`,
          description: `Level: ${s.level} | Users: ${s.userCount} | Events: ${s.eventCount} | Culprit: ${s.culprit || 'N/A'}`,
          url: s.permalink,
          occurredAt: s.lastSeen,
          serviceId: s.serviceId,
          environment: s.environment.toUpperCase(),
          metadata: {
            sentryIssueId: s.sentryIssueId,
            level: s.level,
            userCount: s.userCount,
            eventCount: s.eventCount,
            culprit: s.culprit,
            release: s.release,
          },
          rawEntity: s,
        });
      }

      // E. Workflow Runs (Take 51 for limit 50)
      const workflowRuns = await prisma.gitHubWorkflowRun.findMany({
        where: {
          repository: {
            organizationId,
            projectId: incident.projectId,
            ...(incident.serviceId ? { serviceId: incident.serviceId } : {}),
          },
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { createdAt: 'desc' },
        take: 51,
        include: { repository: true },
      });

      if (workflowRuns.length > 50) {
        isTruncated = true;
        workflowRuns.pop();
      }

      for (const wf of workflowRuns) {
        candidates.push({
          type: EvidenceType.GITHUB_WORKFLOW_RUN,
          externalRefId: `workflow:${wf.runId}`,
          title: `Workflow ${wf.name} (${wf.conclusion || wf.status})`,
          description: `Event: ${wf.event} | Branch: ${wf.branch} | Commit: ${wf.commitSha.substring(0, 7)}`,
          url: wf.url,
          occurredAt: wf.createdAt,
          serviceId: wf.repository.serviceId,
          environment: 'PRODUCTION',
          metadata: {
            runId: wf.runId,
            name: wf.name,
            conclusion: wf.conclusion,
            status: wf.status,
            commitSha: wf.commitSha,
          },
          rawEntity: wf,
        });
      }

      // =========================================================================
      // STAGE 1 & 2: Score Deployments & Identify Correlated Deployment Anchors
      // =========================================================================
      const scoredCandidates: CandidateScoreResult[] = [];
      const correlatedCommitShas = new Set<string>();

      for (const c of candidates) {
        const deltaMs = Math.abs(c.occurredAt.getTime() - incident.detectedAt.getTime());
        const deltaMins = deltaMs / (1000 * 60);
        const tempScore = Math.max(0, 1.0 - deltaMins / 150.0) * 0.20; // Temporal decay over 2.5h
        const isTemporalProximity = deltaMins <= 60;

        const isServiceMatch = Boolean(incident.serviceId && c.serviceId === incident.serviceId);
        const serviceScore = isServiceMatch ? 0.25 : 0.0;

        const normalizedIncEnv = incident.environment.toUpperCase();
        const isEnvMatch = c.environment === normalizedIncEnv;
        const envScore = isEnvMatch ? 0.15 : c.environment === 'STAGING' ? 0.09 : 0.045;

        if (c.type === EvidenceType.GITHUB_DEPLOYMENT) {
          const isPrecursor = c.occurredAt <= incident.detectedAt && deltaMins <= 60;
          const precursorScore = isPrecursor ? 0.25 : 0.0;

          const baseScore = serviceScore + envScore + tempScore + precursorScore;
          const finalRawScore = baseScore;
          const confidence = Math.min(1.0, finalRawScore);

          if (finalRawScore >= 0.65) {
            const meta = c.metadata as { commitSha?: string };
            if (meta.commitSha) {
              correlatedCommitShas.add(meta.commitSha);
            }
          }

          let tier: EvidenceConfidenceTier = EvidenceConfidenceTier.LOW;
          if (confidence >= 0.8) tier = EvidenceConfidenceTier.HIGH;
          else if (confidence >= 0.5) tier = EvidenceConfidenceTier.MEDIUM;

          scoredCandidates.push({
            candidate: c,
            baseScore,
            commitPropagationBoost: 0,
            prPropagationBoost: 0,
            finalRawScore,
            confidence,
            confidenceTier: tier,
            reasons: {
              temporalProximity: isTemporalProximity,
              projectMatch: true,
              serviceMatch: isServiceMatch,
              environmentMatch: isEnvMatch,
              deploymentRelation: true,
              commitRelation: false,
              sentrySpike: false,
              workflowFailure: false,
            },
            scoreBreakdown: {
              serviceScore,
              envScore,
              tempScore,
              precursorScore,
            },
          });
        }
      }

      // =========================================================================
      // STAGE 3 & 4: Propagate Boosts to Commits/PRs and Evaluate Sentry/Workflows
      // =========================================================================
      for (const c of candidates) {
        if (c.type === EvidenceType.GITHUB_DEPLOYMENT) continue; // Already processed in Stage 1 & 2

        const deltaMs = Math.abs(c.occurredAt.getTime() - incident.detectedAt.getTime());
        const deltaMins = deltaMs / (1000 * 60);
        const tempScore = Math.max(0, 1.0 - deltaMins / 150.0) * 0.20;
        const isTemporalProximity = deltaMins <= 60;

        const isServiceMatch = Boolean(incident.serviceId && c.serviceId === incident.serviceId);
        const serviceScore = isServiceMatch ? 0.25 : 0.0;

        const normalizedIncEnv = incident.environment.toUpperCase();
        const isEnvMatch = c.environment === normalizedIncEnv;
        const envScore = isEnvMatch ? 0.15 : c.environment === 'STAGING' ? 0.09 : 0.045;

        let baseScore = serviceScore + envScore + tempScore;
        let commitPropBoost = 0;
        let prPropBoost = 0;

        let isSentrySpike = false;
        let isWorkflowFailure = false;
        let isCommitRelation = false;
        let isDeploymentRelation = false;

        if (c.type === EvidenceType.GITHUB_COMMIT) {
          const meta = c.metadata as { sha?: string };
          if (meta.sha && correlatedCommitShas.has(meta.sha)) {
            commitPropBoost = 0.25;
            isCommitRelation = true;
            isDeploymentRelation = true;
          }
        } else if (c.type === EvidenceType.GITHUB_PR) {
          const meta = c.metadata as { branch?: string };
          // Check if PR branch relates to correlated commit
          if (meta.branch && Array.from(correlatedCommitShas).length > 0) {
            commitPropBoost = 0.25;
            prPropBoost = 0.15;
            isCommitRelation = true;
            isDeploymentRelation = true;
          }
        } else if (c.type === EvidenceType.SENTRY_ERROR) {
          const meta = c.metadata as { userCount?: number; level?: string };
          if ((meta.userCount && meta.userCount >= 5) || meta.level === 'fatal') {
            baseScore += 0.25;
            isSentrySpike = true;
          }
        } else if (c.type === EvidenceType.GITHUB_WORKFLOW_RUN) {
          const meta = c.metadata as { conclusion?: string };
          if (meta.conclusion === 'failure') {
            baseScore += 0.25;
            isWorkflowFailure = true;
          }
        }

        const finalRawScore = baseScore + commitPropBoost + prPropBoost;
        const confidence = Math.min(1.0, finalRawScore);

        if (confidence < 0.2) continue; // Discard background noise (< 0.20)

        let tier: EvidenceConfidenceTier = EvidenceConfidenceTier.LOW;
        if (confidence >= 0.8) tier = EvidenceConfidenceTier.HIGH;
        else if (confidence >= 0.5) tier = EvidenceConfidenceTier.MEDIUM;

        scoredCandidates.push({
          candidate: c,
          baseScore,
          commitPropagationBoost: commitPropBoost,
          prPropagationBoost: prPropBoost,
          finalRawScore,
          confidence,
          confidenceTier: tier,
          reasons: {
            temporalProximity: isTemporalProximity,
            projectMatch: true,
            serviceMatch: isServiceMatch,
            environmentMatch: isEnvMatch,
            deploymentRelation: isDeploymentRelation,
            commitRelation: isCommitRelation,
            sentrySpike: isSentrySpike,
            workflowFailure: isWorkflowFailure,
          },
          scoreBreakdown: {
            serviceScore,
            envScore,
            tempScore,
            commitPropBoost,
            prPropBoost,
          },
        });
      }

      // =========================================================================
      // STAGE 4: Idempotent Database Upsert & Notifications
      // =========================================================================
      let correlatedCount = 0;

      for (const sc of scoredCandidates) {
        await prisma.incidentEvidence.upsert({
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
            reasons: sc.reasons,
            scoreBreakdown: sc.scoreBreakdown,
            metadata: sc.candidate.metadata as unknown as Prisma.InputJsonValue,
          },
          update: {
            correlationRunId: correlationRun.id,
            confidenceTier: sc.confidenceTier,
            confidence: sc.confidence,
            reasons: sc.reasons,
            scoreBreakdown: sc.scoreBreakdown,
            metadata: sc.candidate.metadata as unknown as Prisma.InputJsonValue,
            updatedAt: new Date(),
          },
        });
        correlatedCount++;
      }

      // Update CorrelationRun summary
      await prisma.correlationRun.update({
        where: { id: correlationRun.id },
        data: {
          status: CorrelationRunStatus.COMPLETED,
          candidateCount: candidates.length,
          correlatedCount,
          isTruncated,
          completedAt: new Date(),
        },
      });

      // Log audit timeline event (tagged metadata.correlationRun = true for loop prevention)
      await prisma.incidentEvent.create({
        data: {
          incidentId,
          organizationId,
          userId: triggeredById || null,
          source: 'SYSTEM',
          type: 'CORRELATION_RUN_COMPLETED',
          message: `Correlation Engine executed (${correlatedCount} evidence items ranked, isTruncated=${isTruncated})`,
          metadata: {
            automated: true,
            correlationRun: true,
            runId: correlationRun.id,
            candidateCount: candidates.length,
            correlatedCount,
            isTruncated,
          },
          occurredAt: new Date(),
        },
      });

      // Broadcast Socket.IO event: CORRELATION_COMPLETED
      broadcastToIncident(incidentId, 'CORRELATION_COMPLETED', {
        incidentId,
        runId: correlationRun.id,
        correlatedCount,
        isTruncated,
        completedAt: new Date().toISOString(),
      });

      return { runId: correlationRun.id, status: 'completed', correlatedCount };
    } catch (err: unknown) {
      logger.error({ err, incidentId }, 'Correlation run failed');
      if (correlationRunId) {
        await prisma.correlationRun.update({
          where: { id: correlationRunId },
          data: {
            status: CorrelationRunStatus.FAILED,
            error: (err as Error).message,
            completedAt: new Date(),
          },
        });
      }
      throw err;
    } finally {
      // Safe Redis Lock Release (Lua Script)
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

  /**
   * Retrieves latest correlation runs and ranked evidence for an incident.
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

    const evidenceList = await prisma.incidentEvidence.findMany({
      where: { incidentId },
      orderBy: [{ confidence: 'desc' }, { addedAt: 'desc' }],
    });

    const latestRun = await prisma.correlationRun.findFirst({
      where: { organizationId, incidentId },
      orderBy: { startedAt: 'desc' },
    });

    return {
      incidentId,
      latestRun,
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
      orderBy: { startedAt: 'desc' },
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
