import type { PostmortemProviderResult } from '../postmortem.types';
import type { PostmortemSourceSnapshot } from '../postmortem.engine';

export interface PostmortemInputContext {
  incident: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    severity: string;
    status: string;
    environment: string;
    detectedAt: string | Date;
    resolvedAt: string | Date | null;
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
    uncertainty: string | string[] | null;
  } | null;
  replayEvents: Array<{
    id: string;
    sequenceIndex: number;
    category: string;
    eventType: string;
    title: string;
    timestamp: string | Date;
    actorName: string | null;
  }>;
}

export interface AIPostmortemProvider {
  generatePostmortem(
    context: PostmortemInputContext,
    snapshot?: PostmortemSourceSnapshot,
  ): Promise<PostmortemProviderResult>;
}
