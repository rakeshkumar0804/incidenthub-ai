import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../features/auth/AuthContext';
import {
  getSentryStatus,
  connectSentryOAuth,
  connectSentryToken,
  disconnectSentry,
  getSentryRules,
  createSentryRule,
  deleteSentryRule,
} from '../services/sentryService';
import { OrgRole } from '@incidenthub/shared';
import type { SentryIntegrationDto, SentryRuleDto } from '@incidenthub/shared';

export function SentrySettingsPage() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.organizationId ?? null;
  const currentRole = activeOrg?.role;
  const [integration, setIntegration] = useState<SentryIntegrationDto | null>(null);
  const [rules, setRules] = useState<SentryRuleDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Connection form state
  const [oauthCode, setOauthCode] = useState('');
  const [sentryToken, setSentryToken] = useState('');
  const [sentryOrgSlug, setSentryOrgSlug] = useState('');
  const [showTokenFallback, setShowTokenFallback] = useState(false);

  // New Rule form state
  const [ruleName, setRuleName] = useState('');
  const [environmentFilter, setEnvironmentFilter] = useState('production');
  const [minEventCount, setMinEventCount] = useState(10);
  const [minUserCount, setMinUserCount] = useState(5);
  const [levelFilter, setLevelFilter] = useState('error');
  const [mappedSeverity, setMappedSeverity] = useState<'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'>('SEV2');
  const [autoCreateIncident, setAutoCreateIncident] = useState(true);
  const [isCreatingRule, setIsCreatingRule] = useState(false);

  const isManager = currentRole === OrgRole.OWNER || currentRole === OrgRole.ADMIN;

  const loadData = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const [status, rulesData] = await Promise.all([
        getSentryStatus(orgId),
        getSentryRules(orgId),
      ]);
      setIntegration(status);
      setRules(rulesData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load Sentry integration settings';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleConnectOAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !oauthCode) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await connectSentryOAuth(orgId, {
        code: oauthCode,
        redirectUri: window.location.origin + '/settings/sentry/callback',
        sentryOrgSlug: sentryOrgSlug || undefined,
      });
      setIntegration(res);
      setSuccessMsg('Sentry connected via OAuth 2.0 successfully!');
      setOauthCode('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect Sentry OAuth';
      setErrorMsg(msg);
    }
  };

  const handleConnectToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !sentryToken || !sentryOrgSlug) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await connectSentryToken(orgId, sentryToken, sentryOrgSlug);
      setIntegration(res);
      setSuccessMsg('Sentry connected via Auth Token successfully!');
      setSentryToken('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect Sentry token';
      setErrorMsg(msg);
    }
  };

  const handleDisconnect = async () => {
    if (!orgId || !window.confirm('Disconnect Sentry integration and purge credentials?')) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await disconnectSentry(orgId);
      setIntegration(res);
      setSuccessMsg('Sentry integration disconnected');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to disconnect Sentry';
      setErrorMsg(msg);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !ruleName) return;
    setIsCreatingRule(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const newRule = await createSentryRule(orgId, {
        name: ruleName,
        environment: environmentFilter || null,
        minEventCount,
        minUserCount,
        levelFilter: levelFilter || null,
        mappedSeverity,
        autoCreateIncident,
      });
      setRules((prev) => [newRule, ...prev]);
      setSuccessMsg(`Trigger rule "${ruleName}" created successfully`);
      setRuleName('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create trigger rule';
      setErrorMsg(msg);
    } finally {
      setIsCreatingRule(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!orgId || !window.confirm('Delete this Sentry trigger rule?')) return;
    try {
      await deleteSentryRule(orgId, ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      setSuccessMsg('Trigger rule deleted');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete trigger rule';
      setErrorMsg(msg);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 text-center text-gray-400">
        Loading Sentry integration settings...
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
            <svg className="h-7 w-7 text-purple-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L2 22h20L12 2zm0 4.5l6.5 13H5.5L12 6.5z" />
            </svg>
            <h1 className="text-2xl font-bold text-white">Sentry Integration</h1>
          </div>
          <p className="mt-1 text-sm text-gray-400">
            Connect Sentry error monitoring to evaluate signals, enforce frequency & user threshold trigger rules, and correlate exceptions with IncidentHub AI.
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

      {/* Connection Status Banner */}
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
                {isConnected ? 'Sentry Connected' : 'Sentry Disconnected'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {isConnected
                  ? `Org: ${integration?.metadata?.sentryOrgSlug || 'Default'} · Auth: ${integration?.metadata?.authType || 'OAUTH'} · Scopes: org:read, project:read, event:read`
                  : 'Authorize IncidentHub AI with Sentry to ingest exception signals & evaluate trigger rules.'}
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

      {/* Connection Form (If Disconnected) */}
      {!isConnected && isManager && (
        <div className="mb-8 space-y-6">
          <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.03] p-6 shadow-xl">
            <h3 className="text-base font-semibold text-white">Primary Setup: Sentry OAuth 2.0 Flow</h3>
            <p className="mt-1 text-sm text-gray-400">
              Authorize Sentry via OAuth 2.0. Credentials and tokens are encrypted at rest with AES-256-GCM server-side and never returned to the client.
            </p>

            <form onSubmit={(e) => { void handleConnectOAuth(e); }} className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Enter Sentry Organization Slug (e.g. acme-corp)"
                value={sentryOrgSlug}
                onChange={(e) => setSentryOrgSlug(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Enter Authorization Code"
                value={oauthCode}
                onChange={(e) => setOauthCode(e.target.value)}
                className="flex-1 rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                required
              />
              <button
                type="submit"
                className="rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-600/20 hover:bg-purple-500 transition-colors"
              >
                Connect Sentry OAuth
              </button>
            </form>

            <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
              <span className="text-xs text-gray-500">Connecting in local development or manual testing mode?</span>
              <button
                type="button"
                onClick={() => setShowTokenFallback(!showTokenFallback)}
                className="text-xs font-medium text-purple-400 hover:underline"
              >
                {showTokenFallback ? 'Hide Token Fallback' : 'Show Auth Token Fallback'}
              </button>
            </div>
          </div>

          {/* Optional Token Fallback Form */}
          {showTokenFallback && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-6 shadow-xl">
              <h3 className="text-sm font-semibold text-amber-400">Optional Fallback: Sentry Auth Token</h3>
              <p className="mt-1 text-xs text-gray-400">
                Provide a Sentry Internal Integration Auth Token (requires org:read, project:read, event:read).
              </p>

              <form onSubmit={(e) => { void handleConnectToken(e); }} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                <input
                  type="password"
                  placeholder="sntrys_xxxxxxxxxxxxxxxxxxxx"
                  value={sentryToken}
                  onChange={(e) => setSentryToken(e.target.value)}
                  className="flex-1 rounded-xl border border-white/10 bg-gray-900 px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none"
                  required
                />
                <button
                  type="submit"
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors"
                >
                  Connect Auth Token
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Trigger Rules Management Section */}
      {isConnected && (
        <div className="space-y-8">
          {/* Create Rule Form */}
          {isManager && (
            <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 shadow-xl">
              <h3 className="text-lg font-semibold text-white">Create Sentry Trigger Rule</h3>
              <p className="text-xs text-gray-400 mt-1">
                Configure threshold conditions to evaluate incoming Sentry exception signals before alerting or auto-creating incidents.
              </p>

              <form onSubmit={(e) => { void handleCreateRule(e); }} className="mt-6 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium text-gray-400">Rule Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Production Fatal Error Spike"
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-gray-900 px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-400">Environment Filter</label>
                    <select
                      value={environmentFilter}
                      onChange={(e) => setEnvironmentFilter(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-gray-900 px-3.5 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                    >
                      <option value="production">Production</option>
                      <option value="staging">Staging</option>
                      <option value="development">Development</option>
                      <option value="">All Environments</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-400">Level Filter</label>
                    <select
                      value={levelFilter}
                      onChange={(e) => setLevelFilter(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-gray-900 px-3.5 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                    >
                      <option value="error">Error & Fatal</option>
                      <option value="fatal">Fatal Only</option>
                      <option value="warning">Warning & Above</option>
                      <option value="">All Levels</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-400">Min Event Count</label>
                    <input
                      type="number"
                      min={1}
                      value={minEventCount}
                      onChange={(e) => setMinEventCount(parseInt(e.target.value, 10) || 1)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-gray-900 px-3.5 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-400">Min User Count</label>
                    <input
                      type="number"
                      min={1}
                      value={minUserCount}
                      onChange={(e) => setMinUserCount(parseInt(e.target.value, 10) || 1)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-gray-900 px-3.5 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-400">Mapped Severity</label>
                    <select
                      value={mappedSeverity}
                      onChange={(e) => setMappedSeverity(e.target.value as 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4')}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-gray-900 px-3.5 py-2 text-xs text-white focus:border-purple-500 focus:outline-none"
                    >
                      <option value="SEV1">SEV-1 (Critical)</option>
                      <option value="SEV2">SEV-2 (High)</option>
                      <option value="SEV3">SEV-3 (Medium)</option>
                      <option value="SEV4">SEV-4 (Low)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-white/5 pt-4">
                  <label className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={autoCreateIncident}
                      onChange={(e) => setAutoCreateIncident(e.target.checked)}
                      className="rounded border-white/20 bg-gray-900 text-purple-600 focus:ring-purple-500"
                    />
                    Automatically create an Incident when threshold rule passes
                  </label>

                  <button
                    type="submit"
                    disabled={isCreatingRule}
                    className="rounded-xl bg-purple-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-600/20 hover:bg-purple-500 transition-colors disabled:opacity-50"
                  >
                    {isCreatingRule ? 'Creating...' : '+ Create Rule'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Existing Trigger Rules List */}
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-white">Active Trigger Rules ({rules.length})</h3>

            {rules.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-500">
                No Sentry trigger rules configured yet. Create a rule above to evaluate error thresholds.
              </div>
            ) : (
              <div className="mt-4 divide-y divide-white/5">
                {rules.map((r) => (
                  <div key={r.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{r.name}</span>
                        <span className="rounded bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-400 border border-purple-500/20">
                          {r.mappedSeverity}
                        </span>
                        {r.autoCreateIncident && (
                          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                            Auto-Create Incident
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        Env: <code className="font-mono text-gray-300">{r.environment || 'ANY'}</code> · Min Events: {r.minEventCount} · Min Users: {r.minUserCount} · Level: {r.levelFilter || 'ANY'}
                      </p>
                    </div>

                    {isManager && (
                      <button
                        onClick={() => { void handleDeleteRule(r.id); }}
                        className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
