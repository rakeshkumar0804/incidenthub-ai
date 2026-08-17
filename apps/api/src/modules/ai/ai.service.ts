import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  InvestigationStatus,
  InvestigationConfidenceTier,
  InvestigationTriggerType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { logger } from '../../utils/logger';
import { NotFoundError } from '../../utils/errors';
import { broadcastToIncident } from '../../lib/socket';
import { OpenAIInvestigationProvider } from './providers/openai.provider';
import type { AIInvestigationProvider } from './providers/aiProvider.interface';
import type {
  AIInvestigationInput,
  PreparedEvidenceSignal,
  SupportingEvidenceItem,
  ContradictoryEvidenceItem,
  AlternativeHypothesisItem,
} from './ai.types';

export class AIService {
  private static provider: AIInvestigationProvider = new OpenAIInvestigationProvider();

  public static setProvider(customProvider: AIInvestigationProvider): void {
    this.provider = customProvider;
  }

  public static async runInvestigation(
    organizationId: string,
    incidentId: string,
    triggeredById?: string,
    triggerType: InvestigationTriggerType = InvestigationTriggerType.MANUAL_REQUEST,
  ): Promise<{ runId: string; status: string }> {
    // 1. Multi-tenant Ownership Verification
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
      include: { project: true, service: true },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in organization');
    }

    // 2. Concurrency Control: Redis Lock (45s TTL)
    const lockKey = `lock:ai-investigation:${incidentId}`;
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
      logger.info({ incidentId }, 'AI investigation run already in progress (Redis lock active)');
      return { runId: 'none', status: 'skipped: lock active' };
    }

    let runId = '';

    try {
      // Fetch latest CorrelationRun metadata
      const latestCorrelationRun = await prisma.correlationRun.findFirst({
        where: { incidentId, organizationId },
        orderBy: { startedAt: 'desc' },
      });

      // Create InvestigationRun audit record (RUNNING)
      const investigationRun = await prisma.investigationRun.create({
        data: {
          organizationId,
          incidentId,
          correlationRunId: latestCorrelationRun?.id || null,
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

      // 3. Evidence Preparation & Secret Redaction Layer
      const evidenceRecords = await prisma.incidentEvidence.findMany({
        where: { incidentId },
        orderBy: { confidence: 'desc' },
        take: 30, // Limit top 30 evidence items for token bounds
      });

      const validEvidenceMap = new Map<string, string>();
      const preparedEvidenceList: PreparedEvidenceSignal[] = evidenceRecords.map((e) => {
        validEvidenceMap.set(e.id, e.title);
        return {
          id: e.id,
          type: e.type,
          source: e.source,
          confidenceTier: e.confidenceTier,
          confidence: e.confidence,
          title: this.redactSecrets(e.title),
          description: this.redactSecrets(e.description || ''),
          url: this.redactSecrets(e.url || ''),
          reasons: (e.reasons as Record<string, boolean> | null) || null,
          scoreBreakdown: (e.scoreBreakdown as Record<string, number> | null) || null,
          metadata: (e.metadata as Record<string, unknown> | null) || null,
        };
      });

      // 4. Zero Evidence Fallback
      if (preparedEvidenceList.length === 0) {
        const completedRun = await prisma.investigationRun.update({
          where: { id: investigationRun.id },
          data: {
            status: InvestigationStatus.COMPLETED,
            confidenceTier: InvestigationConfidenceTier.UNCERTAIN,
            confidence: 0.0,
            incidentSummary: `Incident ${incident.number} (${incident.title}) has zero correlation evidence items.`,
            probableRootCause: 'Insufficient evidence to determine root cause.',
            supportingEvidence: [],
            contradictoryEvidence: [],
            alternativeHypotheses: [
              { hypothesis: 'Telemetry unmonitored or unlinked component failure', likelihood: 'LOW', evidenceIds: [] },
            ],
            impactAssessment: `Impact reported on ${incident.project.name} (${incident.severity} in ${incident.environment}).`,
            riskAssessment: 'MEDIUM — Operational investigation required',
            recommendedActions: [
              { action: 'Run Phase 8 Correlation Engine to discover evidence signals', priority: 'HIGH', category: 'INVESTIGATION' },
            ],
            uncertainty: ['No Phase 8 evidence records found in database for this incident.'],
            investigationLimitations: 'Zero correlation signals available in database.',
            completedAt: new Date(),
          },
        });

        // Broadcast Socket.IO event: INVESTIGATION_COMPLETED
        broadcastToIncident(incidentId, 'INVESTIGATION_COMPLETED', {
          incidentId,
          runId: completedRun.id,
          status: completedRun.status,
          probableRootCause: completedRun.probableRootCause,
        });

        return { runId: completedRun.id, status: 'completed' };
      }

      // 5. Construct AI Input Contract
      const aiInput: AIInvestigationInput = {
        incident: {
          id: incident.id,
          number: incident.number,
          title: this.redactSecrets(incident.title),
          description: this.redactSecrets(incident.description || ''),
          severity: incident.severity,
          status: incident.status,
          environment: incident.environment,
          detectedAt: incident.detectedAt.toISOString(),
          projectName: incident.project.name,
          serviceName: incident.service?.name || null,
        },
        correlationRun: latestCorrelationRun
          ? {
              id: latestCorrelationRun.id,
              windowStart: latestCorrelationRun.windowStart.toISOString(),
              windowEnd: latestCorrelationRun.windowEnd.toISOString(),
              correlatedCount: latestCorrelationRun.correlatedCount,
              isTruncated: latestCorrelationRun.isTruncated,
            }
          : null,
        evidenceList: preparedEvidenceList,
      };

      // 6. Invoke AI Provider Layer
      const result = await this.provider.investigate(aiInput);
      const rawOutput = result.output;

      // 7. Anti-Hallucination Evidence ID Validation & Filtering
      let invalidCount = 0;
      let totalCitedCount = 0;

      const validatedSupporting: SupportingEvidenceItem[] = (rawOutput.supportingEvidence || []).filter((item) => {
        totalCitedCount++;
        if (validEvidenceMap.has(item.evidenceId)) {
          return true;
        }
        invalidCount++;
        return false;
      });

      const validatedContradictory: ContradictoryEvidenceItem[] = (rawOutput.contradictoryEvidence || []).filter((item) => {
        totalCitedCount++;
        if (validEvidenceMap.has(item.evidenceId)) {
          return true;
        }
        invalidCount++;
        return false;
      });

      const validatedHypotheses: AlternativeHypothesisItem[] = (rawOutput.alternativeHypotheses || []).map((h) => ({
        ...h,
        evidenceIds: (h.evidenceIds || []).filter((id) => {
          totalCitedCount++;
          if (validEvidenceMap.has(id)) {
            return true;
          }
          invalidCount++;
          return false;
        }),
      }));

      let validationError: string | null = null;
      let finalTier: InvestigationConfidenceTier = rawOutput.confidenceTier;

      if (totalCitedCount > 0 && invalidCount / totalCitedCount > 0.5) {
        validationError = `Over 50% of cited evidence IDs (${invalidCount}/${totalCitedCount}) were hallucinated/invalid and removed.`;
        finalTier = InvestigationConfidenceTier.UNCERTAIN;
      }

      // Map tier safely
      if (rawOutput.confidence >= 0.8) {
        finalTier = InvestigationConfidenceTier.HIGH;
      } else if (rawOutput.confidence >= 0.5) {
        finalTier = InvestigationConfidenceTier.MEDIUM;
      } else if (rawOutput.confidence >= 0.2) {
        finalTier = InvestigationConfidenceTier.LOW;
      } else {
        finalTier = InvestigationConfidenceTier.UNCERTAIN;
      }

      // 8. Persist Investigation Output
      const completedRun = await prisma.investigationRun.update({
        where: { id: investigationRun.id },
        data: {
          status: InvestigationStatus.COMPLETED,
          confidenceTier: finalTier,
          confidence: rawOutput.confidence,
          incidentSummary: rawOutput.incidentSummary,
          probableRootCause: rawOutput.probableRootCause,
          supportingEvidence: validatedSupporting as unknown as Prisma.InputJsonValue,
          contradictoryEvidence: validatedContradictory as unknown as Prisma.InputJsonValue,
          alternativeHypotheses: validatedHypotheses as unknown as Prisma.InputJsonValue,
          impactAssessment: rawOutput.impactAssessment,
          riskAssessment: rawOutput.riskAssessment,
          recommendedActions: rawOutput.recommendedActions as unknown as Prisma.InputJsonValue,
          uncertainty: rawOutput.uncertainty ?? null,
          investigationLimitations: rawOutput.investigationLimitations,
          providerName: result.providerName,
          modelName: result.modelName,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          latencyMs: result.latencyMs,
          validationError,
          completedAt: new Date(),
        },
      });

      // 9. Create Timeline Audit Event (Loop Prevention Flagged)
      await prisma.incidentEvent.create({
        data: {
          incidentId,
          organizationId,
          userId: triggeredById || null,
          source: 'SYSTEM',
          type: 'AI_INVESTIGATION_COMPLETED',
          message: `AI Investigation completed: ${completedRun.probableRootCause}`,
          metadata: {
            automated: true,
            aiInvestigationRun: true,
            runId: completedRun.id,
            confidenceTier: completedRun.confidenceTier,
            confidence: completedRun.confidence,
          },
        },
      });

      // 10. Broadcast Socket.IO Event: INVESTIGATION_COMPLETED
      broadcastToIncident(incidentId, 'INVESTIGATION_COMPLETED', {
        incidentId,
        runId: completedRun.id,
        status: completedRun.status,
        confidenceTier: completedRun.confidenceTier,
        probableRootCause: completedRun.probableRootCause,
      });

      return { runId: completedRun.id, status: 'completed' };
    } catch (err) {
      logger.error({ err, incidentId }, 'AI investigation execution failed');

      if (runId) {
        await prisma.investigationRun.update({
          where: { id: runId },
          data: {
            status: InvestigationStatus.FAILED,
            validationError: (err as Error).message,
            completedAt: new Date(),
          },
        });

        broadcastToIncident(incidentId, 'INVESTIGATION_FAILED', {
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

    return { incidentId, latestRun };
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
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
  }

  private static redactSecrets(text: string): string {
    if (!text) return text;
    return text
      .replace(/ghp_[a-zA-Z0-9]{36,}/g, '[REDACTED_GITHUB_TOKEN]')
      .replace(/sentry_[a-zA-Z0-9]{32,}/g, '[REDACTED_SENTRY_KEY]')
      .replace(/sk-[a-zA-Z0-9]{32,}/g, '[REDACTED_OPENAI_KEY]')
      .replace(/postgres:\/\/[^@]+@/g, 'postgres://[REDACTED_CREDS]@')
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED_JWT]');
  }
}
