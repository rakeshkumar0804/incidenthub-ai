import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../features/auth/AuthContext';
import { getSentryIssues, linkSentryIssueToIncident } from '../services/sentryService';
import { OrgRole } from '@incidenthub/shared';
import type { SentryIssueDto } from '@incidenthub/shared';

interface SentryErrorsTabProps {
  incidentId: string;
}

export function SentryErrorsTab({ incidentId }: SentryErrorsTabProps) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.organizationId ?? null;
  const currentRole = activeOrg?.role;
  const [issues, setIssues] = useState<SentryIssueDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const isViewer = currentRole === OrgRole.VIEWER;

  const fetchIssues = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await getSentryIssues(orgId);
      setIssues(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch Sentry issues';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void fetchIssues();
  }, [fetchIssues]);

  const handleLinkIssue = async (sentryIssueId: string) => {
    if (!orgId) return;
    setLinkingId(sentryIssueId);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await linkSentryIssueToIncident(orgId, incidentId, sentryIssueId);
      setSuccessMsg('Sentry exception linked to incident evidence & timeline!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to link Sentry issue';
      setErrorMsg(msg);
    } finally {
      setLinkingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center text-xs text-gray-500">
        Loading Sentry exception signals...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">Sentry Telemetry Signals ({issues.length})</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Normalized Sentry exceptions, error frequencies, affected users, releases, and stack trace summaries.
          </p>
        </div>

        <button
          onClick={() => { void fetchIssues(); }}
          className="rounded-lg border border-white/10 bg-gray-900 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Messages */}
      {errorMsg && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-400">
          {successMsg}
        </div>
      )}

      {/* Issue List */}
      {issues.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-800 py-12 text-center text-xs text-gray-500">
          No Sentry exception signals ingested yet. Webhooks and trigger rules will automatically populate errors here.
        </div>
      ) : (
        <div className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          {issues.map((issue) => (
            <div key={issue.id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      issue.level === 'fatal'
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : issue.level === 'error'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                    }`}
                  >
                    {issue.level}
                  </span>

                  {issue.permalink ? (
                    <a
                      href={issue.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-purple-400 hover:underline"
                    >
                      {issue.title}
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-white">{issue.title}</span>
                  )}
                </div>

                {issue.culprit && <p className="mt-1 text-xs font-mono text-gray-400">{issue.culprit}</p>}

                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                  <span>Project: <code className="font-mono text-gray-300">{issue.projectSlug}</code></span>
                  <span>Env: <code className="font-mono text-gray-300">{issue.environment}</code></span>
                  <span>Events: <strong className="text-gray-300">{issue.eventCount}</strong></span>
                  <span>Affected Users: <strong className="text-gray-300">{issue.userCount}</strong></span>
                  {issue.release && <span>Release: <code className="font-mono text-gray-300">{issue.release}</code></span>}
                  <span>Last seen: {new Date(issue.lastSeen).toLocaleString()}</span>
                </div>
              </div>

              {!isViewer && (
                <button
                  onClick={() => { void handleLinkIssue(issue.id); }}
                  disabled={linkingId === issue.id}
                  className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                >
                  {linkingId === issue.id ? 'Linking...' : '+ Link to Incident'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
