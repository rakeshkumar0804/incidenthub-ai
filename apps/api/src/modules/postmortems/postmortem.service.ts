import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { PostmortemStatus, PostmortemTriggerType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { logger } from '../../utils/logger';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { broadcastToIncident } from '../../lib/socket';
import { OpenAIPostmortemProvider } from './providers/openaiPostmortem.provider';
import type { EvidenceCitationDto } from '@incidenthub/shared';
import type { UpdatePostmortemSchema, CreateActionItemSchema, UpdateActionItemSchema } from './postmortem.schema';

export function redactSecrets(text: string): string {
  if (!text) return '';
  return text
    .replace(/ghp_[a-zA-Z0-9]{36}/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/sentry_[a-zA-Z0-9]{32,64}/g, '[REDACTED_SENTRY_TOKEN]')
    .replace(/sk-[a-zA-Z0-9]{32,64}/g, '[REDACTED_OPENAI_KEY]')
    .replace(/postgres:\/\/[^:]+:[^@]+@[^/]+\/[^\s]+/g, 'postgres://[REDACTED_DB_CREDENTIALS]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/g, 'Bearer [REDACTED_JWT_TOKEN]');
}

export class PostmortemService {
  private static provider = new OpenAIPostmortemProvider();

  public static async generatePostmortem(
    organizationId: string,
    incidentId: string,
    triggeredById?: string,
    triggerType: PostmortemTriggerType = PostmortemTriggerType.MANUAL_REQUEST,
  ): Promise<{ postmortemId: string; versionId: string; versionNumber: number }> {
    // 1. Multi-tenant Guard & Incident Fetch
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
      include: {
        project: true,
        service: true,
      },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    // 2. Redis Distributed Locking (60s TTL)
    const lockKey = `lock:postmortem:${incidentId}`;
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
          await redis.set(lockKey, lockVal, 'PX', 60000, 'NX');
        }
      }
    } catch {
      // Fallback
    }

    if (!lockAcquired) {
      logger.info({ incidentId }, 'AI Postmortem generation already in progress (Redis lock active)');
      throw new ValidationError('A postmortem generation is already in progress for this incident');
    }

    let runId = '';

    try {
      // Create PostmortemRun audit record
      const runRecord = await prisma.postmortemRun.create({
        data: {
          organizationId,
          incidentId,
          triggerType,
          status: 'RUNNING',
          triggeredById: triggeredById || null,
        },
      });
      runId = runRecord.id;

      // Broadcast Socket.IO event: POSTMORTEM_GENERATION_STARTED
      broadcastToIncident(incidentId, 'POSTMORTEM_GENERATION_STARTED', {
        incidentId,
        runId: runRecord.id,
        startedAt: runRecord.startedAt.toISOString(),
      });

      // 3. Upstream Read-Only Data Assembly (Bounded)
      const evidenceItems = await prisma.incidentEvidence.findMany({
        where: { incidentId },
        take: 30,
      });

      const investigationRun = await prisma.investigationRun.findFirst({
        where: { incidentId, organizationId, status: 'COMPLETED' },
        orderBy: { startedAt: 'desc' },
      });

      const replayRun = await prisma.replayRun.findFirst({
        where: { incidentId, organizationId, status: 'COMPLETED' },
        orderBy: { startedAt: 'desc' },
        include: {
          events: {
            orderBy: { sequenceIndex: 'asc' },
            take: 30,
          },
        },
      });

      // Build valid source map for citation validation
      const validSourceMap = new Map<string, 'EVIDENCE' | 'REPLAY_EVENT' | 'INVESTIGATION_RUN' | 'COMMENT'>();
      evidenceItems.forEach((ev) => validSourceMap.set(ev.id, 'EVIDENCE'));
      if (investigationRun) validSourceMap.set(investigationRun.id, 'INVESTIGATION_RUN');
      if (replayRun?.events) {
        replayRun.events.forEach((re) => validSourceMap.set(re.id, 'REPLAY_EVENT'));
      }

      const comments = await prisma.comment.findMany({ where: { incidentId }, take: 20 });
      comments.forEach((c) => validSourceMap.set(c.id, 'COMMENT'));

      // 4. Redact Secrets & Build Context
      const context = {
        incident: {
          id: incident.id,
          number: incident.number,
          title: redactSecrets(incident.title),
          description: incident.description ? redactSecrets(incident.description) : null,
          severity: incident.severity,
          status: incident.status,
          environment: incident.environment,
          detectedAt: incident.detectedAt,
          resolvedAt: incident.resolvedAt,
          serviceName: incident.service?.name || null,
          projectName: incident.project?.name || null,
        },
        evidenceItems: evidenceItems.map((ev) => ({
          id: ev.id,
          type: ev.type,
          title: redactSecrets(ev.title),
          description: ev.description ? redactSecrets(ev.description) : null,
          url: ev.url,
          confidenceTier: ev.confidenceTier,
        })),
        investigationRun: investigationRun
          ? {
              id: investigationRun.id,
              probableRootCause: investigationRun.probableRootCause ? redactSecrets(investigationRun.probableRootCause) : null,
              confidenceTier: investigationRun.confidenceTier,
              riskAssessment: investigationRun.riskAssessment ? redactSecrets(investigationRun.riskAssessment) : null,
              uncertainty: investigationRun.uncertainty ? redactSecrets(JSON.stringify(investigationRun.uncertainty)) : null,
            }
          : null,
        replayEvents: (replayRun?.events || []).map((re) => ({
          id: re.id,
          sequenceIndex: re.sequenceIndex,
          category: re.category,
          eventType: re.eventType,
          title: redactSecrets(re.title),
          timestamp: re.timestamp,
          actorName: re.actorName,
        })),
      };

      // 5. Execute AI Postmortem Provider
      const result = await this.provider.generatePostmortem(context);

      // 6. Anti-Hallucination Citation Validation & Claim Classification
      const validatedCitations: EvidenceCitationDto[] = result.rawOutput.evidenceReferences.map((ref) => {
        const sourceType = validSourceMap.get(ref.sourceId);
        if (sourceType) {
          return {
            sourceId: ref.sourceId,
            sourceType,
            claimType: ref.claimType,
            description: redactSecrets(ref.description),
            isValid: true,
          };
        }
        return {
          sourceId: ref.sourceId,
          sourceType: 'EVIDENCE',
          claimType: 'UNSUPPORTED_CLAIM',
          description: `${redactSecrets(ref.description)} [WARNING: Citation ID unverified in database]`,
          isValid: false,
        };
      });

      // 7. Postmortem Container & Immutable Versioning
      let postmortem = await prisma.postmortem.findUnique({
        where: { incidentId },
      });

      if (!postmortem) {
        postmortem = await prisma.postmortem.create({
          data: {
            organizationId,
            incidentId,
            status: PostmortemStatus.DRAFT,
          },
        });
      }

      const existingVersions = await prisma.postmortemVersion.findMany({
        where: { postmortemId: postmortem.id },
        select: { versionNumber: true },
        orderBy: { versionNumber: 'desc' },
      });

      const nextVersionNumber = (existingVersions[0]?.versionNumber || 0) + 1;

      // Reset previous isCurrent flags
      await prisma.postmortemVersion.updateMany({
        where: { postmortemId: postmortem.id },
        data: { isCurrent: false },
      });

      // Create new immutable PostmortemVersion
      const version = await prisma.postmortemVersion.create({
        data: {
          postmortemId: postmortem.id,
          organizationId,
          incidentId,
          versionNumber: nextVersionNumber,
          status: PostmortemStatus.DRAFT,
          isCurrent: true,
          aiGenerated: true,
          summary: result.rawOutput.summary,
          impact: result.rawOutput.impact,
          incidentTimeline: result.rawOutput.incidentTimeline,
          rootCause: result.rawOutput.rootCause,
          contributingFactors: result.rawOutput.contributingFactors,
          detection: result.rawOutput.detection,
          resolution: result.rawOutput.resolution,
          wentWell: result.rawOutput.wentWell,
          wentWrong: result.rawOutput.wentWrong,
          uncertainty: result.rawOutput.uncertainty || null,
          evidenceReferences: JSON.parse(JSON.stringify(validatedCitations)) as Prisma.InputJsonValue,
          correlationRunId: evidenceItems[0]?.correlationRunId || null,
          investigationRunId: investigationRun?.id || null,
          replayRunId: replayRun?.id || null,
          providerName: result.providerName,
          modelName: result.modelName,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          latencyMs: result.latencyMs,
          schemaVersion: 'v1.0',
          createdById: triggeredById || null,
        },
      });

      // Update Postmortem active version pointer
      await prisma.postmortem.update({
        where: { id: postmortem.id },
        data: { activeVersionId: version.id, status: PostmortemStatus.DRAFT },
      });

      // Create ActionItems — deduplicate by normalized title+priority before insert
      if (result.rawOutput.actionItems && result.rawOutput.actionItems.length > 0) {
        const seen = new Set<string>();
        const uniqueActionItems = result.rawOutput.actionItems.filter((ai) => {
          const key = `${ai.title.trim().toLowerCase()}::${(ai.priority || 'MEDIUM').toUpperCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        await prisma.actionItem.createMany({
          data: uniqueActionItems.map((ai) => ({
            organizationId,
            postmortemId: postmortem.id,
            postmortemVersionId: version.id,
            incidentId,
            title: ai.title,
            description: ai.description || null,
            priority: ai.priority || 'MEDIUM',
            status: 'OPEN',
            createdById: triggeredById || null,
          })),
        });
      }


      // Update PostmortemRun audit log
      await prisma.postmortemRun.update({
        where: { id: runRecord.id },
        data: {
          postmortemId: postmortem.id,
          status: 'COMPLETED',
          providerName: result.providerName,
          modelName: result.modelName,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          latencyMs: result.latencyMs,
          completedAt: new Date(),
        },
      });

      // Audit Timeline Event
      await prisma.incidentEvent.create({
        data: {
          incidentId,
          organizationId,
          userId: triggeredById || null,
          source: 'AI',
          type: 'POSTMORTEM_DRAFT_CREATED',
          message: `AI Postmortem Version v${version.versionNumber} draft generated`,
          metadata: {
            automated: true,
            postmortemRun: true,
            postmortemId: postmortem.id,
            versionId: version.id,
            versionNumber: version.versionNumber,
          },
        },
      });

      // Broadcast Socket.IO event: POSTMORTEM_GENERATION_COMPLETED
      broadcastToIncident(incidentId, 'POSTMORTEM_GENERATION_COMPLETED', {
        incidentId,
        postmortemId: postmortem.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
      });

      return {
        postmortemId: postmortem.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
      };
    } catch (err) {
      logger.error({ err, incidentId }, 'AI Postmortem generation failed');

      if (runId) {
        await prisma.postmortemRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            error: (err as Error).message,
            completedAt: new Date(),
          },
        });

        broadcastToIncident(incidentId, 'POSTMORTEM_GENERATION_FAILED', {
          incidentId,
          runId,
          error: (err as Error).message,
        });
      }

      throw err;
    } finally {
      // Safe Redis lock release
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
        // Ignore
      }
    }
  }

  public static async updatePostmortemVersion(
    organizationId: string,
    incidentId: string,
    input: UpdatePostmortemSchema,
    userId: string,
  ) {
    const postmortem = await prisma.postmortem.findFirst({
      where: { incidentId, organizationId },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    });

    if (!postmortem) {
      throw new NotFoundError('Postmortem document not found for this incident');
    }

    const currentVersion = postmortem.versions.find((v) => v.isCurrent) || postmortem.versions[0];
    // Published Immutability Protection: If active version is PUBLISHED, branch a NEW DRAFT version
    if (currentVersion.status === PostmortemStatus.PUBLISHED) {
      const nextVersionNumber = currentVersion.versionNumber + 1;

      await prisma.postmortemVersion.updateMany({
        where: { postmortemId: postmortem.id },
        data: { isCurrent: false },
      });

      const newDraftVersion = await prisma.postmortemVersion.create({
        data: {
          postmortemId: postmortem.id,
          organizationId,
          incidentId,
          versionNumber: nextVersionNumber,
          status: PostmortemStatus.DRAFT,
          isCurrent: true,
          aiGenerated: false,
          summary: input.summary ?? currentVersion.summary,
          impact: input.impact ?? currentVersion.impact,
          incidentTimeline: input.incidentTimeline ?? currentVersion.incidentTimeline,
          rootCause: input.rootCause ?? currentVersion.rootCause,
          contributingFactors: input.contributingFactors ?? currentVersion.contributingFactors,
          detection: input.detection ?? currentVersion.detection,
          resolution: input.resolution ?? currentVersion.resolution,
          wentWell: input.wentWell ?? currentVersion.wentWell,
          wentWrong: input.wentWrong ?? currentVersion.wentWrong,
          uncertainty: input.uncertainty ?? currentVersion.uncertainty,
          evidenceReferences: currentVersion.evidenceReferences as unknown as Prisma.InputJsonValue,
          createdById: userId,
        },
      });

      await prisma.postmortem.update({
        where: { id: postmortem.id },
        data: { activeVersionId: newDraftVersion.id, status: PostmortemStatus.DRAFT },
      });

      return newDraftVersion;
    }

    // Update existing un-published version
    let nextStatus: PostmortemStatus = currentVersion.status;
    let publishedAt = currentVersion.publishedAt;
    let publishedById = currentVersion.publishedById;
    let approvedById = currentVersion.approvedById;

    if (input.status) {
      nextStatus = input.status as PostmortemStatus;
      if (nextStatus === PostmortemStatus.APPROVED) {
        approvedById = userId;
      } else if (nextStatus === PostmortemStatus.PUBLISHED) {
        publishedAt = new Date();
        publishedById = userId;
      }
    } else {
      // Any content edits on IN_REVIEW or APPROVED reset status to DRAFT
      if (currentVersion.status === PostmortemStatus.IN_REVIEW || currentVersion.status === PostmortemStatus.APPROVED) {
        nextStatus = PostmortemStatus.DRAFT;
      }
    }

    const updatedVersion = await prisma.postmortemVersion.update({
      where: { id: currentVersion.id },
      data: {
        summary: input.summary ?? currentVersion.summary,
        impact: input.impact ?? currentVersion.impact,
        incidentTimeline: input.incidentTimeline ?? currentVersion.incidentTimeline,
        rootCause: input.rootCause ?? currentVersion.rootCause,
        contributingFactors: input.contributingFactors ?? currentVersion.contributingFactors,
        detection: input.detection ?? currentVersion.detection,
        resolution: input.resolution ?? currentVersion.resolution,
        wentWell: input.wentWell ?? currentVersion.wentWell,
        wentWrong: input.wentWrong ?? currentVersion.wentWrong,
        uncertainty: input.uncertainty ?? currentVersion.uncertainty,
        status: nextStatus,
        approvedById,
        publishedById,
        publishedAt,
      },
    });

    await prisma.postmortem.update({
      where: { id: postmortem.id },
      data: { status: nextStatus },
    });

    return updatedVersion;
  }

  public static async createActionItem(
    organizationId: string,
    incidentId: string,
    input: CreateActionItemSchema,
    userId: string,
  ) {
    const postmortem = await prisma.postmortem.findFirst({
      where: { incidentId, organizationId },
    });

    if (!postmortem) {
      throw new NotFoundError('Postmortem document not found for this incident');
    }

    return prisma.actionItem.create({
      data: {
        organizationId,
        postmortemId: postmortem.id,
        postmortemVersionId: postmortem.activeVersionId,
        incidentId,
        title: input.title,
        description: input.description || null,
        priority: input.priority || 'MEDIUM',
        status: 'OPEN',
        assigneeId: input.assigneeId || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        createdById: userId,
      },
    });
  }

  public static async updateActionItem(
    organizationId: string,
    actionItemId: string,
    input: UpdateActionItemSchema,
  ) {
    const actionItem = await prisma.actionItem.findFirst({
      where: { id: actionItemId, organizationId },
    });

    if (!actionItem) {
      throw new NotFoundError('Action item not found in organization');
    }

    return prisma.actionItem.update({
      where: { id: actionItemId },
      data: {
        title: input.title ?? actionItem.title,
        description: input.description ?? actionItem.description,
        priority: input.priority ?? actionItem.priority,
        status: input.status ?? actionItem.status,
        assigneeId: input.assigneeId ?? actionItem.assigneeId,
        dueDate: input.dueDate ? new Date(input.dueDate) : actionItem.dueDate,
      },
    });
  }

  public static async getPostmortem(organizationId: string, incidentId: string) {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    const postmortem = await prisma.postmortem.findFirst({
      where: { incidentId, organizationId },
      include: {
        versions: { orderBy: { versionNumber: 'desc' } },
      },
    });

    if (!postmortem) {
      return { incidentId, postmortem: null };
    }

    const activeVersion = postmortem.versions.find((v) => v.id === postmortem.activeVersionId) || postmortem.versions[0] || null;

    // Fetch action items scoped to the active version only — prevents cross-version duplication
    const actionItems = activeVersion
      ? await prisma.actionItem.findMany({
          where: {
            postmortemVersionId: activeVersion.id,
            organizationId,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    return {
      incidentId,
      postmortem: {
        ...postmortem,
        actionItems,
        activeVersion,
      },
    };
  }
}
