import { useState, useEffect } from 'react';
import { useAuth } from '../features/auth/AuthContext';
import { apiClient } from '../lib/axios';
import { OrgRole } from '@incidenthub/shared';
import type { ApiSuccess } from '@incidenthub/shared';

interface OrgDetails {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  createdAt: string;
  memberCount: number;
  teamCount: number;
  projectCount: number;
  serviceCount: number;
}

export function OrganizationsPage() {
  const { activeOrg, organizations, setActiveOrgId } = useAuth();
  const [details, setDetails] = useState<OrgDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmSlugInput, setConfirmSlugInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrg) return;

    const fetchDetails = async () => {
      setIsLoading(true);
      try {
        const { data } = await apiClient.get<ApiSuccess<OrgDetails>>(`/organizations/${activeOrg.organizationId}`, {
          headers: { 'x-organization-id': activeOrg.organizationId },
        });
        if (data.success) {
          setDetails(data.data);
        }
      } catch {
        setDetails(null);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDetails();
  }, [activeOrg]);

  const handleDelete = async () => {
    if (!activeOrg || !details) return;
    setErrorMsg(null);
    setIsDeleting(true);

    try {
      const { data } = await apiClient.delete<ApiSuccess<{ message: string }>>(
        `/organizations/${activeOrg.organizationId}`,
        {
          headers: { 'x-organization-id': activeOrg.organizationId },
          data: { confirmSlug: confirmSlugInput },
        },
      );

      if (data.success) {
        window.location.href = '/';
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Deletion failed.');
      } else {
        setErrorMsg('Network error.');
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Organization Management</h1>
        <p className="mt-1 text-sm text-gray-400">View and manage your active workspace settings</p>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading organization details...</div>
      ) : activeOrg && details ? (
        <div className="space-y-8">
          {/* Active Workspace Stats Card */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-white">{details.name}</h2>
                  <span className="rounded bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 text-xs font-bold text-blue-300">
                    {activeOrg.role}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-400">Slug: <code className="text-blue-400 font-mono">{details.slug}</code></p>
              </div>

              <div className="flex items-center gap-4 text-center">
                <div className="rounded-xl border border-white/10 bg-gray-900 px-4 py-2">
                  <p className="text-lg font-bold text-white">{details.memberCount}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Members</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-gray-900 px-4 py-2">
                  <p className="text-lg font-bold text-white">{details.teamCount}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Teams</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-gray-900 px-4 py-2">
                  <p className="text-lg font-bold text-white">{details.projectCount}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Projects</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-gray-900 px-4 py-2">
                  <p className="text-lg font-bold text-white">{details.serviceCount}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wider">Services</p>
                </div>
              </div>
            </div>
          </div>

          {/* List of User's Workspaces */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="mb-4 text-base font-bold text-white">Your Organizations ({organizations.length})</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {organizations.map((org) => (
                <div
                  key={org.organizationId}
                  className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                    org.organizationId === activeOrg.organizationId
                      ? 'border-blue-500/50 bg-blue-500/10'
                      : 'border-white/10 bg-gray-900/60 hover:border-white/20'
                  }`}
                >
                  <div>
                    <h4 className="font-semibold text-white">{org.organization?.name || 'Workspace'}</h4>
                    <p className="text-xs text-gray-400">{org.organization?.slug || ''}</p>
                    <span className="mt-2 inline-block rounded bg-gray-800 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                      Role: {org.role}
                    </span>
                  </div>

                  {org.organizationId !== activeOrg.organizationId && (
                    <button
                      onClick={() => setActiveOrgId(org.organizationId)}
                      className="mt-4 rounded-lg bg-white/10 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                    >
                      Switch to Workspace
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Danger Zone: Protected Deletion for OWNER */}
          {activeOrg.role === OrgRole.OWNER && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
              <h3 className="text-base font-bold text-red-400">Danger Zone — Delete Organization</h3>
              <p className="mt-1 text-xs text-gray-400">
                Deleting an organization removes all linked teams, projects, services, and invitations. This action cannot be undone.
              </p>

              {errorMsg && (
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                  {errorMsg}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  value={confirmSlugInput}
                  onChange={(e) => setConfirmSlugInput(e.target.value)}
                  placeholder={`Type '${details.slug}' to confirm`}
                  className="rounded-xl border border-white/10 bg-gray-950 px-4 py-2 text-xs text-white placeholder-gray-500 outline-none focus:border-red-500"
                />
                <button
                  onClick={() => void handleDelete()}
                  disabled={isDeleting || confirmSlugInput !== details.slug}
                  className="rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-red-500/25 transition hover:bg-red-500 disabled:opacity-40"
                >
                  {isDeleting ? 'Deleting...' : 'Permanently Delete Organization'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="py-12 text-center text-sm text-gray-400">No active organization selected.</div>
      )}
    </div>
  );
}
