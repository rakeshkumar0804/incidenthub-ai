import type { AIInvestigationInput, AIProviderResult } from '../ai.types';

export interface AIInvestigationProvider {
  readonly name: string;
  investigate(input: AIInvestigationInput): Promise<AIProviderResult>;
}
