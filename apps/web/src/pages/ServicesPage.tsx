import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { apiClient } from '../lib/axios';
import { OrgRole } from '@incidenthub/shared';
import type { ApiSuccess, ServiceDto, ProjectDto } from '@incidenthub/shared';

export function ServicesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { activeOrg } = useAuth();

  const [project, setProject] = useState<ProjectDto | null>(null);
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchProjectAndServices = useCallback(async () => {
    if (!projectId) return;
    setIsLoading(true);
    try {
      const [projRes, servRes] = await Promise.all([
        apiClient.get<ApiSuccess<ProjectDto>>(`/projects/${projectId}`),
        apiClient.get<ApiSuccess<ServiceDto[]>>(`/projects/${projectId}/services`),
      ]);

      if (projRes.data.success) {
        setProject(projRes.data.data);
      }
      if (servRes.data.success) {
        setServices(servRes.data.data);
      }
    } catch {
      // Ignore errors
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchProjectAndServices();
  }, [fetchProjectAndServices]);

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setErrorMsg(null);
    setIsCreating(true);

    try {
      const { data } = await apiClient.post<ApiSuccess<ServiceDto>>(
        `/projects/${projectId}/services`,
        {
          name,
          description,
          repositoryUrl: repositoryUrl || undefined,
        },
      );

      if (data.success) {
        setName('');
        setDescription('');
        setRepositoryUrl('');
        setIsModalOpen(false);
        await fetchProjectAndServices();
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to create service.');
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
      <div className="mb-6 flex items-center gap-2 text-xs text-gray-400">
        <Link to="/projects" className="hover:text-white">Projects</Link>
        <span>/</span>
        <span className="text-white font-semibold">{project?.name || 'Project Services'}</span>
      </div>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{project?.name || 'Services'} — Deployable Units</h1>
          <p className="mt-1 text-sm text-gray-400">Services linked to GitHub repositories and Sentry error monitoring</p>
        </div>

        {isOwnerOrAdmin && (
          <button
            onClick={() => {
              setErrorMsg(null);
              setIsModalOpen(true);
            }}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500"
          >
            + Create Service
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading services...</div>
      ) : services.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white font-mono">{s.name}</h3>
                <span className="rounded bg-violet-500/20 border border-violet-500/30 px-2 py-0.5 text-[10px] font-bold text-violet-300">
                  Service
                </span>
              </div>

              <p className="mt-2 text-xs text-gray-400 min-h-[32px]">
                {s.description || 'No description provided.'}
              </p>

              {/* Integration Badges */}
              <div className="mt-4 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded bg-gray-900 border border-white/10 px-2 py-1 text-[10px] font-medium text-gray-300">
                  <svg className="h-3 w-3 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  {s.repositoryUrl ? 'GitHub Ready' : 'No GitHub Repo'}
                </span>

                <span className="inline-flex items-center gap-1 rounded bg-gray-900 border border-white/10 px-2 py-1 text-[10px] font-medium text-gray-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                  Sentry Webhook Ready
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center text-sm text-gray-400">No services created under this project yet.</div>
      )}

      {/* Create Service Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white">Create Deployable Service</h2>
            <p className="mt-1 text-xs text-gray-400">Add a deployable service unit (e.g. payment-api, auth-service)</p>

            {errorMsg && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                {errorMsg}
              </div>
            )}

            <form onSubmit={(e) => void handleCreateService(e)} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Service Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. payment-processor"
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white font-mono placeholder-gray-500 outline-none focus:border-blue-500"
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
                  placeholder="Describe what this service processes"
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  GitHub Repository URL (Optional)
                </label>
                <input
                  type="url"
                  value={repositoryUrl}
                  onChange={(e) => setRepositoryUrl(e.target.value)}
                  placeholder="https://github.com/acme/payment-api"
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white font-mono text-xs placeholder-gray-500 outline-none focus:border-blue-500"
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
                  {isCreating ? 'Creating...' : 'Create Service'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
