import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../features/auth/AuthContext';
import { apiClient } from '../lib/axios';
import { OrgRole } from '@incidenthub/shared';
import type { ApiSuccess, TeamDto } from '@incidenthub/shared';

export function TeamsPage() {
  const { activeOrg } = useAuth();
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchTeams = useCallback(async () => {
    if (!activeOrg) return;
    setIsLoading(true);
    try {
      const { data } = await apiClient.get<ApiSuccess<TeamDto[]>>(
        `/organizations/${activeOrg.organizationId}/teams`,
        { headers: { 'x-organization-id': activeOrg.organizationId } },
      );
      if (data.success) {
        setTeams(data.data);
      }
    } catch {
      // Ignore errors
    } finally {
      setIsLoading(false);
    }
  }, [activeOrg]);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;
    setErrorMsg(null);
    setIsCreating(true);

    try {
      const { data } = await apiClient.post<ApiSuccess<TeamDto>>(
        `/organizations/${activeOrg.organizationId}/teams`,
        { name, description },
        { headers: { 'x-organization-id': activeOrg.organizationId } },
      );

      if (data.success) {
        setName('');
        setDescription('');
        setIsModalOpen(false);
        await fetchTeams();
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to create team.');
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
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Teams</h1>
          <p className="mt-1 text-sm text-gray-400">Organize engineers into functional teams (Frontend, Backend, DevOps, SRE)</p>
        </div>

        {isOwnerOrAdmin && (
          <button
            onClick={() => {
              setErrorMsg(null);
              setIsModalOpen(true);
            }}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500"
          >
            + Create Team
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading teams...</div>
      ) : teams.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((t) => (
            <div key={t.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white">{t.name}</h3>
                <span className="rounded bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 text-[10px] font-bold text-blue-300">
                  {t.memberCount ?? 0} members
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-400 min-h-[32px]">
                {t.description || 'No description provided.'}
              </p>

              <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
                <span>Projects: {t.memberCount ?? 0}</span>
                <span className="text-[10px]">Created {new Date(t.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center text-sm text-gray-400">No teams created in this workspace yet.</div>
      )}

      {/* Create Team Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white">Create Team</h2>
            <p className="mt-1 text-xs text-gray-400">Add a new team to your organization</p>

            {errorMsg && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                {errorMsg}
              </div>
            )}

            <form onSubmit={(e) => void handleCreateTeam(e)} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Team Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Frontend Engineering"
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the team's responsibilities"
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
                />
              </div>

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
                  {isCreating ? 'Creating...' : 'Create Team'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
