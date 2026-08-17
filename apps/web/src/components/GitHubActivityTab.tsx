import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../features/auth/AuthContext';
import {
  getConnectedRepositories,
  getRepoCommits,
  getRepoPullRequests,
  getRepoDeployments,
  getRepoWorkflowRuns,
  linkActivityToIncident,
} from '../services/githubService';
import { OrgRole } from '@incidenthub/shared';
import type {
  GitHubRepositoryDto,
  GitHubCommitDto,
  GitHubPullRequestDto,
  GitHubDeploymentDto,
  GitHubWorkflowRunDto,
} from '@incidenthub/shared';

interface GitHubActivityTabProps {
  incidentId: string;
  projectId?: string;
  serviceId?: string | null;
  onActivityLinked?: () => void;
}

export function GitHubActivityTab({ incidentId, projectId, serviceId, onActivityLinked }: GitHubActivityTabProps) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.organizationId;
  const isViewer = activeOrg?.role === OrgRole.VIEWER;

  const [repositories, setRepositories] = useState<GitHubRepositoryDto[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'commits' | 'prs' | 'deployments' | 'workflows'>('commits');

  const [commits, setCommits] = useState<GitHubCommitDto[]>([]);
  const [prs, setPrs] = useState<GitHubPullRequestDto[]>([]);
  const [deployments, setDeployments] = useState<GitHubDeploymentDto[]>([]);
  const [workflows, setWorkflows] = useState<GitHubWorkflowRunDto[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchRepos = useCallback(async () => {
    if (!orgId) return;
    try {
      setIsLoading(true);
      const repos = await getConnectedRepositories(orgId);
      setRepositories(repos);

      // Auto-select repository linked to this service or project if available
      const matchingRepo = repos.find((r) => r.serviceId === serviceId || r.projectId === projectId) || repos[0];
      if (matchingRepo) {
        setSelectedRepoId(matchingRepo.id);
      }
    } catch {
      setRepositories([]);
    } finally {
      setIsLoading(false);
    }
  }, [orgId, projectId, serviceId]);

  useEffect(() => {
    void fetchRepos();
  }, [fetchRepos]);

  const fetchRepoActivity = useCallback(async () => {
    if (!orgId || !selectedRepoId) return;
    try {
      setIsLoading(true);
      if (activeTab === 'commits') {
        const data = await getRepoCommits(orgId, selectedRepoId).catch(() => []);
        setCommits(data);
      } else if (activeTab === 'prs') {
        const data = await getRepoPullRequests(orgId, selectedRepoId).catch(() => []);
        setPrs(data);
      } else if (activeTab === 'deployments') {
        const data = await getRepoDeployments(orgId, selectedRepoId).catch(() => []);
        setDeployments(data);
      } else if (activeTab === 'workflows') {
        const data = await getRepoWorkflowRuns(orgId, selectedRepoId).catch(() => []);
        setWorkflows(data);
      }
    } finally {
      setIsLoading(false);
    }
  }, [orgId, selectedRepoId, activeTab]);

  useEffect(() => {
    void fetchRepoActivity();
  }, [fetchRepoActivity]);

  const handleLinkActivity = async (
    activityType: 'GITHUB_COMMIT' | 'GITHUB_PR' | 'GITHUB_DEPLOYMENT' | 'GITHUB_WORKFLOW_RUN',
    activityId: string,
  ) => {
    if (!orgId) return;
    try {
      setLinkingId(activityId);
      setSuccessMsg(null);
      await linkActivityToIncident(orgId, incidentId, { activityType, activityId });
      setSuccessMsg('GitHub activity linked to incident timeline & evidence.');
      if (onActivityLinked) {
        onActivityLinked();
      }
    } catch {
      // Ignored
    } finally {
      setLinkingId(null);
    }
  };

  if (repositories.length === 0 && !isLoading) {
    return (
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-sm text-gray-400">
        No GitHub repositories connected yet. Go to Organization Settings → GitHub Integration to connect repositories.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-400">Repository:</label>
          <select
            value={selectedRepoId}
            onChange={(e) => setSelectedRepoId(e.target.value)}
            className="rounded-xl border border-white/10 bg-gray-900 px-3 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            {repositories.map((r) => (
              <option key={r.id} value={r.id}>
                {r.fullName}
              </option>
            ))}
          </select>
        </div>

        {/* Activity Tab Buttons */}
        <div className="flex items-center gap-1 rounded-xl bg-gray-900/80 p-1 border border-white/5">
          {(['commits', 'prs', 'deployments', 'workflows'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize transition-all ${
                activeTab === tab
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {successMsg && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400">
          {successMsg}
        </div>
      )}

      {/* Activity List */}
      <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4 shadow-xl">
        {isLoading ? (
          <div className="py-8 text-center text-xs text-gray-500">Loading GitHub activity...</div>
        ) : (
          <div className="divide-y divide-white/5">
            {/* COMMITS */}
            {activeTab === 'commits' &&
              (commits.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-500">No commits found for this repository.</div>
              ) : (
                commits.map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <a
                          href={c.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs font-semibold text-blue-400 hover:underline"
                        >
                          {c.sha.substring(0, 7)}
                        </a>
                        <span className="text-sm font-medium text-gray-200">{c.message.split('\n')[0]}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        Author: {c.authorName} · {new Date(c.committedAt).toLocaleString()}
                      </p>
                    </div>

                    {!isViewer && (
                      <button
                        onClick={() => { void handleLinkActivity('GITHUB_COMMIT', c.id); }}
                        disabled={linkingId === c.id}
                        className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                      >
                        {linkingId === c.id ? 'Linking...' : '+ Link to Incident'}
                      </button>
                    )}
                  </div>
                ))
              ))}

            {/* PULL REQUESTS */}
            {activeTab === 'prs' &&
              (prs.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-500">No pull requests found.</div>
              ) : (
                prs.map((pr) => (
                  <div key={pr.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                            pr.state === 'merged'
                              ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                              : pr.state === 'open'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border border-red-500/20'
                          }`}
                        >
                          {pr.state}
                        </span>
                        <a
                          href={pr.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-blue-400 hover:underline"
                        >
                          #{pr.number} {pr.title}
                        </a>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        Author: {pr.author} · {pr.branch} → {pr.targetBranch} · Updated {new Date(pr.updatedAt).toLocaleString()}
                      </p>
                    </div>

                    {!isViewer && (
                      <button
                        onClick={() => { void handleLinkActivity('GITHUB_PR', pr.id); }}
                        disabled={linkingId === pr.id}
                        className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                      >
                        {linkingId === pr.id ? 'Linking...' : '+ Link to Incident'}
                      </button>
                    )}
                  </div>
                ))
              ))}

            {/* DEPLOYMENTS */}
            {activeTab === 'deployments' &&
              (deployments.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-500">No deployments recorded.</div>
              ) : (
                deployments.map((d) => (
                  <div key={d.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-blue-500/10 text-blue-400 px-2 py-0.5 text-xs font-semibold border border-blue-500/20">
                          {d.environment}
                        </span>
                        <span className="text-sm font-medium text-gray-200">Commit: {d.commitSha.substring(0, 7)}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        Triggered by: {d.creator} · Created {new Date(d.createdAt).toLocaleString()}
                      </p>
                    </div>

                    {!isViewer && (
                      <button
                        onClick={() => { void handleLinkActivity('GITHUB_DEPLOYMENT', d.id); }}
                        disabled={linkingId === d.id}
                        className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                      >
                        {linkingId === d.id ? 'Linking...' : '+ Link to Incident'}
                      </button>
                    )}
                  </div>
                ))
              ))}

            {/* WORKFLOW RUNS */}
            {activeTab === 'workflows' &&
              (workflows.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-500">No Actions workflow runs found.</div>
              ) : (
                workflows.map((w) => (
                  <div key={w.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            w.conclusion === 'success'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : w.conclusion === 'failure'
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          {w.conclusion || w.status}
                        </span>
                        <a
                          href={w.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-blue-400 hover:underline"
                        >
                          {w.name}
                        </a>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        Event: {w.event} · Branch: {w.branch} · Commit: {w.commitSha.substring(0, 7)} · {new Date(w.createdAt).toLocaleString()}
                      </p>
                    </div>

                    {!isViewer && (
                      <button
                        onClick={() => { void handleLinkActivity('GITHUB_WORKFLOW_RUN', w.id); }}
                        disabled={linkingId === w.id}
                        className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                      >
                        {linkingId === w.id ? 'Linking...' : '+ Link to Incident'}
                      </button>
                    )}
                  </div>
                ))
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
