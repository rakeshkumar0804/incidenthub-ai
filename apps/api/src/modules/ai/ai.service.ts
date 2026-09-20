import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  InvestigationStatus,
  InvestigationConfidenceTier,
  InvestigationTriggerType,
  EvidenceSource,
  EvidenceConfidenceTier,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { redis, acquireDistributedLock, verifyLockOwnership, releaseDistributedLock } from '../../lib/redis';
import { logger } from '../../utils/logger';
import { NotFoundError, LockOwnershipLostError } from '../../utils/errors';
import { broadcastToIncident } from '../../lib/socket';
import { OpenAIInvestigationProvider } from './providers/openai.provider';
import type { AIInvestigationProvider } from './providers/aiProvider.interface';
import { aiInvestigationOutputSchema } from './ai.schema';
import { evaluateDeterministicInvestigation } from './fallback';
import { sanitizeRecursive, sanitizeString } from './sanitizer';
import type {
  AIInvestigationInput,
  PreparedEvidenceSignal,
  SupportingEvidenceItem,
  ContradictoryEvidenceItem,
  AlternativeHypothesisItem,
  RecommendedActionItem,
} from './ai.types';

export class AIService {
  private static provider: AIInvestigationProvider = new OpenAIInvestigationProvider();
  private static localInFlight = new Set<string>();

  public static setProvider(customProvider: AIInvestigationProvider): void {
    this.provider = customProvider;
  }

  public static async runInvestigation(
    organizationId: string,
    incidentId: string,
    triggeredById?: string,
    triggerType: InvestigationTriggerType = InvestigationTriggerType.MANUAL_REQUEST,
  ): Promise<{ runId: string; status: string }> {
    // 1. Process-Local In-Flight Guard (Synchronous check & add before first await)
    if (AIService.localInFlight.has(incidentId)) {
      logger.info({ incidentId }, 'AI investigation run already in progress (local in-flight guard)');
      return { runId: 'none', status: 'skipped_lock_active' };
    }
    AIService.localInFlight.add(incidentId);

    // 2. Multi-tenant Ownership Verification
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
      include: { project: true, service: true },
    });

    if (!incident) {
      AIService.localInFlight.delete(incidentId);
      throw new NotFoundError('Incident not found in organization');
    }

    // 3. Concurrency Control: Redis Lock with Ownership-Safe Heartbeat
    const lockKey = `lock:ai-investigation:${incidentId}`;
    const lockVal = crypto.randomUUID();
    const lockTtlMs = 45000;
    let renewalTimer: NodeJS.Timeout | null = null;
    let lockLost = false;
    let isRenewing = false;

    // Atomic lock acquisition: fails closed (503) in production if Redis is unavailable or throws
    const lockResult = await acquireDistributedLock(lockKey, lockVal, lockTtlMs, 'ai_investigation');
    if (!lockResult.acquired) {
      AIService.localInFlight.delete(incidentId);
      logger.info({ incidentId }, 'AI investigation run already in progress (lock active)');
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
              logger.warn({ incidentId, lockKey }, 'Redis lock ownership lost during renewal heartbeat');
            }
          })
          .catch((err) => {
            logger.warn({ err, incidentId }, 'Redis lock renewal heartbeat failed');
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
        // Redis not used (dev/local fallback); process-local guard is active and owned
        return true;
      }

      if (lockLost) {
        return false;
      }

      // 3. Perform one final compare-and-renew ownership check before committing transaction
      const isOwner = await verifyLockOwnership(lockKey, lockVal, lockTtlMs);
      if (!isOwner) {
        lockLost = true;
      }
      return isOwner;
    };


    let runId = '';

    try {
      // 4. Fetch latest successfully COMPLETED CorrelationRun metadata
      const latestCompletedCorrelationRun = await prisma.correlationRun.findFirst({
        where: {
          incidentId,
          organizationId,
          status: 'COMPLETED',
        },
        orderBy: { startedAt: 'desc' },
      });

      // 5. Create InvestigationRun audit record (RUNNING)
      const investigationRun = await prisma.investigationRun.create({
        data: {
          organizationId,
          incidentId,
          correlationRunId: latestCompletedCorrelationRun?.id || null,
          triggerType,
          status: InvestigationStatus.RUNNING,
          providerName: this.provider.name,
          modelName: 'gpt-4o',
          triggeredById: triggeredById || null,
        },
      });

      runId = investigationRun.id;

      // Broadcast Socket.IO event: INVESTIGATION_STARTED
      broadcastToIncident(incidentId, 'INVESTIGATION_STARTED', {
        incidentId,
        runId: investigationRun.id,
        startedAt: investigationRun.startedAt.toISOString(),
      });

      // 6. Evidence Query: Eligible Evidence Only
      // Eligible = NOT DISMISSED (dismissedAt is null) and NOT AI_SUGGESTED, and either MANUAL or from latestCompletedCorrelationRun
      const evidenceWhereClause: Prisma.IncidentEvidenceWhereInput = {
        incidentId,
        dismissedAt: null,
        source: { not: EvidenceSource.AI_SUGGESTED },
        ...(latestCompletedCorrelationRun
          ? {
              OR: [
                { source: EvidenceSource.MANUAL },
                {
                  source: EvidenceSource.CORRELATION_ENGINE,
                  correlationRunId: latestCompletedCorrelationRun.id,
                },
              ],
            }
          : {
              source: EvidenceSource.MANUAL,
            }),
      };

      const evidenceRecords = await prisma.incidentEvidence.findMany({
        where: evidenceWhereClause,
        orderBy: [
          { confidence: 'desc' },
          { addedAt: 'desc' },
          { id: 'asc' },
        ],
        take: 30, // Limit top 30 evidence items for token bounds
      });

      const validEvidenceMap = new Map<string, { id: string; title: string; type: string; confidence: number | null; confidenceTier: EvidenceConfidenceTier | null }>();
      const preparedEvidenceList: PreparedEvidenceSignal[] = evidenceRecords.map((e) => {
        validEvidenceMap.set(e.id, {
          id: e.id,
          title: e.title,
          type: e.type,
          confidence: e.confidence,
          confidenceTier: e.confidenceTier,
        });
        return {
          id: e.id,
          type: e.type,
          source: e.source,
          confidenceTier: e.confidenceTier,
          confidence: e.confidence,
          title: sanitizeString(e.title),
          description: e.description ? sanitizeString(e.description) : null,
          url: e.url ? sanitizeString(e.url) : null,
          reasons: (e.reasons as Record<string, boolean> | null) || null,
          scoreBreakdown: (e.scoreBreakdown as Record<string, number> | null) || null,
          metadata: e.metadata ? (sanitizeRecursive(e.metadata) as Record<string, unknown>) : null,
        };
      });

      // 7. Zero Evidence Path (No eligible evidence)
      if (preparedEvidenceList.length === 0) {
        const zeroInput: AIInvestigationInput = {
          incident: {
            id: incident.id,
            number: incident.number,
            title: sanitizeString(incident.title),
            description: incident.description ? sanitizeString(incident.description) : null,
            severity: incident.severity,
            status: incident.status,
            environment: incident.environment,
            detectedAt: incident.detectedAt.toISOString(),
            projectName: incident.project.name,
            serviceName: incident.service?.name || null,
          },
          correlationRun: null,
          evidenceList: [],
        };

        const zeroOutput = evaluateDeterministicInvestigation(zeroInput);
        aiInvestigationOutputSchema.parse(zeroOutput);

        const isOwner = await verifyAndExtendLockOwnership();
        if (!isOwner) {
          throw new LockOwnershipLostError();
        }

        const [completedRun] = await prisma.$transaction(async (tx) => {
          const updatedRun = await tx.investigationRun.update({
            where: { id: investigationRun.id },
            data: {
              status: InvestigationStatus.COMPLETED,
              confidenceTier: InvestigationConfidenceTier.UNCERTAIN,
              confidence: 0.0,
              incidentSummary: zeroOutput.incidentSummary,
              probableRootCause: zeroOutput.probableRootCause,
              supportingEvidence: zeroOutput.supportingEvidence as unknown as Prisma.InputJsonValue,
              contradictoryEvidence: zeroOutput.contradictoryEvidence as unknown as Prisma.InputJsonValue,
              alternativeHypotheses: zeroOutput.alternativeHypotheses as unknown as Prisma.InputJsonValue,
              impactAssessment: zeroOutput.impactAssessment,
              riskAssessment: zeroOutput.riskAssessment,
              recommendedActions: zeroOutput.recommendedActions as unknown as Prisma.InputJsonValue,
              uncertainty: zeroOutput.uncertainty,
              investigationLimitations: zeroOutput.investigationLimitations,
              providerName: 'deterministic-fallback',
              modelName: 'offline-zero-evidence',
              completedAt: new Date(),
            },
          });

          await tx.incidentEvent.create({
            data: {
              incidentId,
              organizationId,
              userId: triggeredById || null,
              source: 'SYSTEM',
              type: 'AI_INVESTIGATION_COMPLETED',
              message: `AI Investigation completed: ${updatedRun.probableRootCause}`,
              metadata: {
                automated: true,
                aiInvestigationRun: true,
                runId: updatedRun.id,
                confidenceTier: updatedRun.confidenceTier,
                confidence: updatedRun.confidence,
              },
            },
          });

          const isOwnerInTx = await verifyAndExtendLockOwnership();
          if (!isOwnerInTx) {
            throw new LockOwnershipLostError();
          }

          return [updatedRun];
        });

        // Broadcast Socket.IO event: INVESTIGATION_COMPLETED only after commit
        broadcastToIncident(incidentId, 'INVESTIGATION_COMPLETED', {
          incidentId,
          runId: completedRun.id,
          status: completedRun.status,
          confidenceTier: completedRun.confidenceTier,
          probableRootCause: completedRun.probableRootCause,
        });

        return { runId: completedRun.id, status: 'completed' };
      }

      // 8. Construct AI Input Contract
      const aiInput: AIInvestigationInput = {
        incident: {
          id: incident.id,
          number: incident.number,
          title: sanitizeString(incident.title),
          description: incident.description ? sanitizeString(incident.description) : null,
          severity: incident.severity,
          status: incident.status,
          environment: incident.environment,
          detectedAt: incident.detectedAt.toISOString(),
          projectName: incident.project.name,
          serviceName: incident.service?.name || null,
        },
        correlationRun: latestCompletedCorrelationRun
          ? {
              id: latestCompletedCorrelationRun.id,
              windowStart: latestCompletedCorrelationRun.windowStart.toISOString(),
              windowEnd: latestCompletedCorrelationRun.windowEnd.toISOString(),
              correlatedCount: latestCompletedCorrelationRun.correlatedCount,
              isTruncated: latestCompletedCorrelationRun.isTruncated,
            }
          : null,
        evidenceList: preparedEvidenceList,
      };

      // 9. Invoke AI Provider Layer & Revalidate Output Schema
      const result = await this.provider.investigate(aiInput);
      const rawOutput = aiInvestigationOutputSchema.parse(result.output);

      // 10. Anti-Hallucination Evidence ID Validation & Deduplication
      let invalidCount = 0;
      let totalCitedCount = 0;
      const seenSupportingIds = new Set<string>();
      const validatedSupporting: SupportingEvidenceItem[] = [];

      for (const item of rawOutput.supportingEvidence || []) {
        totalCitedCount++;
        if (validEvidenceMap.has(item.evidenceId)) {
          if (!seenSupportingIds.has(item.evidenceId)) {
            seenSupportingIds.add(item.evidenceId);
            validatedSupporting.push({
              evidenceId: item.evidenceId,
              claim: sanitizeString(item.claim),
              relevanceReason: sanitizeString(item.relevanceReason),
            });
          }
        } else {
          invalidCount++;
        }
      }

      const seenContradictoryIds = new Set<string>();
      const validatedContradictory: ContradictoryEvidenceItem[] = [];
      for (const item of rawOutput.contradictoryEvidence || []) {
        totalCitedCount++;
        if (validEvidenceMap.has(item.evidenceId)) {
          if (!seenContradictoryIds.has(item.evidenceId)) {
            seenContradictoryIds.add(item.evidenceId);
            validatedContradictory.push({
              evidenceId: item.evidenceId,
              contradiction: sanitizeString(item.contradiction),
            });
          }
        } else {
          invalidCount++;
        }
      }

      const validatedHypotheses: AlternativeHypothesisItem[] = (rawOutput.alternativeHypotheses || []).map((h) => {
        const seenHypothesisIds = new Set<string>();
        const validIds: string[] = [];
        for (const id of h.evidenceIds || []) {
          totalCitedCount++;
          if (validEvidenceMap.has(id)) {
            if (!seenHypothesisIds.has(id)) {
              seenHypothesisIds.add(id);
              validIds.push(id);
            }
          } else {
            invalidCount++;
          }
        }
        return {
          hypothesis: sanitizeString(h.hypothesis),
          likelihood: h.likelihood,
          evidenceIds: validIds,
        };
      });

      // 11. Deterministic Confidence Grounding & Tier Mapping
      let finalConfidence = Number(rawOutput.confidence);
      if (Number.isNaN(finalConfidence) || !Number.isFinite(finalConfidence)) {
        finalConfidence = 0.0;
      }
      finalConfidence = Math.max(0.0, Math.min(1.0, finalConfidence));

      const validationWarnings: string[] = [];

      // Rule A: No valid supporting citation forces confidence < 0.20 and UNCERTAIN
      if (validatedSupporting.length === 0) {
        finalConfidence = Math.min(finalConfidence, 0.19);
        validationWarnings.push('No valid supporting evidence citations were provided.');
      }

      // Rule B: More than 50% of submitted citations are invalid forces confidence < 0.20 and UNCERTAIN
      if (totalCitedCount > 0 && invalidCount / totalCitedCount > 0.5) {
        finalConfidence = Math.min(finalConfidence, 0.19);
        validationWarnings.push(
          `Over 50% of cited evidence references (${invalidCount}/${totalCitedCount}) were invalid and removed.`,
        );
      } else if (invalidCount > 0) {
        validationWarnings.push(`${invalidCount} invalid evidence citation(s) were removed.`);
      }

      // Rule C: Single supporting evidence item cannot become HIGH (max 0.79)
      if (validatedSupporting.length === 1) {
        finalConfidence = Math.min(finalConfidence, 0.79);
      }

      // Rule D: HIGH requires at least 2 distinct valid evidence IDs, 2 distinct evidence types,
      // and at least one supporting evidence item with deterministic HIGH confidence.
      const distinctSupportingIds = new Set(validatedSupporting.map((s) => s.evidenceId));
      const distinctSupportingTypes = new Set(
        validatedSupporting
          .map((s) => validEvidenceMap.get(s.evidenceId)?.type)
          .filter((t): t is string => Boolean(t)),
      );
      const hasHighConfidenceCitedEvidence = validatedSupporting.some((s) => {
        const meta = validEvidenceMap.get(s.evidenceId);
        return (meta?.confidence ?? 0) >= 0.8 || meta?.confidenceTier === EvidenceConfidenceTier.HIGH;
      });

      const qualifiesForHigh =
        distinctSupportingIds.size >= 2 &&
        distinctSupportingTypes.size >= 2 &&
        hasHighConfidenceCitedEvidence;

      if (!qualifiesForHigh) {
        finalConfidence = Math.min(finalConfidence, 0.79);
      }

      // Final Tier Mapping from Capped Numeric Confidence
      let finalTier: InvestigationConfidenceTier;
      if (finalConfidence >= 0.8) {
        finalTier = InvestigationConfidenceTier.HIGH;
      } else if (finalConfidence >= 0.5) {
        finalTier = InvestigationConfidenceTier.MEDIUM;
      } else if (finalConfidence >= 0.2) {
        finalTier = InvestigationConfidenceTier.LOW;
      } else {
        finalTier = InvestigationConfidenceTier.UNCERTAIN;
      }

      const validationErrorText = validationWarnings.length > 0 ? sanitizeString(validationWarnings.join(' ')) : null;

      const sanitizedActions: RecommendedActionItem[] = (rawOutput.recommendedActions || []).map((a) => ({
        action: sanitizeString(a.action),
        priority: a.priority,
        category: a.category,
      }));

      const sanitizedUncertainty: string[] = (rawOutput.uncertainty || []).map((u) => sanitizeString(u));

      const isOwner = await verifyAndExtendLockOwnership();
      if (!isOwner) {
        throw new LockOwnershipLostError();
      }

      // 12. Atomic Transactional Persistence
      const [completedRun] = await prisma.$transaction(async (tx) => {
        const updatedRun = await tx.investigationRun.update({
          where: { id: investigationRun.id },
          data: {
            status: InvestigationStatus.COMPLETED,
            confidenceTier: finalTier,
            confidence: finalConfidence,
            incidentSummary: sanitizeString(rawOutput.incidentSummary),
            probableRootCause: sanitizeString(rawOutput.probableRootCause),
            supportingEvidence: validatedSupporting as unknown as Prisma.InputJsonValue,
            contradictoryEvidence: validatedContradictory as unknown as Prisma.InputJsonValue,
            alternativeHypotheses: validatedHypotheses as unknown as Prisma.InputJsonValue,
            impactAssessment: sanitizeString(rawOutput.impactAssessment),
            riskAssessment: sanitizeString(rawOutput.riskAssessment),
            recommendedActions: sanitizedActions as unknown as Prisma.InputJsonValue,
            uncertainty: sanitizedUncertainty,
            investigationLimitations: sanitizeString(rawOutput.investigationLimitations),
            providerName: result.providerName,
            modelName: result.modelName,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            totalTokens: result.totalTokens,
            latencyMs: result.latencyMs,
            validationError: validationErrorText,
            completedAt: new Date(),
          },
        });

        await tx.incidentEvent.create({
          data: {
            incidentId,
            organizationId,
            userId: triggeredById || null,
            source: 'SYSTEM',
            type: 'AI_INVESTIGATION_COMPLETED',
            message: `AI Investigation completed: ${updatedRun.probableRootCause}`,
            metadata: {
              automated: true,
              aiInvestigationRun: true,
              runId: updatedRun.id,
              confidenceTier: updatedRun.confidenceTier,
              confidence: updatedRun.confidence,
            },
          },
        });

        const isOwnerInTx = await verifyAndExtendLockOwnership();
        if (!isOwnerInTx) {
          throw new LockOwnershipLostError();
        }

        return [updatedRun];
      });

      // 13. Broadcast Socket.IO Event: INVESTIGATION_COMPLETED only after transaction commits
      broadcastToIncident(incidentId, 'INVESTIGATION_COMPLETED', {
        incidentId,
        runId: completedRun.id,
        status: completedRun.status,
        confidenceTier: completedRun.confidenceTier,
        probableRootCause: completedRun.probableRootCause,
      });

      return { runId: completedRun.id, status: 'completed' };
    } catch (err) {
      const sanitizedErrMsg = sanitizeString((err as Error).message || 'AI investigation execution failed');
      logger.error({ err, incidentId }, 'AI investigation execution failed');

      if (runId) {
        await prisma.investigationRun
          .update({
            where: { id: runId },
            data: {
              status: InvestigationStatus.FAILED,
              validationError: sanitizedErrMsg,
              completedAt: new Date(),
            },
          })
          .catch(() => undefined);

        broadcastToIncident(incidentId, 'INVESTIGATION_FAILED', {
          incidentId,
          runId,
          error: sanitizedErrMsg,
        });
      }

      throw err;
    } finally {
      // 14. Safe Lock Cleanup
      if (renewalTimer) {
        clearInterval(renewalTimer);
      }
      AIService.localInFlight.delete(incidentId);

      if (redisLockAcquired) {
        await releaseDistributedLock(lockKey, lockVal);
      }

    }
  }

  public static async getLatestInvestigation(organizationId: string, incidentId: string) {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    const latestRun = await prisma.investigationRun.findFirst({
      where: { incidentId, organizationId },
      orderBy: { startedAt: 'desc' },
    });

    const latestCompletedRun = await prisma.investigationRun.findFirst({
      where: { incidentId, organizationId, status: InvestigationStatus.COMPLETED },
      orderBy: { completedAt: 'desc' },
    });

    return {
      incidentId,
      latestRun,
      latestCompletedRun: latestCompletedRun ?? null,
      isRunning: latestRun?.status === InvestigationStatus.RUNNING,
      latestFailure:
        latestRun?.status === InvestigationStatus.FAILED
          ? {
              error: latestRun.validationError,
              failedAt: latestRun.completedAt,
            }
          : null,
    };
  }

  public static async getInvestigationRuns(organizationId: string, incidentId: string) {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    return prisma.investigationRun.findMany({
      where: { incidentId, organizationId },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
      take: 20,
    });
  }
}
