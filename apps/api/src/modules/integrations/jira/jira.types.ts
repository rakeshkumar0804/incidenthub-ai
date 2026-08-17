export interface JiraOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export interface JiraAccessibleResource {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  avatarUrl?: string;
}

export interface JiraStoredCredentials {
  authMode: 'OAUTH_3LO' | 'API_TOKEN';
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  apiToken?: string;
  email?: string;
  siteUrl?: string;
  cloudId?: string;
}

export interface JiraIntegrationMetadata {
  siteId?: string;
  siteUrl?: string;
  siteName?: string;
  defaultProjectKey?: string;
  authMode: 'OAUTH_3LO' | 'API_TOKEN';
  connectedAt: string;
  connectedByUserId: string;
}

export interface JiraWebhookPayload {
  webhookEvent: string;
  issue: {
    id: string;
    key: string;
    fields: {
      summary: string;
      status: {
        id: string;
        name: string;
      };
    };
  };
  timestamp?: number;
}
