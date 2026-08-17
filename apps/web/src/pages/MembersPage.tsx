import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../features/auth/AuthContext';
import { apiClient } from '../lib/axios';
import { OrgRole, ORG_ROLE_LABELS } from '@incidenthub/shared';
import type { ApiSuccess, OrgMemberDto, InvitationDto, CreateInvitationResponseDto } from '@incidenthub/shared';

export function MembersPage() {
  const { activeOrg } = useAuth();

  const [members, setMembers] = useState<OrgMemberDto[]>([]);
  const [invitations, setInvitations] = useState<InvitationDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Invite modal
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>(OrgRole.VIEWER);
  const [isInviting, setIsInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<CreateInvitationResponseDto | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Action states for dev URL in table
  const [copyingId, setCopyingId] = useState<string | null>(null);

  const fetchMembersAndInvitations = useCallback(async () => {
    if (!activeOrg) return;
    setIsLoading(true);
    try {
      const headers = { 'x-organization-id': activeOrg.organizationId };

      const [membersRes, invRes] = await Promise.all([
        apiClient.get<ApiSuccess<OrgMemberDto[]>>(`/organizations/${activeOrg.organizationId}/members`, { headers }),
        apiClient.get<ApiSuccess<InvitationDto[]>>(`/organizations/${activeOrg.organizationId}/invitations`, { headers }).catch(() => null),
      ]);

      if (membersRes.data.success) {
        setMembers(membersRes.data.data);
      }
      if (invRes && invRes.data.success) {
        setInvitations(invRes.data.data);
      }
    } catch {
      // Ignore errors
    } finally {
      setIsLoading(false);
    }
  }, [activeOrg]);

  useEffect(() => {
    void fetchMembersAndInvitations();
  }, [fetchMembersAndInvitations]);

  const handleRoleChange = async (memberId: string, newRole: OrgRole) => {
    if (!activeOrg) return;
    setErrorMsg(null);
    try {
      const { data } = await apiClient.patch<ApiSuccess<OrgMemberDto>>(
        `/organizations/${activeOrg.organizationId}/members/${memberId}`,
        { role: newRole },
        { headers: { 'x-organization-id': activeOrg.organizationId } },
      );
      if (data.success) {
        await fetchMembersAndInvitations();
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to change member role.');
      }
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!activeOrg) return;
    setErrorMsg(null);
    try {
      const { data } = await apiClient.delete<ApiSuccess<{ message: string }>>(
        `/organizations/${activeOrg.organizationId}/members/${memberId}`,
        { headers: { 'x-organization-id': activeOrg.organizationId } },
      );
      if (data.success) {
        await fetchMembersAndInvitations();
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to remove member.');
      }
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;
    setErrorMsg(null);
    setInviteResult(null);
    setIsInviting(true);

    try {
      const { data } = await apiClient.post<ApiSuccess<CreateInvitationResponseDto>>(
        `/organizations/${activeOrg.organizationId}/invitations`,
        { email: inviteEmail, role: inviteRole },
        { headers: { 'x-organization-id': activeOrg.organizationId } },
      );

      if (data.success) {
        setInviteResult(data.data);
        setInviteEmail('');
        await fetchMembersAndInvitations();
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to send invitation.');
      }
    } finally {
      setIsInviting(false);
    }
  };

  const handleOpenDevLink = async (invitationId: string) => {
    if (!activeOrg) return;
    setErrorMsg(null);
    try {
      const { data } = await apiClient.get<ApiSuccess<{ inviteUrl: string }>>(
        `/organizations/${activeOrg.organizationId}/invitations/${invitationId}/dev-url`,
        { headers: { 'x-organization-id': activeOrg.organizationId } },
      );
      if (data.success && data.data.inviteUrl) {
        window.open(data.data.inviteUrl, '_blank');
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to retrieve development invitation link.');
      }
    }
  };

  const handleCopyDevLink = async (invitationId: string) => {
    if (!activeOrg) return;
    setErrorMsg(null);
    setCopyingId(invitationId);
    try {
      const { data } = await apiClient.get<ApiSuccess<{ inviteUrl: string }>>(
        `/organizations/${activeOrg.organizationId}/invitations/${invitationId}/dev-url`,
        { headers: { 'x-organization-id': activeOrg.organizationId } },
      );
      if (data.success && data.data.inviteUrl) {
        await navigator.clipboard.writeText(data.data.inviteUrl);
        setTimeout(() => setCopyingId(null), 2000);
      }
    } catch (err: unknown) {
      setCopyingId(null);
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to copy development invitation link.');
      }
    }
  };

  const isOwnerOrAdmin = (activeOrg?.role as OrgRole) === OrgRole.OWNER || (activeOrg?.role as OrgRole) === OrgRole.ADMIN;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Members &amp; Access</h1>
          <p className="mt-1 text-sm text-gray-400">Manage user access and roles within this organization</p>
        </div>

        {isOwnerOrAdmin && (
          <button
            onClick={() => {
              setInviteResult(null);
              setErrorMsg(null);
              setIsInviteModalOpen(true);
            }}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500"
          >
            + Invite Member
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-400">
          {errorMsg}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading members...</div>
      ) : (
        <div className="space-y-8">
          {/* Members Table */}
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm">
            <div className="border-b border-white/10 px-6 py-4">
              <h2 className="text-base font-bold text-white">Active Members ({members.length})</h2>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 bg-gray-900/60 uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-6 py-3 font-semibold">User</th>
                  <th className="px-6 py-3 font-semibold">Email</th>
                  <th className="px-6 py-3 font-semibold">Role</th>
                  <th className="px-6 py-3 font-semibold">Joined</th>
                  {isOwnerOrAdmin && <th className="px-6 py-3 text-right font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-gray-300">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-white/[0.02]">
                    <td className="px-6 py-4 font-medium text-white flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600/30 font-bold text-blue-300">
                        {(m.user?.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      {m.user?.name || m.userId}
                    </td>
                    <td className="px-6 py-4 text-gray-400">{m.user?.email || '—'}</td>
                    <td className="px-6 py-4">
                      {isOwnerOrAdmin && m.role !== OrgRole.OWNER ? (
                        <select
                          value={m.role}
                          onChange={(e) => void handleRoleChange(m.id, e.target.value as OrgRole)}
                          className="rounded-lg border border-white/10 bg-gray-900 px-2 py-1 text-xs text-white outline-none focus:border-blue-500"
                        >
                          <option value={OrgRole.ADMIN}>Admin</option>
                          <option value={OrgRole.RESPONDER}>Responder</option>
                          <option value={OrgRole.VIEWER}>Viewer</option>
                          {activeOrg?.role === OrgRole.OWNER && <option value={OrgRole.OWNER}>Owner</option>}
                        </select>
                      ) : (
                        <span className="rounded bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 text-[10px] font-bold text-blue-300">
                          {ORG_ROLE_LABELS[m.role] || m.role}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-400">{new Date(m.joinedAt).toLocaleDateString()}</td>
                    {isOwnerOrAdmin && (
                      <td className="px-6 py-4 text-right">
                        {m.role !== OrgRole.OWNER && (
                          <button
                            onClick={() => void handleRemoveMember(m.id)}
                            className="text-red-400 hover:text-red-300 font-semibold"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pending Invitations Table */}
          {isOwnerOrAdmin && invitations.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="border-b border-white/10 px-6 py-4">
                <h2 className="text-base font-bold text-white">Pending Invitations ({invitations.length})</h2>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-white/10 bg-gray-900/60 uppercase tracking-wider text-gray-400">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Invited Email</th>
                    <th className="px-6 py-3 font-semibold">Assigned Role</th>
                    <th className="px-6 py-3 font-semibold">Status</th>
                    <th className="px-6 py-3 font-semibold">Expires</th>
                    <th className="px-6 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-gray-300">
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-white/[0.02]">
                      <td className="px-6 py-4 font-medium text-white">{inv.email}</td>
                      <td className="px-6 py-4 text-blue-300 font-semibold">{inv.role}</td>
                      <td className="px-6 py-4">
                        <span className="rounded bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-400">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => void handleOpenDevLink(inv.id)}
                            className="rounded-lg bg-blue-600/30 border border-blue-500/30 px-2.5 py-1 text-xs font-semibold text-blue-300 hover:bg-blue-600/50 transition"
                            title="Open development invitation link"
                          >
                            Open Link
                          </button>
                          <button
                            onClick={() => void handleCopyDevLink(inv.id)}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-white/10 transition"
                            title="Copy development invitation link"
                          >
                            {copyingId === inv.id ? 'Copied!' : 'Copy Link'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Invite Member Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white">Invite Team Member</h2>
            <p className="mt-1 text-xs text-gray-400">Send an invitation link to join this workspace</p>

            {inviteResult && (
              <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between text-emerald-400 font-bold">
                  <span>Invitation created successfully.</span>
                  <span className="rounded bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-300 uppercase">
                    Status: {inviteResult.invitation.status}
                  </span>
                </div>
                <div className="text-gray-300 space-y-1">
                  <p><span className="text-gray-400">Invited Email:</span> {inviteResult.invitation.email}</p>
                  <p><span className="text-gray-400">Assigned Role:</span> <span className="font-semibold text-blue-300">{inviteResult.invitation.role}</span></p>
                  <p><span className="text-gray-400">Expires:</span> {new Date(inviteResult.invitation.expiresAt).toLocaleDateString()}</p>
                </div>

                {inviteResult.inviteUrl && (
                  <div className="mt-3 pt-3 border-t border-emerald-500/20">
                    <span className="inline-block rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-bold px-2 py-0.5 uppercase mb-1">
                      Development Only Link
                    </span>
                    <p className="text-gray-400 text-[11px] mb-2">Click to open development invitation acceptance page:</p>
                    <a
                      href={inviteResult.inviteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition"
                    >
                      Open Invitation Link
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                )}
              </div>
            )}

            <form onSubmit={(e) => void handleSendInvite(e)} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                  Assign Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                  className="w-full rounded-xl border border-white/10 bg-gray-950 px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
                >
                  <option value={OrgRole.VIEWER}>Viewer (Read-only)</option>
                  <option value={OrgRole.RESPONDER}>Responder (Incident responder)</option>
                  <option value={OrgRole.ADMIN}>Admin (Workspace administrator)</option>
                  {activeOrg?.role === OrgRole.OWNER && <option value={OrgRole.OWNER}>Owner (Full control)</option>}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-gray-300 hover:bg-white/5"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isInviting}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {isInviting ? 'Inviting...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
