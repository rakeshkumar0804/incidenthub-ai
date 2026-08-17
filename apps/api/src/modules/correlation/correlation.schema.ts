import { z } from 'zod';

export const triggerCorrelationSchema = z.object({
  triggerType: z
    .enum([
      'AUTOMATIC_INCIDENT_CREATED',
      'AUTOMATIC_INCIDENT_UPDATED',
      'AUTOMATIC_SIGNAL_RECEIVED',
      'MANUAL_REQUEST',
      'RERUN_REQUEST',
    ])
    .optional()
    .default('MANUAL_REQUEST'),
});

export const updateEvidenceStatusSchema = z.object({
  action: z.enum(['acknowledge', 'dismiss', 'reset']),
});

export type TriggerCorrelationInput = z.infer<typeof triggerCorrelationSchema>;
export type UpdateEvidenceStatusInput = z.infer<typeof updateEvidenceStatusSchema>;
