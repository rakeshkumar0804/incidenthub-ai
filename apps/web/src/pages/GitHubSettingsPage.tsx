import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../features/auth/AuthContext';
import {
  getGitHubIntegration,
  connectGitHubApp,
  connectGitHubPat,
  disconnectGitHub,
  getConnectedRepositories,
  syncRepositories,
  linkRepository,
} from '../services/githubService';
import { apiClient } from '../lib/axios';
import { OrgRole } from '@incidenthub/shared';
import type {
  GitHubIntegrationDto,
  GitHubRepositoryDto,
  ProjectDto,
  ServiceDto,
  ApiSuccess,
} from '@incidenthub/shared';

export function GitHubSettingsPage() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.organizationId;
  const isManager = activeOrg?.role === OrgRole.OWNER || activeOrg?.role === OrgRole.ADMIN;

  const [integration, setIntegration] = useState<GitHubIntegrationDto | null>(null);
  const [repositories, setRepositories] = useState<GitHubRepositoryDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [services, setServices] = useState<ServiceDto[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // App Installation Input State
  const [installationId, setInstallationId] = useState<string>('');
  const [showPatFallback, setShowPatFallback] = useState<boolean>(false);
  const [patInput, setPatInput] = useState<string>('');

  const loadGitHubData = useCallback(async () => {
    if (!orgId) return;
    try {
      setIsLoading(true);
      setErrorMsg(null);

      const [integData, reposData, projRes] = await Promise.all([
        getGitHubIntegration(orgId),
        getConnectedRepositories(orgId).catch(() => []),
        apiClient.get<ApiSuccess<ProjectDto[]>>(`/organizations/${orgId}/projects`).catch(() => ({ data: { data: [] } })),
      ]);

      setIntegration(integData);
      setRepositories(reposData);
      setProjects(projRes.data.data);

      if (projRes.data.data.length > 0) {
        // Fetch services for first project as initial list
        const servRes = await apiClient
          .get<ApiSuccess<ServiceDto[]>>(`/projects/${projRes.data.data[0].id}/services`)
          .catch(() => ({ data: { data: [] } }));
        setServices(servRes.data.data);
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to load GitHub integration');
      } else {
        setErrorMsg('Failed to load GitHub integration');
      }
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadGitHubData();
  }, [loadGitHubData]);

  const handleConnectApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !installationId.trim()) return;
    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      const res = await connectGitHubApp(orgId, { installationId: installationId.trim() });
      setIntegration(res);
      setSuccessMsg('GitHub App connected successfully!');
      setInstallationId('');
      void handleSyncRepos();
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to connect GitHub App');
      } else {
        setErrorMsg('Failed to connect GitHub App');
      }
    }
  };

  const handleConnectPat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !patInput.trim()) return;
    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      const res = await connectGitHubPat(orgId, { personalAccessToken: patInput.trim() });
      setIntegration(res);
      setSuccessMsg('GitHub PAT connected (Dev Fallback)');
      setPatInput('');
      void handleSyncRepos();
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to connect PAT');
      } else {
        setErrorMsg('Failed to connect PAT');
      }
    }
  };

  const handleDisconnect = async () => {
    if (!orgId || !confirm('Are you sure you want to disconnect GitHub?')) return;
    try {
      setErrorMsg(null);
      const res = await disconnectGitHub(orgId);
      setIntegration(res);
      setRepositories([]);
      setSuccessMsg('GitHub integration disconnected.');
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to disconnect');
      } else {
        setErrorMsg('Failed to disconnect');
      }
    }
  };

  const handleSyncRepos = async () => {
    if (!orgId) return;
    try {
      setIsSyncing(true);
      setErrorMsg(null);
      const updatedRepos = await syncRepositories(orgId);
      setRepositories(updatedRepos);
      setSuccessMsg('Repositories synced successfully.');
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to sync repositories');
      } else {
        setErrorMsg('Failed to sync repositories');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLinkRepo = async (repoId: string, projectId: string | null, serviceId: string | null) => {
    if (!orgId) return;
    try {
      setErrorMsg(null);
      const updated = await linkRepository(orgId, repoId, { projectId, serviceId });
      setRepositories((prev) => prev.map((r) => (r.id === repoId ? updated : r)));
      setSuccessMsg(`Linked ${updated.name} successfully.`);
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to link repository');
      } else {
        setErrorMsg('Failed to link repository');
      }
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 text-center text-gray-400">
        Loading GitHub integration settings...
      </div>
    );
  }

  const isConnected = integration?.status === 'CONNECTED';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <svg className="h-7 w-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <h1 className="text-2xl font-bold text-white">GitHub Integration</h1>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Connect your GitHub organization & repositories to correlate commits, PRs, deployments, and Actions workflow runs with IncidentHub AI.
          </p>
        </div>

        {isConnected && isManager && (
          <button
            onClick={() => { void handleDisconnect(); }}
            className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Disconnect Integration
          </button>
        )}
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400">
          {successMsg}
        </div>
      )}

      {/* Integration Status Card */}
      <div className="mb-8 rounded-2xl border border-white/5 bg-white/[0.03] p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`h-3 w-3 rounded-full ${
                isConnected ? 'bg-emerald-500 shadow-lg shadow-emerald-500/50' : 'bg-gray-600'
              }`}
            />
            <div>
              <h2 className="text-base font-semibold text-white">
                {isConnected
                  ? `GitHub Connected ${integration?.metadata?.githubUsername ? `(@${integration.metadata.githubUsername})` : ''}`
                  : 'GitHub Disconnected'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {isConnected
                  ? `Auth Type: ${integration?.metadata?.authType || 'GITHUB_APP'}${integration?.metadata?.githubUsername ? ` · Identity: @${integration.metadata.githubUsername}` : ''} · Connected on ${new Date(integration?.createdAt || '').toLocaleDateString()}`
                  : 'Install the GitHub App or enter a Personal Access Token to enable repository syncing and real-time webhook telemetry.'}
              </p>
            </div>
          </div>

          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold border ${
              isConnected
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-gray-800 border-gray-700 text-gray-400'
            }`}
          >
            {integration?.status || 'DISCONNECTED'}
          </span>
        </div>
      </div>

      {/* Connection Flow Card (If Disconnected) */}
      {!isConnected && isManager && (
        <div className="mb-8 space-y-6">
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.03] p-6 shadow-xl">
            <h3 className="text-base font-semibold text-white">Primary Setup: GitHub App Installation</h3>
            <p className="mt-1 text-sm text-gray-400">
              Install the official IncidentHub AI GitHub App onto your GitHub account or organization. Tokens are automatically derived server-side. Private keys and installation secrets never reach the browser.
            </p>

            <form onSubmit={(e) => { e.preventDefault(); void handleConnectApp(e); }} className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Enter GitHub Installation ID (e.g. 58392014)"
                value={installationId}
                onChange={(e) => setInstallationId(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                required
              />
              <button
                type="submit"
                className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 transition-colors"
              >
                Connect GitHub App
              </button>
            </form>

            <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
              <span className="text-xs text-gray-500">Need to create or authorize your GitHub App?</span>
              <button
                type="button"
                onClick={() => setShowPatFallback(!showPatFallback)}
                className="text-xs font-medium text-blue-400 hover:underline"
              >
                {showPatFallback ? 'Hide PAT Fallback' : 'Show Optional PAT Fallback (Dev Only)'}
              </button>
            </div>
          </div>

          {/* Optional PAT Fallback Form */}
          {showPatFallback && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-6 shadow-xl">
              <h3 className="text-sm font-semibold text-amber-400">Optional Fallback: Personal Access Token (PAT)</h3>
              <p className="mt-1 text-xs text-gray-400">
                Used strictly for local development or manual testing. Token is stored AES-256-GCM encrypted server-side.
              </p>

              <form onSubmit={(e) => { e.preventDefault(); void handleConnectPat(e); }} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={patInput}
                  onChange={(e) => setPatInput(e.target.value)}
                  className="flex-1 rounded-xl border border-white/10 bg-gray-900 px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none"
                  required
                />
                <button
                  type="submit"
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors"
                >
                  Connect PAT
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Connected Repositories Section */}
      {isConnected && (
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 shadow-xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">Connected Repositories ({repositories.length})</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Link repositories to IncidentHub Projects & Services to correlate commits, PRs, deployments, and Actions workflows.
              </p>
            </div>

            {isManager && (
              <button
                onClick={() => { void handleSyncRepos(); }}
                disabled={isSyncing}
                className="flex items-center gap-2 rounded-xl bg-gray-800 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                <svg className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isSyncing ? 'Syncing...' : 'Sync Repositories'}
              </button>
            )}
          </div>

          {repositories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-800 py-12 text-center text-sm text-gray-500">
              No repositories imported yet. Click &quot;Sync Repositories&quot; above to fetch your connected GitHub repositories.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {repositories.map((repo) => (
                <div key={repo.id} className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <a
                        href={repo.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-base font-medium text-blue-400 hover:underline"
                      >
                        {repo.fullName}
                      </a>
                      {repo.isPrivate && (
                        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-semibold text-gray-400">
                          Private
                        </span>
                      )}
                    </div>
                    {repo.description && <p className="mt-1 text-xs text-gray-400">{repo.description}</p>}
                    <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                      <span>Default: <code className="font-mono text-gray-300">{repo.defaultBranch}</code></span>
                      {repo.language && <span>Lang: {repo.language}</span>}
                      <span>★ {repo.stargazersCount}</span>
                      <span>Forks: {repo.forksCount}</span>
                    </div>
                  </div>

                  {/* Project & Service Link Selectors */}
                  {isManager && (
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold uppercase text-gray-500">Linked Project</label>
                        <select
                          value={repo.projectId || ''}
                          onChange={(e) => {
                            void handleLinkRepo(repo.id, e.target.value || null, repo.serviceId);
                          }}
                          className="rounded-lg border border-white/10 bg-gray-900 px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Unlinked</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold uppercase text-gray-500">Linked Service</label>
                        <select
                          value={repo.serviceId || ''}
                          onChange={(e) => {
                            void handleLinkRepo(repo.id, repo.projectId, e.target.value || null);
                          }}
                          className="rounded-lg border border-white/10 bg-gray-900 px-3 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">Unlinked</option>
                          {services.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
