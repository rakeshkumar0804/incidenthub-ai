import { apiClient } from '../lib/axios';
import type {
  SlackConnectResponseDto,
  JiraConnectResponseDto,
  CreateJiraIssueInputDto,
  CreateJiraIssueResponseDto,
} from '@incidenthub/shared';

export class IntegrationService {
  public static async getSlackConnectUrl(organizationId: string): Promise<string> {
    const res = await apiClient.get<{ success: boolean; data: SlackConnectResponseDto }>(
      `/organizations/${organizationId}/integrations/slack/connect`,
    );
    return res.data.data.authorizeUrl;
  }

  public static async disconnectSlack(organizationId: string): Promise<void> {
    await apiClient.delete(`/organizations/${organizationId}/integrations/slack/disconnect`);
  }

  public static async createSlackChannel(organizationId: string, incidentId: string): Promise<{ channelId: string; channelUrl: string }> {
    const res = await apiClient.post<{ success: boolean; data: { channelId: string; channelUrl: string } }>(
      `/organizations/${organizationId}/integrations/slack/incidents/${incidentId}/channel`,
    );
    return res.data.data;
  }

  public static async getJiraConnectUrl(organizationId: string): Promise<string> {
    const res = await apiClient.get<{ success: boolean; data: JiraConnectResponseDto }>(
      `/organizations/${organizationId}/integrations/jira/connect`,
    );
    return res.data.data.authorizeUrl;
  }

  public static async connectJiraApiToken(
    organizationId: string,
    input: { siteUrl: string; email: string; apiToken: string; defaultProjectKey?: string },
  ): Promise<void> {
    await apiClient.post(`/organizations/${organizationId}/integrations/jira/connect-token`, input);
  }

  public static async disconnectJira(organizationId: string): Promise<void> {
    await apiClient.delete(`/organizations/${organizationId}/integrations/jira/disconnect`);
  }

  public static async createJiraIssue(
    organizationId: string,
    incidentId: string,
    actionItemId: string,
    input?: CreateJiraIssueInputDto,
  ): Promise<CreateJiraIssueResponseDto> {
    const res = await apiClient.post<{ success: boolean; data: CreateJiraIssueResponseDto }>(
      `/organizations/${organizationId}/integrations/jira/incidents/${incidentId}/action-items/${actionItemId}/jira-issue`,
      input || {},
    );
    return res.data.data;
  }
}
