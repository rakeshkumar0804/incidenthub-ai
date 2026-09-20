import { z } from 'zod';

export const claimTypeEnum = z.enum([
  'FACT',
  'INVESTIGATION_CONCLUSION',
  'RECOMMENDATION',
  'UNCERTAINTY',
  'METADATA',
  'UNSUPPORTED_CLAIM',
]);

export const rawEvidenceCitationSchema = z.object({
  sourceId: z.string().min(1).max(255),
  sourceType: z.enum(['EVIDENCE', 'REPLAY_EVENT', 'INVESTIGATION_RUN', 'COMMENT']).optional().default('EVIDENCE'),
  claimType: claimTypeEnum.optional().default('FACT'),
  description: z.string().min(1).max(2000),
});

export const rawActionItemSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional().default('MEDIUM'),
});

export const groundedClaimSchema = z.object({
  text: z.string().min(1).max(2000),
  claimType: z.enum(['FACT', 'INVESTIGATION_CONCLUSION', 'RECOMMENDATION', 'UNCERTAINTY']),
  sourceIds: z.array(z.string().min(1).max(255)).max(10).default([]),
  sourceType: z.enum(['EVIDENCE', 'REPLAY_EVENT', 'INVESTIGATION_RUN', 'COMMENT']).optional(),
});

export type GroundedClaim = z.infer<typeof groundedClaimSchema>;

export const rawPostmortemLLMOutputSchema = z.object({
  summary: z.string().min(1).max(20000),
  impact: z.string().min(1).max(20000),
  incidentTimeline: z.string().min(1).max(20000),
  rootCause: z.string().min(1).max(20000),
  contributingFactors: z.string().min(1).max(20000),
  detection: z.string().min(1).max(20000),
  resolution: z.string().min(1).max(20000),
  wentWell: z.string().min(1).max(20000),
  wentWrong: z.string().min(1).max(20000),
  uncertainty: z.string().max(20000).optional().nullable(),
  evidenceReferences: z.array(rawEvidenceCitationSchema).max(100).default([]),
  actionItems: z.array(rawActionItemSchema).max(20).default([]),
  claims: z.array(groundedClaimSchema).max(50).optional(),
});

export const generatePostmortemSchema = z.object({
  triggerType: z
    .enum(['AUTOMATIC_INCIDENT_RESOLVED', 'MANUAL_REQUEST', 'REGENERATE_REQUEST'])
    .optional()
    .default('MANUAL_REQUEST'),
});

export const updatePostmortemSchema = z.object({
  baseVersionId: z.string().min(1, 'baseVersionId is required for all postmortem edits'),
  summary: z.string().max(20000).optional(),
  impact: z.string().max(20000).optional(),
  incidentTimeline: z.string().max(20000).optional(),
  rootCause: z.string().max(20000).optional(),
  contributingFactors: z.string().max(20000).optional(),
  detection: z.string().max(20000).optional(),
  resolution: z.string().max(20000).optional(),
  wentWell: z.string().max(20000).optional(),
  wentWrong: z.string().max(20000).optional(),
  uncertainty: z.string().max(20000).optional().nullable(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED']).optional(),
});

export const createActionItemSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(2000).optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional().default('MEDIUM'),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
});

export const updateActionItemSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
});

export type GeneratePostmortemSchema = z.infer<typeof generatePostmortemSchema>;
export type UpdatePostmortemSchema = z.infer<typeof updatePostmortemSchema>;
export type CreateActionItemSchema = z.infer<typeof createActionItemSchema>;
export type UpdateActionItemSchema = z.infer<typeof updateActionItemSchema>;
