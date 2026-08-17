import { apiClient } from '../lib/axios';
import type {
  ApiSuccess,
  GitHubIntegrationDto,
  ConnectGitHubAppInput,
  ConnectGitHubPatInput,
  GitHubRepositoryDto,
  LinkRepoInput,
  GitHubCommitDto,
  GitHubPullRequestDto,
  GitHubDeploymentDto,
  GitHubWorkflowRunDto,
  LinkIncidentActivityInput,
} from '@incidenthub/shared';

export const getGitHubIntegration = async (orgId: string): Promise<GitHubIntegrationDto | null> => {
  const { data } = await apiClient.get<ApiSuccess<GitHubIntegrationDto | null>>(
    `/organizations/${orgId}/integrations/github`,
  );
  return data.data;
};

export const connectGitHubApp = async (
  orgId: string,
  input: ConnectGitHubAppInput,
): Promise<GitHubIntegrationDto> => {
  const { data } = await apiClient.post<ApiSuccess<GitHubIntegrationDto>>(
    `/organizations/${orgId}/integrations/github/connect-app`,
    input,
  );
  return data.data;
};

export const connectGitHubPat = async (
  orgId: string,
  input: ConnectGitHubPatInput,
): Promise<GitHubIntegrationDto> => {
  const { data } = await apiClient.post<ApiSuccess<GitHubIntegrationDto>>(
    `/organizations/${orgId}/integrations/github/connect-pat`,
    input,
  );
  return data.data;
};

export const disconnectGitHub = async (orgId: string): Promise<GitHubIntegrationDto> => {
  const { data } = await apiClient.delete<ApiSuccess<GitHubIntegrationDto>>(
    `/organizations/${orgId}/integrations/github/disconnect`,
  );
  return data.data;
};

export const getConnectedRepositories = async (orgId: string): Promise<GitHubRepositoryDto[]> => {
  const { data } = await apiClient.get<ApiSuccess<GitHubRepositoryDto[]>>(
    `/organizations/${orgId}/integrations/github/repositories`,
  );
  return data.data;
};

export const syncRepositories = async (orgId: string): Promise<GitHubRepositoryDto[]> => {
  const { data } = await apiClient.post<ApiSuccess<GitHubRepositoryDto[]>>(
    `/organizations/${orgId}/integrations/github/repositories/sync`,
  );
  return data.data;
};

export const linkRepository = async (
  orgId: string,
  repoId: string,
  input: LinkRepoInput,
): Promise<GitHubRepositoryDto> => {
  const { data } = await apiClient.patch<ApiSuccess<GitHubRepositoryDto>>(
    `/organizations/${orgId}/integrations/github/repositories/${repoId}/link`,
    input,
  );
  return data.data;
};

export const getRepoCommits = async (orgId: string, repoId: string): Promise<GitHubCommitDto[]> => {
  const { data } = await apiClient.get<ApiSuccess<GitHubCommitDto[]>>(
    `/organizations/${orgId}/integrations/github/repositories/${repoId}/commits`,
  );
  return data.data;
};

export const getRepoPullRequests = async (orgId: string, repoId: string): Promise<GitHubPullRequestDto[]> => {
  const { data } = await apiClient.get<ApiSuccess<GitHubPullRequestDto[]>>(
    `/organizations/${orgId}/integrations/github/repositories/${repoId}/pull-requests`,
  );
  return data.data;
};

export const getRepoDeployments = async (orgId: string, repoId: string): Promise<GitHubDeploymentDto[]> => {
  const { data } = await apiClient.get<ApiSuccess<GitHubDeploymentDto[]>>(
    `/organizations/${orgId}/integrations/github/repositories/${repoId}/deployments`,
  );
  return data.data;
};

export const getRepoWorkflowRuns = async (orgId: string, repoId: string): Promise<GitHubWorkflowRunDto[]> => {
  const { data } = await apiClient.get<ApiSuccess<GitHubWorkflowRunDto[]>>(
    `/organizations/${orgId}/integrations/github/repositories/${repoId}/workflows`,
  );
  return data.data;
};

export const linkActivityToIncident = async (
  orgId: string,
  incidentId: string,
  input: LinkIncidentActivityInput,
): Promise<{ evidenceId: string; timelineEventId: string }> => {
  const { data } = await apiClient.post<ApiSuccess<{ evidenceId: string; timelineEventId: string }>>(
    `/organizations/${orgId}/integrations/github/incidents/${incidentId}/link`,
    input,
  );
  return data.data;
};
