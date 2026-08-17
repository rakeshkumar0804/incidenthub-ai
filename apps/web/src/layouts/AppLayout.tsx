import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { apiClient } from '../lib/axios';
import type { ApiSuccess, OrganizationDto } from '@incidenthub/shared';

export function AppLayout() {
  const { user, organizations, activeOrg, setActiveOrgId, refreshUser, logout } = useAuth();
  const location = useLocation();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setIsCreating(true);

    try {
      const { data } = await apiClient.post<ApiSuccess<{ organization: OrganizationDto }>>('/organizations', {
        name: newOrgName,
      });

      if (data.success) {
        setNewOrgName('');
        setIsModalOpen(false);
        await refreshUser();
        setActiveOrgId(data.data.organization.id);
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setCreateError(resErr.response?.data?.error?.message || 'Failed to create organization.');
      } else {
        setCreateError('Network error.');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const navLinks = [
    { label: 'Dashboard', path: '/' },
    { label: 'Incidents', path: '/incidents' },
    { label: 'Analytics', path: '/analytics' },
    { label: 'Organizations', path: '/organizations' },
    { label: 'Members', path: activeOrg ? `/organizations/${activeOrg.organizationId}/members` : '/members' },
    { label: 'Teams', path: activeOrg ? `/organizations/${activeOrg.organizationId}/teams` : '/teams' },
    { label: 'Projects', path: activeOrg ? `/organizations/${activeOrg.organizationId}/projects` : '/projects' },
    { label: 'GitHub', path: '/settings/github' },
    { label: 'Sentry', path: '/settings/sentry' },
    { label: 'Integrations', path: '/settings/integrations' },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Navigation Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-gray-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            {/* Brand Logo */}
            <Link to="/" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 shadow-md shadow-blue-500/20">
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-base font-bold text-white tracking-tight">IncidentHub AI</span>
            </Link>

            {/* Organization Context Switcher */}
            {activeOrg && (
              <div className="relative">
                <button
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs transition hover:bg-white/[0.08]"
                >
                  <span className="h-2 w-2 rounded-full bg-blue-400" />
                  <span className="font-semibold text-gray-200">{activeOrg.organization?.name || 'Workspace'}</span>
                  <span className="rounded bg-blue-500/20 border border-blue-500/30 px-1.5 py-0.2 text-[10px] font-bold text-blue-300">
                    {activeOrg.role}
                  </span>
                  <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Dropdown Menu */}
                {isDropdownOpen && (
                  <div className="absolute left-0 mt-2 w-64 rounded-xl border border-white/10 bg-gray-900 py-2 shadow-2xl z-50">
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Workspaces ({organizations.length})
                    </div>
                    {organizations.map((org) => (
                      <button
                        key={org.organizationId}
                        onClick={() => {
                          setActiveOrgId(org.organizationId);
                          setIsDropdownOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition ${
                          org.organizationId === activeOrg.organizationId
                            ? 'bg-blue-600/20 text-blue-300 font-semibold'
                            : 'text-gray-300 hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className="truncate">{org.organization?.name || 'Workspace'}</span>
                        <span className="text-[10px] font-medium text-gray-400">{org.role}</span>
                      </button>
                    ))}

                    <div className="my-1 border-t border-white/10" />

                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        setIsModalOpen(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-blue-400 hover:bg-white/[0.04]"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Create Organization
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Navigation Links */}
            <nav className="hidden md:flex items-center gap-1 ml-2">
              {navLinks.map((link) => {
                const isActive = location.pathname === link.path;
                return (
                  <Link
                    key={link.label}
                    to={link.path}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      isActive ? 'bg-white/10 text-white font-semibold' : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* User Menu */}
          {user && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-violet-600 text-xs font-bold text-white shadow-md">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-semibold text-gray-200">{user.name}</p>
                  <p className="text-[10px] text-gray-400">{user.email}</p>
                </div>
              </div>

              <button
                onClick={() => void logout()}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main>
        <Outlet />
      </main>

      {/* Create Organization Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white">Create Organization</h2>
            <p className="mt-1 text-xs text-gray-400">Establish a new multi-tenant workspace</p>

            {createError && (
              <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                {createError}
              </div>
            )}

            <form onSubmit={(e) => void handleCreateOrg(e)} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Organization Name
                </label>
                <input
                  type="text"
                  required
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="e.g. Acme Engineering"
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
                  {isCreating ? 'Creating...' : 'Create Workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
