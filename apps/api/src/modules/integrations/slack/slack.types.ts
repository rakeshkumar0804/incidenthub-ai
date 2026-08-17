import type { IncidentSeverity } from '@incidenthub/shared';

export interface SlackOAuthTokenResponse {
  ok: boolean;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: {
    id: string;
    name: string;
  };
  error?: string;
}

export interface SlackStoredCredentials {
  botToken: string;
  botUserId: string;
  teamId: string;
  teamName: string;
}

export interface SlackIntegrationMetadata {
  teamId: string;
  teamName: string;
  botUserId: string;
  defaultChannelId?: string;
  autoCreateChannels?: boolean;
  notifySeverities?: IncidentSeverity[];
  connectedAt: string;
  connectedByUserId: string;
}

export interface SlackInteractivePayload {
  type: string;
  user: {
    id: string;
    username: string;
    name: string;
    email?: string;
  };
  team: {
    id: string;
    domain: string;
  };
  channel: {
    id: string;
    name: string;
  };
  actions: Array<{
    action_id: string;
    value: string;
  }>;
  response_url: string;
  trigger_id: string;
}
