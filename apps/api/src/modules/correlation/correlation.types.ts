import type { EvidenceConfidenceTier, EvidenceType } from '@prisma/client';

export type TemporalRelation = 'PRECURSOR' | 'POST_INCIDENT';
export type NormalizedEnvironment = 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'UNKNOWN';

export interface CandidateSignal {
  type: EvidenceType;
  externalRefId: string;
  title: string;
  description: string | null;
  url: string | null;
  occurredAt: Date;
  serviceId: string | null;
  environment: string;
  metadata: Record<string, unknown>;
  rawEntity?: unknown;
}

export interface IncidentScoringContext {
  incidentId: string;
  organizationId: string;
  projectId: string;
  serviceId: string | null;
  environment: string;
  detectedAt: Date;
}

export interface ExplicitProviderRelationships {
  anchorDeploymentCommitShas: Set<string>;
  anchorDeploymentIds: Set<string>;
  anchorDeploymentEnvs: Map<string, string>;
  correlatedCommitShas: Set<string>;
}

export interface CandidateScoringReasons {
  temporalProximity: boolean;
  projectMatch: boolean;
  serviceMatch: boolean;
  environmentMatch: boolean;
  deploymentRelation: boolean;
  commitRelation: boolean;
  sentrySpike: boolean;
  workflowFailure: boolean;
  temporalRelation: TemporalRelation;
  minutesFromDetection: number;
  precursor: boolean;
  postIncident: boolean;
}

export interface CandidateScoreResult {
  candidate: CandidateSignal;
  baseScore: number;
  commitPropagationBoost: number;
  prPropagationBoost: number;
  finalRawScore: number;
  confidence: number;
  confidenceTier: EvidenceConfidenceTier;
  reasons: CandidateScoringReasons;
  scoreBreakdown: Record<string, number>;
}
