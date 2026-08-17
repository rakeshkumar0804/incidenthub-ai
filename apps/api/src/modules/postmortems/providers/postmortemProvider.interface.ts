import type { PostmortemProviderResult } from '../postmortem.types';

export interface PostmortemInputContext {
  incident: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    severity: string;
    status: string;
    environment: string;
    detectedAt: Date;
    resolvedAt: Date | null;
    serviceName: string | null;
    projectName: string | null;
  };
  evidenceItems: Array<{
    id: string;
    type: string;
    title: string;
    description: string | null;
    url: string | null;
    confidenceTier: string | null;
  }>;
  investigationRun: {
    id: string;
    probableRootCause: string | null;
    confidenceTier: string | null;
    riskAssessment: string | null;
    uncertainty: string | null;
  } | null;
  replayEvents: Array<{
    id: string;
    sequenceIndex: number;
    category: string;
    eventType: string;
    title: string;
    timestamp: Date;
    actorName: string | null;
  }>;
}

export interface AIPostmortemProvider {
  generatePostmortem(context: PostmortemInputContext): Promise<PostmortemProviderResult>;
}
