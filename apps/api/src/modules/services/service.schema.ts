import { z } from 'zod';

export const createServiceSchema = z.object({
  name: z.string().min(2, 'Service name must be at least 2 characters').max(100),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
    .optional(),
  description: z.string().max(500).optional(),
  repositoryUrl: z.string().url('Invalid repository URL').nullable().optional(),
});

export const updateServiceSchema = z.object({
  name: z.string().min(2, 'Service name must be at least 2 characters').max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  repositoryUrl: z.string().url('Invalid repository URL').nullable().optional(),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
