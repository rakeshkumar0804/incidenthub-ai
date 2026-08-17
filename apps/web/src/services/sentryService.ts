import { apiClient } from '../lib/axios';
import type {
  SentryIntegrationDto,
  ConnectSentryOAuthInput,
  SentryIssueDto,
  SentryRuleDto,
  CreateSentryRuleInput,
} from '@incidenthub/shared';

export interface ApiSuccess<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const getSentryStatus = async (organizationId: string): Promise<SentryIntegrationDto> => {
  const { data } = await apiClient.get<ApiSuccess<SentryIntegrationDto>>(
    `/organizations/${organizationId}/integrations/sentry`,
  );
  return data.data;
};

export const connectSentryOAuth = async (
  organizationId: string,
  input: ConnectSentryOAuthInput,
): Promise<SentryIntegrationDto> => {
  const { data } = await apiClient.post<ApiSuccess<SentryIntegrationDto>>(
    `/organizations/${organizationId}/integrations/sentry/connect-oauth`,
    input,
  );
  return data.data;
};

export const connectSentryToken = async (
  organizationId: string,
  sentryToken: string,
  sentryOrgSlug: string,
): Promise<SentryIntegrationDto> => {
  const { data } = await apiClient.post<ApiSuccess<SentryIntegrationDto>>(
    `/organizations/${organizationId}/integrations/sentry/connect-token`,
    { sentryToken, sentryOrgSlug },
  );
  return data.data;
};

export const disconnectSentry = async (organizationId: string): Promise<SentryIntegrationDto> => {
  const { data } = await apiClient.delete<ApiSuccess<SentryIntegrationDto>>(
    `/organizations/${organizationId}/integrations/sentry/disconnect`,
  );
  return data.data;
};

export const getSentryIssues = async (organizationId: string): Promise<SentryIssueDto[]> => {
  const { data } = await apiClient.get<ApiSuccess<SentryIssueDto[]>>(
    `/organizations/${organizationId}/integrations/sentry/issues`,
  );
  return data.data;
};

export const getSentryRules = async (organizationId: string): Promise<SentryRuleDto[]> => {
  const { data } = await apiClient.get<ApiSuccess<SentryRuleDto[]>>(
    `/organizations/${organizationId}/integrations/sentry/rules`,
  );
  return data.data;
};

export const createSentryRule = async (
  organizationId: string,
  input: CreateSentryRuleInput,
): Promise<SentryRuleDto> => {
  const { data } = await apiClient.post<ApiSuccess<SentryRuleDto>>(
    `/organizations/${organizationId}/integrations/sentry/rules`,
    input,
  );
  return data.data;
};

export const deleteSentryRule = async (organizationId: string, ruleId: string): Promise<void> => {
  await apiClient.delete(`/organizations/${organizationId}/integrations/sentry/rules/${ruleId}`);
};

export const linkSentryIssueToIncident = async (
  organizationId: string,
  incidentId: string,
  sentryIssueId: string,
): Promise<{ evidenceId: string; timelineEventId: string }> => {
  const { data } = await apiClient.post<ApiSuccess<{ evidenceId: string; timelineEventId: string }>>(
    `/organizations/${organizationId}/integrations/sentry/incidents/${incidentId}/link`,
    { sentryIssueId },
  );
  return data.data;
};
