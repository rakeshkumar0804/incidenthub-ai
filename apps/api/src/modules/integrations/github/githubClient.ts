import { logger } from '../../../utils/logger';

export interface GitHubApiRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
  html_url: string;
  description: string | null;
  private: boolean;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string | null;
}

export interface GitHubApiCommit {
  sha: string;
  commit: {
    author: { name: string; email: string; date: string };
    message: string;
  };
  html_url: string;
}

export interface GitHubApiPullRequest {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  head: { ref: string };
  base: { ref: string };
  html_url: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

export interface GitHubApiDeployment {
  id: number;
  environment: string;
  statuses_url: string;
  sha: string;
  creator: { login: string };
  created_at: string;
  updated_at: string;
}

export interface GitHubApiWorkflowRun {
  id: number;
  name: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_branch: string;
  head_sha: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubApiUser {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  type: string;
  avatar_url: string;
}

export class GitHubApiClient {
  private readonly token: string;
  private readonly baseUrl = 'https://api.github.com';

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(endpoint: string): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'User-Agent': 'IncidentHub-AI',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining && parseInt(remaining, 10) < 5) {
        logger.warn({ remaining, endpoint }, 'GitHub API rate limit is low');
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          logger.warn({ status: response.status, endpoint }, 'GitHub API unauthorized or forbidden');
          throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
        }
        if (response.status === 404) {
          logger.warn({ endpoint }, 'GitHub resource not found');
          throw new Error(`GitHub API Resource Not Found (404)`);
        }
        throw new Error(`GitHub API Error: ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (err) {
      logger.error({ err, endpoint }, 'GitHub API request failed');
      throw err;
    }
  }

  /**
   * Fetches authenticated GitHub user profile (validates PAT / token identity).
   */
  public async getAuthenticatedUser(): Promise<GitHubApiUser> {
    return this.request<GitHubApiUser>('/user');
  }

  /**
   * Fetches user/org repositories accessible by the token / installation.
   */
  public async getRepositories(): Promise<GitHubApiRepo[]> {
    try {
      // Try /user/repos or /installation/repositories
      const data = await this.request<GitHubApiRepo[] | { repositories: GitHubApiRepo[] }>('/user/repos?per_page=100&sort=updated');
      if (Array.isArray(data)) {
        return data;
      }
      if ('repositories' in data && Array.isArray(data.repositories)) {
        return data.repositories;
      }
      return [];
    } catch {
      // Fallback for installation token
      const data = await this.request<{ repositories: GitHubApiRepo[] }>('/installation/repositories?per_page=100');
      return data.repositories || [];
    }
  }

  /**
   * Fetches recent commits for a repository.
   */
  public async getCommits(owner: string, repo: string): Promise<GitHubApiCommit[]> {
    return this.request<GitHubApiCommit[]>(`/repos/${owner}/${repo}/commits?per_page=30`);
  }

  /**
   * Fetches pull requests for a repository.
   */
  public async getPullRequests(owner: string, repo: string): Promise<GitHubApiPullRequest[]> {
    return this.request<GitHubApiPullRequest[]>(`/repos/${owner}/${repo}/pulls?state=all&per_page=30`);
  }

  /**
   * Fetches deployments for a repository.
   */
  public async getDeployments(owner: string, repo: string): Promise<GitHubApiDeployment[]> {
    return this.request<GitHubApiDeployment[]>(`/repos/${owner}/${repo}/deployments?per_page=30`);
  }

  /**
   * Fetches workflow runs for a repository.
   */
  public async getWorkflowRuns(owner: string, repo: string): Promise<GitHubApiWorkflowRun[]> {
    const data = await this.request<{ workflow_runs: GitHubApiWorkflowRun[] }>(`/repos/${owner}/${repo}/actions/runs?per_page=30`);
    return data.workflow_runs || [];
  }
}
