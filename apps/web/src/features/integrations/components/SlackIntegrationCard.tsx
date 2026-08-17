import React, { useState } from 'react';
import { IntegrationService } from '@/services/integrationService';

interface Props {
  organizationId: string;
  isConnected: boolean;
  teamName?: string;
  onRefresh: () => void;
}

export const SlackIntegrationCard: React.FC<Props> = ({ organizationId, isConnected, teamName, onRefresh }) => {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    try {
      setLoading(true);
      const url = await IntegrationService.getSlackConnectUrl(organizationId);
      window.location.href = url;
    } catch {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setLoading(true);
      await IntegrationService.disconnectSlack(organizationId);
      onRefresh();
    } catch {
      // Handled by state
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6 backdrop-blur">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 font-bold text-xl">
            #
          </div>
          <div>
            <h3 className="font-semibold text-gray-100 text-lg">Slack Integration</h3>
            <p className="text-sm text-gray-400">
              Dispatch incident alerts, create dedicated channels, and acknowledge incidents from Slack.
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
          Connected workspace: <span className="font-semibold text-emerald-400">{teamName || 'Active Workspace'}</span>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        {isConnected ? (
          <button
            onClick={() => void handleDisconnect()}
            disabled={loading}
            className="rounded-lg bg-rose-600/20 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-600/30 transition"
          >
            {loading ? 'Disconnecting...' : 'Disconnect Slack'}
          </button>
        ) : (
          <button
            onClick={() => void handleConnect()}
            disabled={loading}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 transition shadow-md"
          >
            {loading ? 'Redirecting to Slack...' : 'Connect Workspace'}
          </button>
        )}
      </div>
    </div>
  );
};
