import type { AIInvestigationProvider } from './aiProvider.interface';
import type { AIInvestigationInput, AIProviderResult, AIInvestigationOutput } from '../ai.types';
import { aiInvestigationOutputSchema } from '../ai.schema';
import { logger } from '../../../utils/logger';

export class OpenAIInvestigationProvider implements AIInvestigationProvider {
  public readonly name = 'openai';
  private readonly modelName: string;
  private readonly apiKey: string | undefined;

  constructor(modelName = 'gpt-4o') {
    this.modelName = modelName;
    this.apiKey = process.env['OPENAI_API_KEY'];
  }

  public async investigate(input: AIInvestigationInput): Promise<AIProviderResult> {
    const startTime = Date.now();

    if (this.apiKey) {
      try {
        return await this.callOpenAI(input, startTime);
      } catch (err) {
        logger.warn({ err }, 'OpenAI API call failed, falling back to deterministic evidence evaluation');
      }
    }

    // Fallback offline deterministic provider execution
    return this.fallbackDeterministicInvestigation(input, startTime);
  }

  private async callOpenAI(input: AIInvestigationInput, startTime: number): Promise<AIProviderResult> {
    const systemPrompt = `You are a Principal Site Reliability Engineer investigating a production incident.
Analyze the structured Phase 8 correlation evidence provided and generate an evidence-backed root cause analysis.
STRICT RULES:
1. Every claim in supportingEvidence or contradictoryEvidence MUST reference a valid evidenceId present in the input evidenceList.
2. DO NOT fabricate evidence IDs, commit SHAs, URLs, stack traces, or deployment names.
3. If evidence is missing or inconclusive, explicitly state this in the uncertainty and limitations sections.
4. Output MUST be valid JSON matching the requested schema.`;

    const userPrompt = JSON.stringify(input, null, 2);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI HTTP ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as unknown;
    const validatedOutput = aiInvestigationOutputSchema.parse(parsed);

    const latencyMs = Date.now() - startTime;

    return {
      output: validatedOutput,
      providerName: this.name,
      modelName: this.modelName,
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
      latencyMs,
      rawResponse: parsed,
    };
  }

  private fallbackDeterministicInvestigation(
    input: AIInvestigationInput,
    startTime: number,
  ): AIProviderResult {
    const evidenceList = input.evidenceList || [];
    const highTier = evidenceList.filter((e) => e.confidenceTier === 'HIGH');
    const medTier = evidenceList.filter((e) => e.confidenceTier === 'MEDIUM');

    let rootCause = 'Insufficient evidence to determine root cause.';
    let summary = `Incident ${input.incident.number} (${input.incident.title}) occurred in ${input.incident.environment}.`;
    let confidence = 0.0;
    let confidenceTier: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCERTAIN' = 'UNCERTAIN';

    const supportingEvidence = highTier.concat(medTier).map((e) => ({
      evidenceId: e.id,
      claim: `Correlated signal detected: ${e.title}`,
      relevanceReason: `Phase 8 confidence score ${e.confidence ?? 0} (${e.confidenceTier ?? 'LOW'})`,
    }));

    const topDeploy = highTier.find((e) => e.type === 'GITHUB_DEPLOYMENT') || medTier.find((e) => e.type === 'GITHUB_DEPLOYMENT');
    const topSentry = highTier.find((e) => e.type === 'SENTRY_ERROR') || medTier.find((e) => e.type === 'SENTRY_ERROR');
    const topCommit = highTier.find((e) => e.type === 'GITHUB_COMMIT') || medTier.find((e) => e.type === 'GITHUB_COMMIT');

    if (topDeploy || topSentry || topCommit) {
      if (topDeploy && topSentry) {
        rootCause = `Preceding deployment "${topDeploy.title}" correlates directly with error spike "${topSentry.title}".`;
        summary = `Recent deployment correlates with an automated Sentry exception spike in ${input.incident.environment}.`;
        confidence = 0.85;
        confidenceTier = 'HIGH';
      } else if (topDeploy) {
        rootCause = `Preceding deployment "${topDeploy.title}" initiated regression in ${input.incident.environment}.`;
        summary = `Deployment correlates with incident onset.`;
        confidence = 0.70;
        confidenceTier = 'MEDIUM';
      } else if (topSentry) {
        rootCause = `Error spike "${topSentry.title}" indicates runtime exception failure.`;
        summary = `Sentry exception spike correlates with incident telemetry.`;
        confidence = 0.65;
        confidenceTier = 'MEDIUM';
      } else if (topCommit) {
        rootCause = `Commit "${topCommit.title}" contains suspicious code changes.`;
        summary = `GitHub commit correlates with incident timeline.`;
        confidence = 0.55;
        confidenceTier = 'MEDIUM';
      }
    }

    const output: AIInvestigationOutput = {
      incidentSummary: summary,
      probableRootCause: rootCause,
      confidence,
      confidenceTier,
      supportingEvidence,
      contradictoryEvidence: [],
      alternativeHypotheses: [
        {
          hypothesis: 'Infrastructure network or database connection saturation',
          likelihood: 'LOW',
          evidenceIds: [],
        },
      ],
      impactAssessment: `Impact reported on ${input.incident.projectName} (${input.incident.severity} in ${input.incident.environment}).`,
      riskAssessment: confidenceTier === 'HIGH' ? 'HIGH — Active regression in production environment' : 'MEDIUM — Operational investigation in progress',
      recommendedActions: [
        {
          action: 'Roll back recent deployment if error rate persists above baseline',
          priority: 'IMMEDIATE',
          category: 'MITIGATION',
        },
        {
          action: 'Inspect application error logs and stack traces',
          priority: 'HIGH',
          category: 'INVESTIGATION',
        },
      ],
      uncertainty: evidenceList.length === 0 ? ['Zero Phase 8 correlation evidence items available.'] : [],
      investigationLimitations: 'Analysis generated from available Phase 8 evidence signals without manual telemetry.',
    };

    return {
      output,
      providerName: this.name,
      modelName: `${this.modelName}-offline`,
      promptTokens: 120,
      completionTokens: 180,
      totalTokens: 300,
      latencyMs: Date.now() - startTime,
    };
  }
}
