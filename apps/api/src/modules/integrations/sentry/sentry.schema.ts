import { z } from 'zod';

export const connectSentryOAuthSchema = z.object({
  code: z.string().min(1, 'OAuth code is required'),
  state: z.string().optional(),
  codeVerifier: z.string().optional(),
  redirectUri: z.string().min(1, 'Redirect URI is required'),
  sentryOrgSlug: z.string().optional(),
});

export const connectSentryTokenSchema = z.object({
  sentryToken: z.string().min(1, 'Sentry token is required'),
  sentryOrgSlug: z.string().min(1, 'Sentry organization slug is required'),
});

export const createSentryRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  environment: z.string().nullable().optional(),
  minEventCount: z.number().int().min(1).optional(),
  minUserCount: z.number().int().min(1).optional(),
  levelFilter: z.string().nullable().optional(),
  mappedSeverity: z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']).optional(),
  autoCreateIncident: z.boolean().optional(),
  projectId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
});

export const linkSentryIssueSchema = z.object({
  sentryIssueId: z.string().min(1, 'Sentry issue ID is required'),
});
