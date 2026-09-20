import { EvidenceConfidenceTier, EvidenceType } from '@prisma/client';
import type {
  CandidateSignal,
  CandidateScoreResult,
  IncidentScoringContext,
  ExplicitProviderRelationships,
  NormalizedEnvironment,
  TemporalRelation,
} from './correlation.types';

export const SCORING_CONSTANTS = {
  // Service weights
  SERVICE_EXACT_MATCH: 0.25,
  SERVICE_NO_MATCH: 0.0,

  // Environment weights
  ENV_EXACT_MATCH: 0.15,
  ENV_STAGING_ON_PROD: 0.05,
  ENV_NEUTRAL: 0.0,

  // Temporal weights
  PRECURSOR_TIME_DECAY_MAX: 0.20,
  POST_INCIDENT_TIME_DECAY_MAX: 0.08,

  // Relationship & Signal boosts
  PRECURSOR_DEPLOYMENT_BOOST: 0.25,
  COMMIT_EXACT_DEPLOYMENT_BOOST: 0.25,
  PR_EXACT_COMMIT_BOOST: 0.15,
  WORKFLOW_EXACT_COMMIT_FAILURE_BOOST: 0.25,
  WORKFLOW_GENERIC_FAILURE_BOOST: 0.10,
  SENTRY_SPIKE_BOOST: 0.25,
  SENTRY_EXACT_RELEASE_BOOST: 0.15,
} as const;

export const CORRELATION_THRESHOLDS = {
  TIER_HIGH: 0.80,
  TIER_MEDIUM: 0.50,
  TIER_LOW: 0.20,
  DISCARD_NOISE: 0.15,
  TEMPORAL_PROXIMITY_MINUTES: 60,
  PRECURSOR_WINDOW_MINUTES: 180, // 3 hours
  POST_INCIDENT_WINDOW_MINUTES: 120, // 2 hours
  SENTRY_SPIKE_MIN_USERS: 5,
  SENTRY_SPIKE_MIN_EVENTS: 20,
} as const;

export function normalizeEnvironment(envStr: string | null | undefined): NormalizedEnvironment {
  if (!envStr) return 'UNKNOWN';
  const clean = envStr.trim().toLowerCase();
  if (['prod', 'production', 'prd', 'live'].includes(clean)) return 'PRODUCTION';
  if (['stage', 'staging', 'stg', 'uat'].includes(clean)) return 'STAGING';
  if (['dev', 'development', 'local', 'test'].includes(clean)) return 'DEVELOPMENT';
  return 'UNKNOWN';
}

export function scoreCandidate(
  candidate: CandidateSignal,
  incident: IncidentScoringContext,
  relationships: ExplicitProviderRelationships,
): CandidateScoreResult {
  const deltaMs = candidate.occurredAt.getTime() - incident.detectedAt.getTime();
  const minutesFromDetection = Math.round((deltaMs / (60 * 1000)) * 100) / 100;
  const isPrecursor = candidate.occurredAt.getTime() <= incident.detectedAt.getTime();
  const temporalRelation: TemporalRelation = isPrecursor ? 'PRECURSOR' : 'POST_INCIDENT';
  const isTemporalProximity = Math.abs(minutesFromDetection) <= CORRELATION_THRESHOLDS.TEMPORAL_PROXIMITY_MINUTES;

  // 1. Temporal Decay Score (Directional)
  let tempScore = 0.0;
  if (isPrecursor) {
    const minsBefore = (incident.detectedAt.getTime() - candidate.occurredAt.getTime()) / (60 * 1000);
    tempScore = Math.max(0, 1.0 - minsBefore / CORRELATION_THRESHOLDS.PRECURSOR_WINDOW_MINUTES) * SCORING_CONSTANTS.PRECURSOR_TIME_DECAY_MAX;
  } else {
    const minsAfter = (candidate.occurredAt.getTime() - incident.detectedAt.getTime()) / (60 * 1000);
    tempScore = Math.max(0, 1.0 - minsAfter / CORRELATION_THRESHOLDS.POST_INCIDENT_WINDOW_MINUTES) * SCORING_CONSTANTS.POST_INCIDENT_TIME_DECAY_MAX;
  }

  // 2. Project & Service Match
  const isProjectMatch = true; // All ingested candidates belong to organization & project
  const isServiceMatch = Boolean(incident.serviceId && candidate.serviceId === incident.serviceId);
  const serviceScore = isServiceMatch ? SCORING_CONSTANTS.SERVICE_EXACT_MATCH : SCORING_CONSTANTS.SERVICE_NO_MATCH;

  // 3. Environment Match (Environment-neutral if UNKNOWN)
  let candEnv = normalizeEnvironment(candidate.environment);
  // If candidate is a commit/PR and has linked deployment, inherit deployment environment
  if (candEnv === 'UNKNOWN' && candidate.type === EvidenceType.GITHUB_COMMIT) {
    const sha = typeof candidate.metadata['sha'] === 'string' ? candidate.metadata['sha'] : '';
    if (sha && relationships.anchorDeploymentEnvs.has(sha)) {
      candEnv = normalizeEnvironment(relationships.anchorDeploymentEnvs.get(sha));
    }
  }

  const incEnv = normalizeEnvironment(incident.environment);
  let envScore: number = SCORING_CONSTANTS.ENV_NEUTRAL;
  let isEnvMatch = false;

  if (candEnv !== 'UNKNOWN') {
    if (candEnv === incEnv) {
      envScore = SCORING_CONSTANTS.ENV_EXACT_MATCH;
      isEnvMatch = true;
    } else if (candEnv === 'STAGING' && incEnv === 'PRODUCTION') {
      envScore = SCORING_CONSTANTS.ENV_STAGING_ON_PROD;
      isEnvMatch = false;
    }
  }

  // 4. Signal-Specific & Explicit Relationship Boosts
  let precursorDeploymentScore = 0.0;
  let commitPropBoost = 0.0;
  let prPropBoost = 0.0;
  let workflowFailureScore = 0.0;
  let sentrySpikeScore = 0.0;
  let sentryReleaseScore = 0.0;

  let isDeploymentRelation = false;
  let isCommitRelation = false;
  let isSentrySpike = false;
  let isWorkflowFailure = false;

  if (candidate.type === EvidenceType.GITHUB_DEPLOYMENT) {
    isDeploymentRelation = true;
    if (isPrecursor && isTemporalProximity) {
      precursorDeploymentScore = SCORING_CONSTANTS.PRECURSOR_DEPLOYMENT_BOOST;
    }
  } else if (candidate.type === EvidenceType.GITHUB_COMMIT) {
    const sha = typeof candidate.metadata['sha'] === 'string' ? candidate.metadata['sha'] : '';
    if (sha && relationships.anchorDeploymentCommitShas.has(sha)) {
      commitPropBoost = SCORING_CONSTANTS.COMMIT_EXACT_DEPLOYMENT_BOOST;
      isCommitRelation = true;
      isDeploymentRelation = true;
    }
  } else if (candidate.type === EvidenceType.GITHUB_PR) {
    const state = typeof candidate.metadata['state'] === 'string' ? candidate.metadata['state'] : '';
    const mergeSha = typeof candidate.metadata['mergeCommitSha'] === 'string' ? candidate.metadata['mergeCommitSha'] : '';
    const headSha = typeof candidate.metadata['headCommitSha'] === 'string' ? candidate.metadata['headCommitSha'] : '';
    const isMerged = state === 'merged' || Boolean(candidate.metadata['mergedAt']);

    if (
      isMerged &&
      ((mergeSha && (relationships.anchorDeploymentCommitShas.has(mergeSha) || relationships.correlatedCommitShas.has(mergeSha))) ||
        (headSha && (relationships.anchorDeploymentCommitShas.has(headSha) || relationships.correlatedCommitShas.has(headSha))))
    ) {
      prPropBoost = SCORING_CONSTANTS.PR_EXACT_COMMIT_BOOST;
      isCommitRelation = true;
      isDeploymentRelation = true;
    }
  } else if (candidate.type === EvidenceType.GITHUB_WORKFLOW_RUN) {
    const conclusion = typeof candidate.metadata['conclusion'] === 'string' ? candidate.metadata['conclusion'] : '';
    const status = typeof candidate.metadata['status'] === 'string' ? candidate.metadata['status'] : '';
    const commitSha = typeof candidate.metadata['commitSha'] === 'string' ? candidate.metadata['commitSha'] : '';
    const isFailed = conclusion === 'failure' || status === 'failure';

    if (isFailed) {
      isWorkflowFailure = true;
      if (commitSha && (relationships.anchorDeploymentCommitShas.has(commitSha) || relationships.correlatedCommitShas.has(commitSha))) {
        workflowFailureScore = SCORING_CONSTANTS.WORKFLOW_EXACT_COMMIT_FAILURE_BOOST;
        isCommitRelation = true;
      } else {
        workflowFailureScore = SCORING_CONSTANTS.WORKFLOW_GENERIC_FAILURE_BOOST;
      }
    }
  } else if (candidate.type === EvidenceType.SENTRY_ERROR) {
    const userCount = typeof candidate.metadata['userCount'] === 'number' ? candidate.metadata['userCount'] : 0;
    const eventCount = typeof candidate.metadata['eventCount'] === 'number' ? candidate.metadata['eventCount'] : 0;
    const level = typeof candidate.metadata['level'] === 'string' ? candidate.metadata['level'] : '';
    const release = typeof candidate.metadata['release'] === 'string' ? candidate.metadata['release'] : '';

    if (userCount >= CORRELATION_THRESHOLDS.SENTRY_SPIKE_MIN_USERS || eventCount >= CORRELATION_THRESHOLDS.SENTRY_SPIKE_MIN_EVENTS || level === 'fatal') {
      isSentrySpike = true;
      sentrySpikeScore = SCORING_CONSTANTS.SENTRY_SPIKE_BOOST;
    }

    if (release) {
      const normRelease = release.trim().toLowerCase();
      const matchesAnchorCommit = Array.from(relationships.anchorDeploymentCommitShas).some(
        (sha) => sha.toLowerCase() === normRelease || sha.toLowerCase().startsWith(normRelease) || normRelease.startsWith(sha.toLowerCase()),
      );
      if (matchesAnchorCommit || relationships.anchorDeploymentIds.has(release)) {
        sentryReleaseScore = SCORING_CONSTANTS.SENTRY_EXACT_RELEASE_BOOST;
        isDeploymentRelation = true;
      }
    }
  }

  // 5. Build Score Breakdown & Strict Sum
  const scoreBreakdown: Record<string, number> = {};
  if (serviceScore > 0) scoreBreakdown['serviceScore'] = serviceScore;
  if (envScore > 0) scoreBreakdown['envScore'] = envScore;
  if (tempScore > 0) scoreBreakdown['tempScore'] = tempScore;
  if (precursorDeploymentScore > 0) scoreBreakdown['precursorDeploymentScore'] = precursorDeploymentScore;
  if (commitPropBoost > 0) scoreBreakdown['commitPropBoost'] = commitPropBoost;
  if (prPropBoost > 0) scoreBreakdown['prPropBoost'] = prPropBoost;
  if (workflowFailureScore > 0) scoreBreakdown['workflowFailureScore'] = workflowFailureScore;
  if (sentrySpikeScore > 0) scoreBreakdown['sentrySpikeScore'] = sentrySpikeScore;
  if (sentryReleaseScore > 0) scoreBreakdown['sentryReleaseScore'] = sentryReleaseScore;

  const finalRawScore = Object.values(scoreBreakdown).reduce((sum, val) => sum + val, 0);
  const confidence = Math.max(0.0, Math.min(1.0, Math.round(finalRawScore * 1000) / 1000));

  let confidenceTier: EvidenceConfidenceTier = EvidenceConfidenceTier.LOW;
  if (confidence >= CORRELATION_THRESHOLDS.TIER_HIGH) {
    confidenceTier = EvidenceConfidenceTier.HIGH;
  } else if (confidence >= CORRELATION_THRESHOLDS.TIER_MEDIUM) {
    confidenceTier = EvidenceConfidenceTier.MEDIUM;
  }

  const baseScore = (serviceScore > 0 ? serviceScore : 0) + (envScore > 0 ? envScore : 0) + tempScore;

  return {
    candidate,
    baseScore,
    commitPropagationBoost: commitPropBoost,
    prPropagationBoost: prPropBoost,
    finalRawScore,
    confidence,
    confidenceTier,
    reasons: {
      temporalProximity: isTemporalProximity,
      projectMatch: isProjectMatch,
      serviceMatch: isServiceMatch,
      environmentMatch: isEnvMatch,
      deploymentRelation: isDeploymentRelation,
      commitRelation: isCommitRelation,
      sentrySpike: isSentrySpike,
      workflowFailure: isWorkflowFailure,
      temporalRelation,
      minutesFromDetection,
      precursor: isPrecursor,
      postIncident: !isPrecursor,
    },
    scoreBreakdown,
  };
}

export function selectNearestCandidates(
  candidates: CandidateSignal[],
  detectedAt: Date,
  cap: number,
): { retained: CandidateSignal[]; isTruncated: boolean } {
  const detectedTime = detectedAt.getTime();

  const sorted = [...candidates].sort((a, b) => {
    const distA = Math.abs(a.occurredAt.getTime() - detectedTime);
    const distB = Math.abs(b.occurredAt.getTime() - detectedTime);

    if (distA !== distB) return distA - distB;

    const timeA = a.occurredAt.getTime();
    const timeB = b.occurredAt.getTime();

    if (timeA !== timeB) return timeB - timeA;

    return a.externalRefId.localeCompare(b.externalRefId);
  });

  return {
    retained: sorted.slice(0, Math.max(0, cap)),
    isTruncated: candidates.length > Math.max(0, cap),
  };
}

export function compareScoredCandidates(
  a: CandidateScoreResult,
  b: CandidateScoreResult,
  detectedAt: Date,
): number {
  // 1. Highest confidence first
  if (b.confidence !== a.confidence) {
    return b.confidence - a.confidence;
  }
  // 2. Precursor evidence outranks post-incident evidence
  if (a.reasons.precursor !== b.reasons.precursor) {
    return a.reasons.precursor ? -1 : 1;
  }
  // 3. Absolute temporal distance from detection (closer first)
  const distA = Math.abs(a.candidate.occurredAt.getTime() - detectedAt.getTime());
  const distB = Math.abs(b.candidate.occurredAt.getTime() - detectedAt.getTime());
  if (distA !== distB) {
    return distA - distB;
  }
  // 4. Occurrence timestamp (earlier first)
  if (a.candidate.occurredAt.getTime() !== b.candidate.occurredAt.getTime()) {
    return a.candidate.occurredAt.getTime() - b.candidate.occurredAt.getTime();
  }
  // 5. Stable EvidenceType order
  const typeOrder = a.candidate.type.localeCompare(b.candidate.type);
  if (typeOrder !== 0) {
    return typeOrder;
  }
  // 6. Stable externalRefId order
  return a.candidate.externalRefId.localeCompare(b.candidate.externalRefId);
}

export function scoreAllCandidates(
  candidates: CandidateSignal[],
  incident: IncidentScoringContext,
): CandidateScoreResult[] {
  // Stage 1: Identify anchor deployments
  const relationships: ExplicitProviderRelationships = {
    anchorDeploymentCommitShas: new Set<string>(),
    anchorDeploymentIds: new Set<string>(),
    anchorDeploymentEnvs: new Map<string, string>(),
    correlatedCommitShas: new Set<string>(),
  };

  const initialRelationships: ExplicitProviderRelationships = {
    anchorDeploymentCommitShas: new Set<string>(),
    anchorDeploymentIds: new Set<string>(),
    anchorDeploymentEnvs: new Map<string, string>(),
    correlatedCommitShas: new Set<string>(),
  };

  for (const c of candidates) {
    if (c.type === EvidenceType.GITHUB_DEPLOYMENT) {
      const scored = scoreCandidate(c, incident, initialRelationships);
      const commitSha = typeof c.metadata['commitSha'] === 'string' ? c.metadata['commitSha'] : '';
      const deploymentId = typeof c.metadata['deploymentId'] === 'string' ? c.metadata['deploymentId'] : '';
      const env = c.environment || 'PRODUCTION';

      // Deployment is considered an anchor if it occurred before detection or scored decently
      if (scored.confidence >= 0.40 || scored.reasons.precursor) {
        if (commitSha) {
          relationships.anchorDeploymentCommitShas.add(commitSha);
          relationships.anchorDeploymentEnvs.set(commitSha, env);
        }
        if (deploymentId) {
          relationships.anchorDeploymentIds.add(deploymentId);
        }
      }
    }
  }

  // Stage 2: Identify correlated commits
  for (const c of candidates) {
    if (c.type === EvidenceType.GITHUB_COMMIT) {
      const sha = typeof c.metadata['sha'] === 'string' ? c.metadata['sha'] : '';
      if (sha && relationships.anchorDeploymentCommitShas.has(sha)) {
        relationships.correlatedCommitShas.add(sha);
      }
    }
  }

  // Stage 3: Score all candidates deterministically
  const scoredResults: CandidateScoreResult[] = [];
  for (const c of candidates) {
    const scored = scoreCandidate(c, incident, relationships);
    if (scored.finalRawScore >= CORRELATION_THRESHOLDS.DISCARD_NOISE) {
      scoredResults.push(scored);
    }
  }

  // Stage 4: Sort deterministically
  scoredResults.sort((a, b) => compareScoredCandidates(a, b, incident.detectedAt));

  return scoredResults;
}
