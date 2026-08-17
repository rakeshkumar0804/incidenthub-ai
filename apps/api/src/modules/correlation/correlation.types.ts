import type { EvidenceConfidenceTier, EvidenceType } from '@prisma/client';

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

export interface CandidateScoreResult {
  candidate: CandidateSignal;
  baseScore: number;
  commitPropagationBoost: number;
  prPropagationBoost: number;
  finalRawScore: number;
  confidence: number;
  confidenceTier: EvidenceConfidenceTier;
  reasons: {
    temporalProximity: boolean;
    projectMatch: boolean;
    serviceMatch: boolean;
    environmentMatch: boolean;
    deploymentRelation: boolean;
    commitRelation: boolean;
    sentrySpike: boolean;
    workflowFailure: boolean;
  };
  scoreBreakdown: Record<string, number>;
}
