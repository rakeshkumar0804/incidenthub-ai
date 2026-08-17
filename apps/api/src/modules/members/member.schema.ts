import { z } from 'zod';
import { OrgRole } from '@incidenthub/shared';

export const updateMemberRoleSchema = z.object({
  role: z.nativeEnum(OrgRole),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
