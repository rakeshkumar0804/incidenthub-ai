import { z } from 'zod';

export const connectGitHubAppSchema = z.object({
  installationId: z.string().min(1, 'Installation ID is required'),
  appId: z.string().optional(),
  privateKey: z.string().optional(),
});

export const connectGitHubPatSchema = z.object({
  personalAccessToken: z.string().min(1, 'Personal Access Token is required'),
});

export const linkRepoSchema = z.object({
  projectId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
});

export const linkIncidentActivitySchema = z.object({
  activityType: z.enum(['GITHUB_COMMIT', 'GITHUB_PR', 'GITHUB_DEPLOYMENT', 'GITHUB_WORKFLOW_RUN']),
  activityId: z.string().min(1, 'Activity ID is required'),
});
