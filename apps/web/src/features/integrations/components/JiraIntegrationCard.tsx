import React, { useState } from 'react';
import { IntegrationService } from '@/services/integrationService';

interface Props {
  organizationId: string;
  isConnected: boolean;
  siteUrl?: string;
  onRefresh: () => void;
}

export const JiraIntegrationCard: React.FC<Props> = ({ organizationId, isConnected, siteUrl, onRefresh }) => {
  const [loading, setLoading] = useState(false);
  const [showApiTokenModal, setShowApiTokenModal] = useState(false);
  const [tokenInput, setTokenInput] = useState({ siteUrl: '', email: '', apiToken: '', defaultProjectKey: 'ENG' });

  const handleConnect3LO = async () => {
    try {
      setLoading(true);
      const url = await IntegrationService.getJiraConnectUrl(organizationId);
      window.location.href = url;
    } catch {
      setLoading(false);
    }
  };

  const handleConnectApiTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      await IntegrationService.connectJiraApiToken(organizationId, tokenInput);
      setShowApiTokenModal(false);
      onRefresh();
    } catch {
      // Error handled by Toast / state
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setLoading(true);
      await IntegrationService.disconnectJira(organizationId);
      onRefresh();
    } catch {
      // Error handled by state
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6 backdrop-blur">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 font-bold text-xl">
            J
          </div>
          <div>
            <h3 className="font-semibold text-gray-100 text-lg">Jira Integration</h3>
            <p className="text-sm text-gray-400">
              Push Action Items directly to Jira Cloud/Server issues and sync completion status automatically.
            </p>
          </div>
        </div>
        <span
          className={`px-3 py-1 text-xs font-semibold rounded-full ${
            isConnected ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-800 text-gray-400'
          }`}
        >
          {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
      </div>

      {isConnected && (
        <div className="mt-4 rounded-lg bg-gray-950/40 p-3 text-xs text-gray-300">
          Connected site: <span className="font-semibold text-blue-400">{siteUrl || 'https://atlassian.net'}</span>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        {isConnected ? (
          <button
            onClick={() => void handleDisconnect()}
            disabled={loading}
            className="rounded-lg bg-rose-600/20 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-600/30 transition"
          >
            {loading ? 'Disconnecting...' : 'Disconnect Jira'}
          </button>
        ) : (
          <>
            <button
              onClick={() => setShowApiTokenModal(true)}
              disabled={loading}
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 transition"
            >
              Connect with API Token
            </button>
            <button
              onClick={() => void handleConnect3LO()}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition shadow-md"
            >
              {loading ? 'Redirecting...' : 'Connect Jira OAuth 3LO'}
            </button>
          </>
        )}
      </div>

      {showApiTokenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-100 mb-2">Jira API Token Connection</h3>
            <p className="text-xs text-gray-400 mb-4">
              Enter your Atlassian site domain and API token for custom/development setups.
            </p>
            <form onSubmit={(e) => void handleConnectApiTokenSubmit(e)} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-400">Site URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://acme.atlassian.net"
                  value={tokenInput.siteUrl}
                  onChange={(e) => setTokenInput({ ...tokenInput, siteUrl: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-800 bg-gray-950 p-2 text-sm text-gray-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400">Account Email</label>
                <input
                  type="email"
                  required
                  placeholder="admin@acme.com"
                  value={tokenInput.email}
                  onChange={(e) => setTokenInput({ ...tokenInput, email: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-800 bg-gray-950 p-2 text-sm text-gray-200"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400">API Token</label>
                <input
                  type="password"
                  required
                  placeholder="ATATT3xFfGF0..."
                  value={tokenInput.apiToken}
                  onChange={(e) => setTokenInput({ ...tokenInput, apiToken: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-800 bg-gray-950 p-2 text-sm text-gray-200"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowApiTokenModal(false)}
                  className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                >
                  {loading ? 'Connecting...' : 'Save & Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
