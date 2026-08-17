import type { EvidenceConfidenceTier } from '@prisma/client';

export interface PreparedEvidenceSignal {
  id: string;
  type: string;
  source: string;
  confidenceTier: EvidenceConfidenceTier | null;
  confidence: number | null;
  title: string;
  description: string | null;
  url: string | null;
  reasons: Record<string, boolean> | null;
  scoreBreakdown: Record<string, number> | null;
  metadata: Record<string, unknown> | null;
}

export interface AIInvestigationInput {
  incident: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    severity: string;
    status: string;
    environment: string;
    detectedAt: string;
    projectName: string;
    serviceName: string | null;
  };
  correlationRun: {
    id: string;
    windowStart: string;
    windowEnd: string;
    correlatedCount: number;
    isTruncated: boolean;
  } | null;
  evidenceList: PreparedEvidenceSignal[];
}

export interface SupportingEvidenceItem {
  evidenceId: string;
  claim: string;
  relevanceReason: string;
}

export interface ContradictoryEvidenceItem {
  evidenceId: string;
  contradiction: string;
}

export interface AlternativeHypothesisItem {
  hypothesis: string;
  likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
  evidenceIds: string[];
}

export interface RecommendedActionItem {
  action: string;
  priority: 'IMMEDIATE' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'MITIGATION' | 'PREVENTION' | 'INVESTIGATION';
}

export interface AIInvestigationOutput {
  incidentSummary: string;
  probableRootCause: string;
  confidence: number; // 0.00 to 1.00
  confidenceTier: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCERTAIN';
  supportingEvidence: SupportingEvidenceItem[];
  contradictoryEvidence: ContradictoryEvidenceItem[];
  alternativeHypotheses: AlternativeHypothesisItem[];
  impactAssessment: string;
  riskAssessment: string;
  recommendedActions: RecommendedActionItem[];
  uncertainty: string[];
  investigationLimitations: string;
}

export interface AIProviderResult {
  output: AIInvestigationOutput;
  providerName: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  rawResponse?: unknown;
}
