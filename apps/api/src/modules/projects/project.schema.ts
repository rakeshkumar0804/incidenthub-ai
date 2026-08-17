import { z } from 'zod';
import { ProjectStatus } from '@incidenthub/shared';

export const createProjectSchema = z.object({
  name: z.string().min(2, 'Project name must be at least 2 characters').max(100),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
    .optional(),
  description: z.string().max(500).optional(),
  status: z.nativeEnum(ProjectStatus).default(ProjectStatus.ACTIVE),
  teamId: z.string().nullable().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(2, 'Project name must be at least 2 characters').max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.nativeEnum(ProjectStatus).optional(),
  teamId: z.string().nullable().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
