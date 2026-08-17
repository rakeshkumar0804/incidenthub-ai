import { z } from 'zod';

export const triggerReplaySchema = z.object({
  triggerType: z
    .enum(['AUTOMATIC_INCIDENT_RESOLVED', 'MANUAL_REQUEST', 'RERUN_REQUEST'])
    .optional()
    .default('MANUAL_REQUEST'),
});

export type TriggerReplaySchema = z.infer<typeof triggerReplaySchema>;
