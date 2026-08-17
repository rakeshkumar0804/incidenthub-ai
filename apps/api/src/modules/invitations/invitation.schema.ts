import { z } from 'zod';
import { OrgRole } from '@incidenthub/shared';

export const createInvitationSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.nativeEnum(OrgRole).default(OrgRole.VIEWER),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, 'Invitation token is required'),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
