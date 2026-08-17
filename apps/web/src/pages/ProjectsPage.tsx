import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { apiClient } from '../lib/axios';
import { ProjectStatus, PROJECT_STATUS_LABELS, OrgRole } from '@incidenthub/shared';
import type { ApiSuccess, ProjectDto, TeamDto } from '@incidenthub/shared';

export function ProjectsPage() {
  const { activeOrg } = useAuth();

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'ALL'>('ALL');
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>(ProjectStatus.ACTIVE);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchProjectsAndTeams = useCallback(async () => {
    if (!activeOrg) return;
    setIsLoading(true);
    try {
      const headers = { 'x-organization-id': activeOrg.organizationId };
      const url = statusFilter !== 'ALL'
        ? `/organizations/${activeOrg.organizationId}/projects?status=${statusFilter}`
        : `/organizations/${activeOrg.organizationId}/projects`;

      const [projRes, teamsRes] = await Promise.all([
        apiClient.get<ApiSuccess<ProjectDto[]>>(url, { headers }),
        apiClient.get<ApiSuccess<TeamDto[]>>(`/organizations/${activeOrg.organizationId}/teams`, { headers }).catch(() => null),
      ]);

      if (projRes.data.success) {
        setProjects(projRes.data.data);
      }
      if (teamsRes && teamsRes.data.success) {
        setTeams(teamsRes.data.data);
      }
    } catch {
      // Ignore errors
    } finally {
      setIsLoading(false);
    }
  }, [activeOrg, statusFilter]);

  useEffect(() => {
    void fetchProjectsAndTeams();
  }, [fetchProjectsAndTeams]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;
    setErrorMsg(null);
    setIsCreating(true);

    try {
      const { data } = await apiClient.post<ApiSuccess<ProjectDto>>(
        `/organizations/${activeOrg.organizationId}/projects`,
        {
          name,
          description,
          status,
          teamId: selectedTeamId || undefined,
        },
        { headers: { 'x-organization-id': activeOrg.organizationId } },
      );

      if (data.success) {
        setName('');
        setDescription('');
        setSelectedTeamId('');
        setIsModalOpen(false);
        await fetchProjectsAndTeams();
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to create project.');
      } else {
        setErrorMsg('Network error.');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const isOwnerOrAdmin = (activeOrg?.role as OrgRole) === OrgRole.OWNER || (activeOrg?.role as OrgRole) === OrgRole.ADMIN;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Projects Dashboard</h1>
          <p className="mt-1 text-sm text-gray-400">Products, services groups, and monitored application systems</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | 'ALL')}
            className="rounded-xl border border-white/10 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value={ProjectStatus.ACTIVE}>Active</option>
            <option value={ProjectStatus.PAUSED}>Paused</option>
            <option value={ProjectStatus.ARCHIVED}>Archived</option>
          </select>

          {isOwnerOrAdmin && (
            <button
              onClick={() => {
                setErrorMsg(null);
                setIsModalOpen(true);
              }}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500"
            >
              + Create Project
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading projects...</div>
      ) : projects.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div key={p.id} className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-white truncate">{p.name}</h3>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] font-bold ${
                      p.status === ProjectStatus.ACTIVE
                        ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                        : p.status === ProjectStatus.PAUSED
                        ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                        : 'bg-gray-500/20 border-gray-500/30 text-gray-400'
                    }`}
                  >
                    {PROJECT_STATUS_LABELS[p.status] || p.status}
                  </span>
                </div>

                <p className="mt-2 text-xs text-gray-400 min-h-[32px]">
                  {p.description || 'No description provided.'}
                </p>

                {p.team && (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-gray-900 px-2.5 py-1 text-[11px] text-gray-300">
                    <span className="text-gray-500">Team:</span>
                    <span className="font-semibold text-blue-400">{p.team.name}</span>
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between">
                <span className="text-xs text-gray-400">Services: <span className="font-semibold text-white">{p.serviceCount ?? 0}</span></span>
                <Link
                  to={`/projects/${p.id}/services`}
                  className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  Manage Services →
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center text-sm text-gray-400">No projects found for the selected filter.</div>
      )}

      {/* Create Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white">Create Project</h2>
            <p className="mt-1 text-xs text-gray-400">Add a new project to your workspace</p>

            {errorMsg && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                {errorMsg}
              </div>
            )}

            <form onSubmit={(e) => void handleCreateProject(e)} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Payment API"
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the project's purpose"
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Initial Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
                >
                  <option value={ProjectStatus.ACTIVE}>Active</option>
                  <option value={ProjectStatus.PAUSED}>Paused</option>
                  <option value={ProjectStatus.ARCHIVED}>Archived</option>
                </select>
              </div>

              {teams.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                    Associated Team (Optional)
                  </label>
                  <select
                    value={selectedTeamId}
                    onChange={(e) => setSelectedTeamId(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
                  >
                    <option value="">No team association</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-gray-300 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {isCreating ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
