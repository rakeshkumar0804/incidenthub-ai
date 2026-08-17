import { logger } from '../../../utils/logger';

export interface SentryRawIssue {
  id: string;
  shortId: string;
  title: string;
  culprit?: string;
  level: string;
  count: string | number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink?: string;
  metadata?: {
    type?: string;
    value?: string;
    filename?: string;
  };
  project?: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface SentryRawProject {
  id: string;
  slug: string;
  name: string;
  platform?: string;
}

export class SentryApiClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(accessToken: string, baseUrl = 'https://sentry.io/api/0') {
    this.accessToken = accessToken;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    if (response.headers.has('x-sentry-rate-limit-remaining')) {
      const remaining = response.headers.get('x-sentry-rate-limit-remaining');
      logger.debug({ remaining, endpoint }, 'Sentry rate limit header');
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, url, errorText }, 'Sentry API request failed');
      throw new Error(`Sentry API Error (${response.status}): ${errorText || response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetches projects for a given Sentry organization.
   */
  public async getOrganizationProjects(organizationSlug: string): Promise<SentryRawProject[]> {
    return this.request<SentryRawProject[]>(`/organizations/${organizationSlug}/projects/`);
  }

  /**
   * Fetches unresolved issues for a Sentry organization project.
   */
  public async getProjectIssues(organizationSlug: string, projectSlug: string): Promise<SentryRawIssue[]> {
    return this.request<SentryRawIssue[]>(`/projects/${organizationSlug}/${projectSlug}/issues/?query=is:unresolved`);
  }

  /**
   * Fetches detailed metadata for a specific Sentry issue.
   */
  public async getIssueDetails(issueId: string): Promise<SentryRawIssue> {
    return this.request<SentryRawIssue>(`/issues/${issueId}/`);
  }
}
