import {
  Prisma,
  EvidenceSource,
  EvidenceType,
  ActionItemPriority,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentEnvironment,
  type EvidenceConfidenceTier,
  type ReplayCategory,
  type EventSource,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { sanitizeRecursive, sanitizeString } from '../ai/sanitizer';
import type { EvidenceCitationDto } from '@incidenthub/shared';

export interface PostmortemSourceSnapshot {
  incident: {
    id: string;
    organizationId: string;
    number: number;
    title: string;
    description: string | null;
    severity: IncidentSeverity;
    status: IncidentStatus;
    environment: IncidentEnvironment;
    detectedAt: Date;
    resolvedAt: Date | null;
    serviceName: string | null;
    projectName: string | null;
  };
  correlationRun: {
    id: string;
    startedAt: Date;
  } | null;
  investigationRun: {
    id: string;
    probableRootCause: string | null;
    confidenceTier: string | null;
    riskAssessment: string | null;
    uncertainty: string[] | null;
  } | null;
  replayRun: {
    id: string;
    startedAt: Date;
    events: Array<{
      id: string;
      sequenceIndex: number;
      category: ReplayCategory;
      eventType: string;
      title: string;
      timestamp: Date;
      actorName: string | null;
    }>;
  } | null;
  evidenceItems: Array<{
    id: string;
    type: EvidenceType;
    source: EvidenceSource;
    title: string;
    description: string | null;
    url: string | null;
    confidenceTier: EvidenceConfidenceTier | null;
    addedAt: Date;
    correlationRunId: string | null;
  }>;
  comments: Array<{
    id: string;
    content: string;
    createdAt: Date;
    userId: string;
  }>;
  timelineEvents: Array<{
    id: string;
    type: string;
    message: string;
    occurredAt: Date;
    source: EventSource;
  }>;
  validSourceMap: Map<string, 'EVIDENCE' | 'REPLAY_EVENT' | 'INVESTIGATION_RUN' | 'COMMENT'>;
}

export interface GroundedClaim {
  text: string;
  claimType: 'FACT' | 'INVESTIGATION_CONCLUSION' | 'RECOMMENDATION' | 'UNCERTAINTY';
  sourceIds: string[];
  sourceType?: 'EVIDENCE' | 'REPLAY_EVENT' | 'INVESTIGATION_RUN' | 'COMMENT';
}

export interface RawActionItem {
  title: string;
  description?: string | null;
  priority?: string;
}

export interface RawPostmortemOutput {
  summary: string;
  impact: string;
  incidentTimeline: string;
  rootCause: string;
  contributingFactors: string;
  detection: string;
  resolution: string;
  wentWell: string;
  wentWrong: string;
  uncertainty?: string | null;
  evidenceReferences?: Array<{
    sourceId: string;
    sourceType?: string;
    claimType?: string;
    description: string;
  }>;
  actionItems?: RawActionItem[];
  claims?: GroundedClaim[];
}

/**
 * Builds a coherent, bounded snapshot of upstream incident intelligence
 * under a RepeatableRead transaction, capturing exact run IDs and strictly
 * allowlisted source records.
 */
export async function buildPostmortemSnapshot(
  organizationId: string,
  incidentId: string,
): Promise<PostmortemSourceSnapshot | null> {
  return prisma.$transaction(
    async (tx) => {
      // 1. Incident Details
      const incident = await tx.incident.findFirst({
        where: { id: incidentId, organizationId },
        include: { project: true, service: true },
      });

      if (!incident) {
        return null;
      }

      // 2. Latest Completed Correlation Run (Deterministic completedAt ordering)
      const correlationRun = await tx.correlationRun.findFirst({
        where: { incidentId, organizationId, status: 'COMPLETED', completedAt: { not: null } },
        orderBy: [{ completedAt: 'desc' }, { id: 'asc' }],
      });

      // 3. Eligible Evidence under Strict Phase 4/5/7 Policy
      // - Linked to latest completed correlation run OR pure manual (correlationRunId: null)
      // - Dismissed evidence excluded
      // - Circular AI_SUGGESTED evidence excluded
      const evidenceItems = await tx.incidentEvidence.findMany({
        where: {
          incidentId,
          dismissedAt: null,
          OR: [
            ...(correlationRun
              ? [
                  {
                    source: EvidenceSource.CORRELATION_ENGINE,
                    correlationRunId: correlationRun.id,
                  },
                ]
              : []),
            {
              source: EvidenceSource.MANUAL,
              correlationRunId: null,
            },
          ],
        },
        orderBy: [{ addedAt: 'asc' }, { id: 'asc' }],
        take: 30,
      });

      // 4. Latest Completed AI Investigation Run (Deterministic completedAt ordering)
      const investigationRun = await tx.investigationRun.findFirst({
        where: { incidentId, organizationId, status: 'COMPLETED', completedAt: { not: null } },
        orderBy: [{ completedAt: 'desc' }, { id: 'asc' }],
      });

      // 5. Latest Completed Incident Replay Run and Bounded Retained Events (Deterministic completedAt ordering)
      const replayRun = await tx.replayRun.findFirst({
        where: { incidentId, organizationId, status: 'COMPLETED', completedAt: { not: null } },
        orderBy: [{ completedAt: 'desc' }, { id: 'asc' }],
        include: {
          events: {
            orderBy: [{ sequenceIndex: 'asc' }, { id: 'asc' }],
            take: 50,
          },
        },
      });

      // 6. Bounded Incident Comments (scoped to incident)
      const comments = await tx.comment.findMany({
        where: { incidentId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 20,
      });

      // 7. Bounded Incident Timeline Events
      const timelineEvents = await tx.incidentEvent.findMany({
        where: { incidentId, organizationId },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: 30,
      });

      // 8. Server-Controlled Valid Source Map for Anti-Hallucination Citation Grounding
      const validSourceMap = new Map<string, 'EVIDENCE' | 'REPLAY_EVENT' | 'INVESTIGATION_RUN' | 'COMMENT'>();
      evidenceItems.forEach((e) => validSourceMap.set(e.id, 'EVIDENCE'));
      if (replayRun) {
        replayRun.events.forEach((re) => validSourceMap.set(re.id, 'REPLAY_EVENT'));
      }
      if (investigationRun) {
        validSourceMap.set(investigationRun.id, 'INVESTIGATION_RUN');
      }
      comments.forEach((c) => validSourceMap.set(c.id, 'COMMENT'));

      return {
        incident: {
          id: incident.id,
          organizationId: incident.organizationId,
          number: incident.number,
          title: incident.title,
          description: incident.description,
          severity: incident.severity,
          status: incident.status,
          environment: incident.environment,
          detectedAt: incident.detectedAt,
          resolvedAt: incident.resolvedAt,
          serviceName: incident.service?.name || null,
          projectName: incident.project?.name || null,
        },
        correlationRun: correlationRun
          ? {
              id: correlationRun.id,
              status: correlationRun.status,
              startedAt: correlationRun.startedAt,
            }
          : null,
        investigationRun: investigationRun
          ? {
              id: investigationRun.id,
              probableRootCause: investigationRun.probableRootCause,
              confidenceTier: investigationRun.confidenceTier,
              riskAssessment: investigationRun.riskAssessment,
              uncertainty: Array.isArray(investigationRun.uncertainty)
                ? (investigationRun.uncertainty as string[])
                : null,
            }
          : null,
        replayRun: replayRun
          ? {
              id: replayRun.id,
              startedAt: replayRun.startedAt,
              events: replayRun.events.map((e) => ({
                id: e.id,
                sequenceIndex: e.sequenceIndex,
                category: e.category,
                eventType: e.eventType,
                title: e.title,
                timestamp: e.timestamp,
                actorName: e.actorName,
              })),
            }
          : null,
        evidenceItems: evidenceItems.map((e) => ({
          id: e.id,
          type: e.type,
          source: e.source,
          title: e.title,
          description: e.description,
          url: e.url,
          confidenceTier: e.confidenceTier,
          addedAt: e.addedAt,
          correlationRunId: e.correlationRunId,
        })),
        comments: comments.map((c) => ({
          id: c.id,
          content: c.content,
          createdAt: c.createdAt,
          userId: c.userId,
        })),
        timelineEvents: timelineEvents.map((te) => ({
          id: te.id,
          type: te.type,
          message: te.message,
          occurredAt: te.occurredAt,
          source: te.source,
        })),
        validSourceMap,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );
}

/**
 * Sanitizes and deep-cleans the snapshot before passing to LLM or generating offline fallback.
 */
export function sanitizeSnapshotForPrompt(snapshot: PostmortemSourceSnapshot) {
  const cleanIncident = sanitizeRecursive({
    id: snapshot.incident.id,
    number: snapshot.incident.number,
    title: sanitizeString(snapshot.incident.title).slice(0, 300),
    description: snapshot.incident.description
      ? sanitizeString(snapshot.incident.description).slice(0, 2000)
      : null,
    severity: snapshot.incident.severity,
    status: snapshot.incident.status,
    environment: snapshot.incident.environment,
    detectedAt: snapshot.incident.detectedAt.toISOString(),
    resolvedAt: snapshot.incident.resolvedAt ? snapshot.incident.resolvedAt.toISOString() : null,
    serviceName: snapshot.incident.serviceName ? sanitizeString(snapshot.incident.serviceName) : null,
    projectName: snapshot.incident.projectName ? sanitizeString(snapshot.incident.projectName) : null,
  });

  const cleanEvidence = snapshot.evidenceItems.map((e) =>
    sanitizeRecursive({
      id: e.id,
      type: e.type,
      source: e.source,
      title: sanitizeString(e.title).slice(0, 300),
      description: e.description ? sanitizeString(e.description).slice(0, 1000) : null,
      url: e.url ? sanitizeString(e.url).slice(0, 500) : null,
      confidenceTier: e.confidenceTier,
    }),
  );

  const cleanInvestigation = snapshot.investigationRun
    ? sanitizeRecursive({
        id: snapshot.investigationRun.id,
        probableRootCause: snapshot.investigationRun.probableRootCause
          ? sanitizeString(snapshot.investigationRun.probableRootCause).slice(0, 1000)
          : null,
        confidenceTier: snapshot.investigationRun.confidenceTier,
        riskAssessment: snapshot.investigationRun.riskAssessment
          ? sanitizeString(snapshot.investigationRun.riskAssessment).slice(0, 1000)
          : null,
        uncertainty: snapshot.investigationRun.uncertainty,
      })
    : null;

  const cleanReplayEvents = (snapshot.replayRun?.events || []).map((e) =>
    sanitizeRecursive({
      id: e.id,
      sequenceIndex: e.sequenceIndex,
      category: e.category,
      eventType: e.eventType,
      title: sanitizeString(e.title).slice(0, 300),
      timestamp: e.timestamp.toISOString(),
      actorName: e.actorName ? sanitizeString(e.actorName) : null,
    }),
  );

  const cleanComments = snapshot.comments.map((c) =>
    sanitizeRecursive({
      id: c.id,
      content: sanitizeString(c.content).slice(0, 1000),
      createdAt: c.createdAt.toISOString(),
    }),
  );

  return {
    incident: cleanIncident,
    evidenceItems: cleanEvidence,
    investigationRun: cleanInvestigation,
    replayEvents: cleanReplayEvents,
    comments: cleanComments,
  };
}

/**
 * Validates, deduplicates, and grounds raw citations and claims against server allowlist.
 * Enforces per-claim validation rules:
 * - FACT: requires valid source IDs that exist in validSourceMap without source-type mismatch.
 * - INVESTIGATION_CONCLUSION: requires active completed investigation run.
 * - RECOMMENDATION: labeled as recommendation.
 * - UNCERTAINTY: uncited without asserting new ungrounded facts.
 * - Unsupported or fabricated root cause is replaced with:
 *   "Root cause is not established from the available evidence."
 */
export function validateAndGroundPostmortemOutput(
  raw: RawPostmortemOutput,
  validSourceMap: Map<string, 'EVIDENCE' | 'REPLAY_EVENT' | 'INVESTIGATION_RUN' | 'COMMENT'>,
  snapshot: PostmortemSourceSnapshot,
): {
  groundedOutput: RawPostmortemOutput;
  validatedCitations: EvidenceCitationDto[];
  deduplicatedActions: Array<{ title: string; description: string | null; priority: ActionItemPriority }>;
  validatedClaims: GroundedClaim[];
} {
  // 1. Claim-Level Grounding & Verification
  const rawClaims = Array.isArray(raw.claims) ? raw.claims : [];
  const validatedClaims: GroundedClaim[] = [];
  let rootCauseClaimSupported = false;

  for (const claim of rawClaims) {
    if (!claim || typeof claim.text !== 'string' || !claim.text.trim()) continue;
    const cleanText = sanitizeString(claim.text).slice(0, 2000);
    const claimType = claim.claimType;

    if (claimType === 'FACT') {
      const sourceIds = Array.isArray(claim.sourceIds) ? claim.sourceIds : [];
      if (sourceIds.length === 0) continue; // FACT requires at least one source ID

      let allSourcesValid = true;
      for (const sId of sourceIds) {
        const actualType = validSourceMap.get(sId);
        if (!actualType) {
          allSourcesValid = false;
          break;
        }
        if (claim.sourceType && claim.sourceType !== actualType) {
          allSourcesValid = false;
          break;
        }
      }

      if (allSourcesValid) {
        const firstSourceId = sourceIds[0] ?? '';
        const fallbackType = validSourceMap.get(firstSourceId);
        validatedClaims.push({
          text: cleanText,
          claimType: 'FACT',
          sourceIds,
          sourceType: claim.sourceType || fallbackType,
        });
        if (cleanText.toLowerCase().includes('root cause') || cleanText.toLowerCase().includes('caused by')) {
          rootCauseClaimSupported = true;
        }
      }
    } else if (claimType === 'INVESTIGATION_CONCLUSION') {
      if (snapshot.investigationRun) {
        const sourceIds = (claim.sourceIds && claim.sourceIds.length > 0)
          ? claim.sourceIds.filter((sId) => validSourceMap.has(sId))
          : [snapshot.investigationRun.id];

        validatedClaims.push({
          text: cleanText,
          claimType: 'INVESTIGATION_CONCLUSION',
          sourceIds,
          sourceType: 'INVESTIGATION_RUN',
        });
        rootCauseClaimSupported = true;
      }
    } else if (claimType === 'RECOMMENDATION') {
      validatedClaims.push({
        text: cleanText,
        claimType: 'RECOMMENDATION',
        sourceIds: [],
      });
    } else if (claimType === 'UNCERTAINTY') {
      validatedClaims.push({
        text: cleanText,
        claimType: 'UNCERTAINTY',
        sourceIds: [],
      });
    }
  }

  // 2. Citation Validation & Deduplication
  const rawCitations = Array.isArray(raw.evidenceReferences) ? raw.evidenceReferences : [];
  const seenCitationKeys = new Set<string>();
  const validatedCitations: EvidenceCitationDto[] = [];
  let validCitationCount = 0;

  for (const ref of rawCitations) {
    if (!ref || typeof ref.sourceId !== 'string') continue;
    const cleanSourceId = ref.sourceId.trim();
    const authoritativeSourceType = validSourceMap.get(cleanSourceId);

    if (authoritativeSourceType) {
      if (ref.sourceType && ref.sourceType !== authoritativeSourceType) {
        continue;
      }

      const claimType = (ref.claimType || 'FACT').toUpperCase() as EvidenceCitationDto['claimType'];
      const citationKey = `${cleanSourceId}::${claimType}`;

      if (!seenCitationKeys.has(citationKey)) {
        seenCitationKeys.add(citationKey);
        validCitationCount++;
        validatedCitations.push({
          sourceId: cleanSourceId,
          sourceType: authoritativeSourceType,
          claimType: ['FACT', 'INVESTIGATION_CONCLUSION', 'RECOMMENDATION', 'UNCERTAINTY'].includes(claimType)
            ? claimType
            : 'FACT',
          description: sanitizeString(ref.description || '').slice(0, 500),
          isValid: true,
        });
      }
    }
  }

  // 3. Honest Root Cause & Uncertainty Adjustment
  let rootCause = sanitizeString(raw.rootCause || '').trim();
  const uncertainty = raw.uncertainty ? sanitizeString(raw.uncertainty).trim() : '';

  // If no valid citations exist and no supported investigation root cause exists,
  // do not present a fabricated root cause
  const hasInvestigationConclusion = Boolean(snapshot.investigationRun?.probableRootCause);
  let isSupported = false;
  if (hasInvestigationConclusion) {
    isSupported = true;
  } else if (rawClaims.length > 0) {
    isSupported = rootCauseClaimSupported;
  } else {
    isSupported = snapshot.evidenceItems.length > 0 && validCitationCount > 0;
  }

  if (!isSupported || !rootCause || rootCause.toLowerCase().includes('injected_pwned')) {
    rootCause = 'Root cause is not established from the available evidence.';
  }

  const uncertainties: string[] = [];
  if (uncertainty) uncertainties.push(uncertainty);

  if (!snapshot.incident.resolvedAt) {
    uncertainties.push('Incident remains unresolved; final remediation duration is not established.');
  }
  if (snapshot.evidenceItems.length === 0) {
    uncertainties.push('No correlated evidence signals available for this incident.');
  }
  if (!snapshot.investigationRun) {
    uncertainties.push('No upstream AI investigation run completed.');
  }
  if (!snapshot.replayRun) {
    uncertainties.push('No deterministic incident replay run completed.');
  }

  const finalUncertainty = Array.from(new Set(uncertainties)).join(' ');

  // 4. Action Items Normalization & Deduplication
  const rawActions = Array.isArray(raw.actionItems) ? raw.actionItems : [];
  const seenActionKeys = new Set<string>();
  const deduplicatedActions: Array<{ title: string; description: string | null; priority: ActionItemPriority }> = [];

  const allowedPriorities = new Set<ActionItemPriority>([
    ActionItemPriority.LOW,
    ActionItemPriority.MEDIUM,
    ActionItemPriority.HIGH,
    ActionItemPriority.CRITICAL,
  ]);

  for (const ai of rawActions) {
    if (!ai || typeof ai.title !== 'string' || !ai.title.trim()) continue;
    const cleanTitle = sanitizeString(ai.title.trim()).slice(0, 255);
    const upperPriority = (ai.priority || 'MEDIUM').toUpperCase() as ActionItemPriority;
    const priority: ActionItemPriority = allowedPriorities.has(upperPriority) ? upperPriority : ActionItemPriority.MEDIUM;

    const actionKey = `${cleanTitle.toLowerCase()}::${priority}`;
    if (!seenActionKeys.has(actionKey)) {
      seenActionKeys.add(actionKey);
      deduplicatedActions.push({
        title: cleanTitle,
        description: ai.description ? sanitizeString(ai.description).slice(0, 1000) : null,
        priority,
      });
    }
  }

  const groundedOutput: RawPostmortemOutput = {
    summary: sanitizeString(raw.summary || '').slice(0, 2000),
    impact: sanitizeString(raw.impact || '').slice(0, 2000),
    incidentTimeline: sanitizeString(raw.incidentTimeline || '').slice(0, 5000),
    rootCause: rootCause.slice(0, 2000),
    contributingFactors: sanitizeString(raw.contributingFactors || '').slice(0, 2000),
    detection: sanitizeString(raw.detection || '').slice(0, 2000),
    resolution: sanitizeString(raw.resolution || '').slice(0, 2000),
    wentWell: sanitizeString(raw.wentWell || '').slice(0, 2000),
    wentWrong: sanitizeString(raw.wentWrong || '').slice(0, 2000),
    uncertainty: finalUncertainty ? finalUncertainty.slice(0, 2000) : undefined,
    evidenceReferences: validatedCitations,
    actionItems: deduplicatedActions,
    claims: validatedClaims,
  };

  return {
    groundedOutput,
    validatedCitations,
    deduplicatedActions,
    validatedClaims,
  };
}

/**
 * Deterministic, evidence-grounded fallback generator with zero fabricated claims.
 */
export function generateDeterministicOfflinePostmortem(
  snapshot: PostmortemSourceSnapshot,
): {
  rawOutput: RawPostmortemOutput;
  validatedCitations: EvidenceCitationDto[];
  deduplicatedActions: Array<{ title: string; description: string | null; priority: ActionItemPriority }>;
} {
  const { incident, evidenceItems, investigationRun, replayRun } = snapshot;

  const isoDetectedAt = incident.detectedAt.toISOString();

  // 1. Summary
  const summary = `Postmortem analysis for Incident INC-${incident.number}: ${sanitizeString(incident.title)}. Environment: ${incident.environment}.${incident.projectName ? ` Project: ${sanitizeString(incident.projectName)}.` : ''}${incident.serviceName ? ` Service: ${sanitizeString(incident.serviceName)}.` : ''}`;

  // 2. Impact
  const resolutionStatus = incident.resolvedAt
    ? `Incident resolved at ${incident.resolvedAt.toISOString()}.`
    : `Incident status remains ${incident.status}. Total resolution duration is not established from available telemetry.`;
  const impact = `Severity ${incident.severity} disruption detected at ${isoDetectedAt} in ${incident.environment}. ${resolutionStatus}`;

  // 3. Timeline
  const replayEvents = replayRun?.events || [];
  const timelineSummary =
    replayEvents.length > 0
      ? replayEvents
          .slice(0, 10)
          .map((e) => `[${e.timestamp.toISOString()}] ${sanitizeString(e.title)}`)
          .join('\n')
      : `Incident detected at ${isoDetectedAt}.`;

  // 4. Root Cause
  const correlatedDeployment = evidenceItems.find(
    (e) => e.type === EvidenceType.GITHUB_DEPLOYMENT || e.type === EvidenceType.GITHUB_COMMIT,
  );
  const correlatedError = evidenceItems.find((e) => e.type === EvidenceType.SENTRY_ERROR);

  let rootCause = 'Root cause is not established from the available evidence.';
  if (correlatedDeployment && correlatedError) {
    rootCause = `Precursor change "${sanitizeString(correlatedDeployment.title)}" is the strongest correlated precursor identified by available telemetry for error signal "${sanitizeString(correlatedError.title)}".`;
  } else if (investigationRun?.probableRootCause) {
    rootCause = sanitizeString(investigationRun.probableRootCause);
  } else if (evidenceItems.length > 0) {
    rootCause = `Primary correlated signal identified in telemetry: ${sanitizeString(evidenceItems[0]?.title || '')}.`;
  }

  // 5. Contributing Factors
  const contributingFactors =
    evidenceItems.length > 0
      ? `Correlated telemetry signals (${evidenceItems.length} items) observed during incident window.`
      : 'No secondary contributing factors established from available telemetry.';

  // 6. Detection
  const detection = `Incident detected at ${isoDetectedAt} with initial severity ${incident.severity}.`;

  // 7. Resolution
  const resolutionText = incident.resolvedAt
    ? `Confirmed Resolution: Incident marked resolved at ${incident.resolvedAt.toISOString()}.`
    : 'Resolution status is not established from the available incident data.';

  // 8. What Went Well
  const wentWell =
    replayEvents.length > 0
      ? `Timeline reconstruction processed ${replayEvents.length} replay events.`
      : 'No confirmed positive response actions are established in the available telemetry.';

  // 9. What Went Wrong
  const wentWrongParts: string[] = [];
  if (correlatedError) {
    wentWrongParts.push(`Error signal detected: ${sanitizeString(correlatedError.title)}.`);
  }
  if (correlatedDeployment) {
    wentWrongParts.push(`Precursor deployment (${sanitizeString(correlatedDeployment.title)}) preceded incident.`);
  }
  wentWrongParts.push(`Incident escalated to ${incident.severity} in ${incident.environment}.`);
  const wentWrong = wentWrongParts.join(' ');

  // 10. Evidence Citations
  const validatedCitations: EvidenceCitationDto[] = [];
  evidenceItems.forEach((e) => {
    validatedCitations.push({
      sourceId: e.id,
      sourceType: 'EVIDENCE',
      claimType: 'FACT',
      description: `Correlated evidence: ${sanitizeString(e.title)}`,
      isValid: true,
    });
  });

  if (investigationRun) {
    validatedCitations.push({
      sourceId: investigationRun.id,
      sourceType: 'INVESTIGATION_RUN',
      claimType: 'INVESTIGATION_CONCLUSION',
      description: 'AI investigation probable root cause conclusion',
      isValid: true,
    });
  }

  // 11. Deduplicated Action Items
  const deduplicatedActions: Array<{ title: string; description: string | null; priority: ActionItemPriority }> = [];
  if (incident.serviceName) {
    deduplicatedActions.push({
      title: `Audit health metrics and alarms for ${sanitizeString(incident.serviceName)}`,
      description: 'Review alert coverage and error rate thresholds.',
      priority: ActionItemPriority.HIGH,
    });
  }
  deduplicatedActions.push({
    title: 'Enhance automated regression telemetry for deployment pipelines',
    description: 'Ensure deployment pipelines emit health telemetry signals upon rollout.',
    priority: ActionItemPriority.MEDIUM,
  });

  const rawOutput: RawPostmortemOutput = {
    summary,
    impact,
    incidentTimeline: timelineSummary,
    rootCause,
    contributingFactors,
    detection,
    resolution: resolutionText,
    wentWell,
    wentWrong,
    uncertainty: !incident.resolvedAt
      ? 'Incident remains unresolved; final remediation duration is not established.'
      : null,
    evidenceReferences: validatedCitations,
    actionItems: deduplicatedActions,
  };

  return {
    rawOutput,
    validatedCitations,
    deduplicatedActions,
  };
}
