import { z } from 'zod';

export const triggerInvestigationSchema = z.object({
  triggerType: z
    .enum(['AUTOMATIC_CORRELATION_COMPLETED', 'MANUAL_REQUEST', 'RERUN_REQUEST'])
    .optional()
    .default('MANUAL_REQUEST'),
});

export const supportingEvidenceItemSchema = z.object({
  evidenceId: z.string().min(1),
  claim: z.string().min(1),
  relevanceReason: z.string().min(1),
});

export const contradictoryEvidenceItemSchema = z.object({
  evidenceId: z.string().min(1),
  contradiction: z.string().min(1),
});

export const alternativeHypothesisItemSchema = z.object({
  hypothesis: z.string().min(1),
  likelihood: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  evidenceIds: z.array(z.string()).default([]),
});

export const recommendedActionItemSchema = z.object({
  action: z.string().min(1),
  priority: z.enum(['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW']),
  category: z.enum(['MITIGATION', 'PREVENTION', 'INVESTIGATION']),
});

export const aiInvestigationOutputSchema = z.object({
  incidentSummary: z.string().min(1),
  probableRootCause: z.string().min(1),
  confidence: z.number().min(0).max(1),
  confidenceTier: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNCERTAIN']),
  supportingEvidence: z.array(supportingEvidenceItemSchema).default([]),
  contradictoryEvidence: z.array(contradictoryEvidenceItemSchema).default([]),
  alternativeHypotheses: z.array(alternativeHypothesisItemSchema).default([]),
  impactAssessment: z.string().default(''),
  riskAssessment: z.string().default(''),
  recommendedActions: z.array(recommendedActionItemSchema).default([]),
  uncertainty: z.array(z.string()).default([]),
  investigationLimitations: z.string().default(''),
});

export type TriggerInvestigationSchema = z.infer<typeof triggerInvestigationSchema>;
