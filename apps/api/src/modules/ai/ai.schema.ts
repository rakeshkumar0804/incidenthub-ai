import { z } from 'zod';

export const triggerInvestigationSchema = z.object({
  triggerType: z
    .enum(['AUTOMATIC_CORRELATION_COMPLETED', 'MANUAL_REQUEST', 'RERUN_REQUEST'])
    .optional()
    .default('MANUAL_REQUEST'),
}).strict();

export const supportingEvidenceItemSchema = z.object({
  evidenceId: z.string().min(1).max(100),
  claim: z.string().min(1).max(500),
  relevanceReason: z.string().min(1).max(500),
}).strict();

export const contradictoryEvidenceItemSchema = z.object({
  evidenceId: z.string().min(1).max(100),
  contradiction: z.string().min(1).max(500),
}).strict();

export const alternativeHypothesisItemSchema = z.object({
  hypothesis: z.string().min(1).max(500),
  likelihood: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  evidenceIds: z.array(z.string().min(1).max(100)).max(20).default([]),
}).strict();

export const recommendedActionItemSchema = z.object({
  action: z.string().min(1).max(500),
  priority: z.enum(['IMMEDIATE', 'HIGH', 'MEDIUM', 'LOW']),
  category: z.enum(['MITIGATION', 'PREVENTION', 'INVESTIGATION']),
}).strict();

export const aiInvestigationOutputSchema = z.object({
  incidentSummary: z.string().min(1).max(2000),
  probableRootCause: z.string().min(1).max(1000),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .refine((n) => !Number.isNaN(n) && Number.isFinite(n), {
      message: 'Confidence must be a finite number between 0 and 1',
    }),
  confidenceTier: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNCERTAIN']),
  supportingEvidence: z.array(supportingEvidenceItemSchema).max(20).default([]),
  contradictoryEvidence: z.array(contradictoryEvidenceItemSchema).max(20).default([]),
  alternativeHypotheses: z.array(alternativeHypothesisItemSchema).max(10).default([]),
  impactAssessment: z.string().max(2000).default(''),
  riskAssessment: z.string().max(2000).default(''),
  recommendedActions: z.array(recommendedActionItemSchema).max(15).default([]),
  uncertainty: z.array(z.string().max(500)).max(20).default([]),
  investigationLimitations: z.string().max(2000).default(''),
}).strict();

export type TriggerInvestigationSchema = z.infer<typeof triggerInvestigationSchema>;
export type AIInvestigationOutputSchema = z.infer<typeof aiInvestigationOutputSchema>;
