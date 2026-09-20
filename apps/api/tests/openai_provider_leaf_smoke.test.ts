import { describe, it, expect } from 'vitest';
import { OpenAIPostmortemProvider } from '../src/modules/postmortems/providers/openaiPostmortem.provider';
import { toFiniteNonNegativeInteger } from '../src/modules/postmortems/postmortem.numeric';

describe('OpenAIPostmortemProvider Leaf Smoke Test (Circular Dependency Prevention)', () => {
  it('instantiates directly and runs offline generation without importing PostmortemService', async () => {
    const provider = new OpenAIPostmortemProvider();
    expect(provider.name).toBe('openai');

    const result = await provider.generatePostmortem({
      incident: {
        id: 'inc-smoke-test',
        number: 101,
        title: 'Smoke Test Incident',
        description: 'Smoke testing provider isolation',
        severity: 'SEV1',
        status: 'RESOLVED',
        environment: 'PRODUCTION',
        detectedAt: new Date(),
        resolvedAt: new Date(),
        serviceName: 'Auth Service',
        projectName: 'Backend API',
      },
      evidenceItems: [],
      investigationRun: null,
      replayEvents: [],
    });

    expect(result).toBeDefined();
    expect(result.providerName).toBe('openai-offline-fallback');
    expect(result.modelName).toBe('gpt-4o-simulated');
    expect(result.promptTokens).toBeGreaterThanOrEqual(0);
    expect(result.completionTokens).toBeGreaterThanOrEqual(0);
    expect(result.totalTokens).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.rawOutput).toBeDefined();
    expect(result.rawOutput.summary).toBeDefined();
  });

  it('toFiniteNonNegativeInteger behaves accurately in isolation', () => {
    expect(toFiniteNonNegativeInteger(150.5)).toBe(150);
    expect(toFiniteNonNegativeInteger(-20)).toBe(0);
    expect(toFiniteNonNegativeInteger(NaN, 10)).toBe(10);
  });
});
