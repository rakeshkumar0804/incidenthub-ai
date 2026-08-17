import { z } from 'zod';

export const analyticsQuerySchema = z.object({
  window: z.enum(['24h', '7d', '30d', '90d', 'custom']).optional().default('30d'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  projectId: z.string().optional(),
  serviceId: z.string().optional(),
  refresh: z.enum(['true', 'false']).optional().default('false'),
});

export const analyticsDrilldownQuerySchema = z.object({
  metric: z.string().min(1),
  window: z.enum(['24h', '7d', '30d', '90d', 'custom']).optional().default('30d'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  refresh: z.enum(['true', 'false']).optional().default('false'),
});

export type AnalyticsQueryInput = z.input<typeof analyticsQuerySchema>;
export type AnalyticsQuerySchema = z.output<typeof analyticsQuerySchema>;
export type AnalyticsDrilldownQuerySchema = z.output<typeof analyticsDrilldownQuerySchema>;
