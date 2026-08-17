import { z } from 'zod';
import { IncidentSeverity, IncidentStatus, IncidentEnvironment } from '@incidenthub/shared';

export const createIncidentSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200, 'Title max 200 characters'),
  description: z.string().max(5000, 'Description max 5000 characters').optional(),
  projectId: z.string().min(1, 'Project ID is required'),
  serviceId: z.string().optional().nullable(),
  severity: z.nativeEnum(IncidentSeverity, {
    errorMap: () => ({ message: 'Invalid severity' }),
  }).default(IncidentSeverity.SEV3),
  environment: z.nativeEnum(IncidentEnvironment, {
    errorMap: () => ({ message: 'Invalid environment' }),
  }).default(IncidentEnvironment.PRODUCTION),
  assigneeId: z.string().optional().nullable(),
});

export const updateIncidentSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(200).optional(),
  description: z.string().max(5000).optional().nullable(),
  environment: z.nativeEnum(IncidentEnvironment).optional(),
});

export const updateStatusSchema = z.object({
  status: z.nativeEnum(IncidentStatus, {
    errorMap: () => ({ message: 'Invalid status' }),
  }),
});

export const updateSeveritySchema = z.object({
  severity: z.nativeEnum(IncidentSeverity, {
    errorMap: () => ({ message: 'Invalid severity' }),
  }),
});

export const updateAssigneeSchema = z.object({
  assigneeId: z.string().nullable(),
});

export const queryIncidentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  environment: z.nativeEnum(IncidentEnvironment).optional(),
  projectId: z.string().optional(),
  serviceId: z.string().optional(),
  assigneeId: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'severity', 'number']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type UpdateSeverityInput = z.infer<typeof updateSeveritySchema>;
export type UpdateAssigneeInput = z.infer<typeof updateAssigneeSchema>;
export type QueryIncidentsInput = z.infer<typeof queryIncidentsSchema>;
