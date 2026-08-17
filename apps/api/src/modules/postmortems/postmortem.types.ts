import type { ClaimType } from '@incidenthub/shared';

export interface RawEvidenceCitationInput {
  sourceId: string;
  sourceType: 'EVIDENCE' | 'REPLAY_EVENT' | 'INVESTIGATION_RUN' | 'COMMENT';
  claimType: ClaimType;
  description: string;
}

export interface RawActionItemInput {
  title: string;
  description?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface RawPostmortemLLMOutput {
  summary: string;
  impact: string; // Consistent normalized field name
  incidentTimeline: string;
  rootCause: string;
  contributingFactors: string;
  detection: string;
  resolution: string;
  wentWell: string;
  wentWrong: string;
  uncertainty?: string;
  evidenceReferences: RawEvidenceCitationInput[];
  actionItems: RawActionItemInput[];
}

export interface PostmortemProviderResult {
  rawOutput: RawPostmortemLLMOutput;
  providerName: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
}
