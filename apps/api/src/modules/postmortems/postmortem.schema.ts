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
  sourceId: z.string().min(1),
  sourceType: z.enum(['EVIDENCE', 'REPLAY_EVENT', 'INVESTIGATION_RUN', 'COMMENT']),
  claimType: claimTypeEnum.default('FACT'),
  description: z.string().min(1),
});

export const rawActionItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().default('MEDIUM'),
});

export const rawPostmortemLLMOutputSchema = z.object({
  summary: z.string().min(1),
  impact: z.string().min(1), // Normalized name
  incidentTimeline: z.string().min(1),
  rootCause: z.string().min(1),
  contributingFactors: z.string().min(1),
  detection: z.string().min(1),
  resolution: z.string().min(1),
  wentWell: z.string().min(1),
  wentWrong: z.string().min(1),
  uncertainty: z.string().optional(),
  evidenceReferences: z.array(rawEvidenceCitationSchema).default([]),
  actionItems: z.array(rawActionItemSchema).default([]),
});

export const generatePostmortemSchema = z.object({
  triggerType: z
    .enum(['AUTOMATIC_INCIDENT_RESOLVED', 'MANUAL_REQUEST', 'REGENERATE_REQUEST'])
    .optional()
    .default('MANUAL_REQUEST'),
});

export const updatePostmortemSchema = z.object({
  summary: z.string().optional(),
  impact: z.string().optional(),
  incidentTimeline: z.string().optional(),
  rootCause: z.string().optional(),
  contributingFactors: z.string().optional(),
  detection: z.string().optional(),
  resolution: z.string().optional(),
  wentWell: z.string().optional(),
  wentWrong: z.string().optional(),
  uncertainty: z.string().optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']).optional(),
});

export const createActionItemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().default('MEDIUM'),
  assigneeId: z.string().optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
});

export const updateActionItemSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
});

export type GeneratePostmortemSchema = z.infer<typeof generatePostmortemSchema>;
export type UpdatePostmortemSchema = z.infer<typeof updatePostmortemSchema>;
export type CreateActionItemSchema = z.infer<typeof createActionItemSchema>;
export type UpdateActionItemSchema = z.infer<typeof updateActionItemSchema>;
