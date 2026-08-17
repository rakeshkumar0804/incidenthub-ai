import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { apiClient } from '../lib/axios';
import { useIncidentSocket } from '../hooks/useIncidentSocket';
import { CommentsSection } from '../components/CommentsSection';
import { GitHubActivityTab } from '../components/GitHubActivityTab';
import { SentryErrorsTab } from '../components/SentryErrorsTab';
import { CorrelationSection } from '../features/correlation/components/CorrelationSection';
import { AIInvestigationSection } from '../features/investigation/components/AIInvestigationSection';
import { IncidentReplaySection } from '../features/replay/components/IncidentReplaySection';
import { PostmortemSection } from '../features/postmortem/components/PostmortemSection';
import {
  IncidentSeverity,
  IncidentStatus,
  SEVERITY_LABELS,
  STATUS_LABELS,
  ENVIRONMENT_LABELS,
  OrgRole,
} from '@incidenthub/shared';
import type { IncidentDto, IncidentTimelineEventDto, OrgMemberDto, ApiSuccess } from '@incidenthub/shared';

export const IncidentDetailPage: React.FC = () => {
  const { incidentId } = useParams<{ incidentId: string }>();
  const { activeOrg } = useAuth();

  const { status: socketStatus, viewers } = useIncidentSocket(incidentId);

  const [incident, setIncident] = useState<IncidentDto | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<IncidentTimelineEventDto[]>([]);
  const [members, setMembers] = useState<OrgMemberDto[]>([]);
  const [detailTab, setDetailTab] = useState<'timeline' | 'github' | 'sentry'>('timeline');

  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isViewer = activeOrg?.role === OrgRole.VIEWER;

  const fetchIncidentDetails = async (): Promise<void> => {
    if (!incidentId) return;
    try {
      const [incRes, timeRes] = await Promise.all([
        apiClient.get<ApiSuccess<IncidentDto>>(`/incidents/${incidentId}`),
        apiClient.get<ApiSuccess<IncidentTimelineEventDto[]>>(`/incidents/${incidentId}/timeline`),
      ]);
      setIncident(incRes.data.data);
      setTimelineEvents(timeRes.data.data);
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to load incident details');
      } else {
        setErrorMsg('Failed to load incident details');
      }
    }
  };

  useEffect(() => {
    if (!incidentId) return;
    setIsLoading(true);
    setErrorMsg(null);
    void fetchIncidentDetails().finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  useEffect(() => {
    if (!activeOrg) return;
    const fetchMembers = async () => {
      try {
        const res = await apiClient.get<ApiSuccess<OrgMemberDto[]>>(`/organizations/${activeOrg.organizationId}/members`);
        setMembers(res.data.data);
      } catch {
        // Ignore
      }
    };
    void fetchMembers();
  }, [activeOrg]);

  const handleStatusChange = async (newStatus: IncidentStatus) => {
    if (!incidentId || isViewer) return;
    setIsUpdating(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.patch<ApiSuccess<IncidentDto>>(`/incidents/${incidentId}/status`, {
        status: newStatus,
      });
      setIncident(res.data.data);
      await fetchIncidentDetails();
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to update incident status');
      } else {
        setErrorMsg('Failed to update incident status');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSeverityChange = async (newSeverity: IncidentSeverity) => {
    if (!incidentId || isViewer) return;
    setIsUpdating(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.patch<ApiSuccess<IncidentDto>>(`/incidents/${incidentId}/severity`, {
        severity: newSeverity,
      });
      setIncident(res.data.data);
      await fetchIncidentDetails();
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to update severity');
      } else {
        setErrorMsg('Failed to update severity');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAssigneeChange = async (newAssigneeId: string) => {
    if (!incidentId || isViewer) return;
    setIsUpdating(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.patch<ApiSuccess<IncidentDto>>(`/incidents/${incidentId}/assignee`, {
        assignedToId: newAssigneeId || null,
      });
      setIncident(res.data.data);
      await fetchIncidentDetails();
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to update assignee');
      } else {
        setErrorMsg('Failed to update assignee');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const getSeverityBadgeClass = (sev: IncidentSeverity) => {
    switch (sev) {
      case IncidentSeverity.SEV1:
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case IncidentSeverity.SEV2:
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case IncidentSeverity.SEV3:
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case IncidentSeverity.SEV4:
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getStatusBadgeClass = (st: IncidentStatus) => {
    switch (st) {
      case IncidentStatus.OPEN:
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case IncidentStatus.INVESTIGATING:
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case IncidentStatus.MITIGATING:
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case IncidentStatus.RESOLVED:
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-gray-400">Loading incident details...</div>;
  }

  if (errorMsg && !incident) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-400">
          <p className="text-sm font-semibold">{errorMsg}</p>
          <Link to="/incidents" className="mt-4 inline-block text-xs text-blue-400 underline">
            Back to Incidents
          </Link>
        </div>
      </div>
    );
  }

  if (!incident || !activeOrg) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Top Header & Real-Time Status Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
          <Link to="/incidents" className="hover:text-white transition">
            Incidents
          </Link>
          <span>/</span>
          <span className="text-blue-400">{incident.incidentNumber}</span>
        </div>

        {/* Real-time connection & Presence Indicators */}
        <div className="flex items-center gap-4">
          {/* Active Viewers Avatars */}
          <div className="flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900/80 px-3 py-1 text-xs text-gray-300">
            <span className="font-semibold text-gray-400">{viewers.length} active</span>
            <div className="flex -space-x-1.5 overflow-hidden">
              {viewers.slice(0, 4).map((v) => (
                <div
                  key={v.id}
                  title={`${v.name} (${v.email})`}
                  className="inline-block h-5 w-5 rounded-full ring-2 ring-gray-950 bg-brand-600/30 text-[10px] font-bold text-brand-300 text-center leading-5"
                >
                  {v.name.charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
          </div>

          {/* Socket Connection Status Badge */}
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`h-2 w-2 rounded-full ${
                socketStatus === 'connected'
                  ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                  : socketStatus === 'reconnecting'
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-xs text-gray-400 capitalize">{socketStatus}</span>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-400">
          {errorMsg}
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left Column: Details, Timeline, & Real-Time Comments */}
        <div className="space-y-6 lg:col-span-2">
          {/* Header Card */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm font-bold text-blue-400">{incident.incidentNumber}</span>
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${getSeverityBadgeClass(
                  incident.severity,
                )}`}
              >
                {SEVERITY_LABELS[incident.severity]}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${getStatusBadgeClass(
                  incident.status,
                )}`}
              >
                {STATUS_LABELS[incident.status]}
              </span>
            </div>

            <h1 className="mt-3 text-2xl font-bold tracking-tight text-white">{incident.title}</h1>

            <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-white/10 pt-4 text-xs text-gray-400">
              <div>
                Project: <strong className="text-gray-200">{incident.project?.name || '—'}</strong>
              </div>
              {incident.service && (
                <div>
                  Service: <strong className="text-gray-200">{incident.service.name}</strong>
                </div>
              )}
              <div>
                Environment: <strong className="text-gray-200">{ENVIRONMENT_LABELS[incident.environment]}</strong>
              </div>
            </div>
          </div>

          {/* Description Card */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Description</h2>
            <div className="mt-3 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
              {incident.description || 'No detailed description provided.'}
            </div>
          </div>

          {/* Phase 8 Correlation Engine Evidence Section */}
          <CorrelationSection organizationId={activeOrg.organizationId} incidentId={incident.id} />

          {/* Phase 9 AI Investigation Engine Section */}
          <AIInvestigationSection organizationId={activeOrg.organizationId} incidentId={incident.id} />

          {/* Phase 10 Incident Replay Engine Section */}
          <IncidentReplaySection organizationId={activeOrg.organizationId} incidentId={incident.id} />

          {/* Phase 11 AI Postmortem Engine Section */}
          <PostmortemSection organizationId={activeOrg.organizationId} incidentId={incident.id} isViewer={isViewer} />

          {/* Lifecycle Action Bar */}
          {!isViewer && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                Lifecycle State Control
              </h2>
              <div className="flex flex-wrap gap-3">
                {incident.status === IncidentStatus.OPEN && (
                  <>
                    <button
                      disabled={isUpdating}
                      onClick={() => void handleStatusChange(IncidentStatus.INVESTIGATING)}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-500 disabled:opacity-50"
                    >
                      Start Investigation →
                    </button>
                    <button
                      disabled={isUpdating}
                      onClick={() => void handleStatusChange(IncidentStatus.RESOLVED)}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Direct Resolve ✓
                    </button>
                  </>
                )}

                {incident.status === IncidentStatus.INVESTIGATING && (
                  <>
                    <button
                      disabled={isUpdating}
                      onClick={() => void handleStatusChange(IncidentStatus.MITIGATING)}
                      className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-amber-500/20 hover:bg-amber-500 disabled:opacity-50"
                    >
                      Apply Mitigation →
                    </button>
                    <button
                      disabled={isUpdating}
                      onClick={() => void handleStatusChange(IncidentStatus.RESOLVED)}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Resolve Incident ✓
                    </button>
                  </>
                )}

                {incident.status === IncidentStatus.MITIGATING && (
                  <button
                    disabled={isUpdating}
                    onClick={() => void handleStatusChange(IncidentStatus.RESOLVED)}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Mark as Resolved ✓
                  </button>
                )}

                {incident.status === IncidentStatus.RESOLVED && (
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2 rounded-xl">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Incident Resolved
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab Selector: Timeline & Discussion vs GitHub Telemetry vs Sentry Telemetry */}
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <button
              onClick={() => setDetailTab('timeline')}
              className={`rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                detailTab === 'timeline'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              Timeline & Discussion
            </button>
            <button
              onClick={() => setDetailTab('github')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                detailTab === 'github'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              GitHub Telemetry
            </button>
            <button
              onClick={() => setDetailTab('sentry')}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all ${
                detailTab === 'sentry'
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2L2 22h20L12 2zm0 4.5l6.5 13H5.5L12 6.5z" />
              </svg>
              Sentry Telemetry
            </button>
          </div>

          {detailTab === 'github' ? (
            <GitHubActivityTab
              incidentId={incident.id}
              projectId={incident.projectId}
              serviceId={incident.serviceId}
              onActivityLinked={() => void fetchIncidentDetails()}
            />
          ) : detailTab === 'sentry' ? (
            <SentryErrorsTab incidentId={incident.id} />
          ) : (
            <>
              {/* Incident Timeline */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-6">
                  Incident Audit Timeline ({timelineEvents.length} events)
                </h2>

                <div className="relative pl-8">
                  {/* Single continuous vertical connector line */}
                  {timelineEvents.length > 1 && (
                    <div className="absolute left-[5px] top-[10px] bottom-[10px] w-0.5 bg-blue-500/30" />
                  )}

                  <div className="space-y-4">
                    {timelineEvents.map((evt) => (
                      <div key={evt.id} className="relative">
                        {/* Circle Dot — absolutely positioned on the left */}
                        <div className="absolute -left-8 top-[4px] flex h-3 w-3 items-center justify-center rounded-full border-2 border-gray-900 bg-blue-500 shadow-sm z-10 ml-[5px]" />

                        {/* Event Content */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                          <p className="text-xs font-semibold text-white">{evt.message}</p>
                          <span className="text-[10px] text-gray-500 font-mono">
                            {new Date(evt.occurredAt).toLocaleString()}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                          <span className="rounded bg-white/5 border border-white/10 px-1.5 py-0.5 text-[10px] font-mono text-gray-300">
                            {evt.source}
                          </span>
                          {evt.user && <span>by {evt.user.name}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Real-time Comments Section */}
              <CommentsSection organizationId={activeOrg.organizationId} incidentId={incident.id} />
            </>
          )}
        </div>

        {/* Right Column: Metadata & Management Sidebar */}
        <div className="space-y-6">
          {/* Metadata Box */}
          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Incident Metadata</h3>

            {/* Severity Selector */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-400">Severity</label>
              {isViewer ? (
                <div className="text-xs font-semibold text-gray-200">{SEVERITY_LABELS[incident.severity]}</div>
              ) : (
                <select
                  disabled={isUpdating}
                  value={incident.severity}
                  onChange={(e) => void handleSeverityChange(e.target.value as IncidentSeverity)}
                  className="w-full rounded-xl border border-white/10 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  {Object.values(IncidentSeverity).map((sev) => (
                    <option key={sev} value={sev}>
                      {SEVERITY_LABELS[sev]}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Assignee Selector */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-400">Assignee</label>
              {isViewer ? (
                <div className="text-xs font-semibold text-gray-200">
                  {incident.assignee ? incident.assignee.name : 'Unassigned'}
                </div>
              ) : (
                <select
                  disabled={isUpdating}
                  value={incident.assignedToId || ''}
                  onChange={(e) => void handleAssigneeChange(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-gray-900 px-3 py-2 text-xs text-white outline-none focus:border-blue-500 disabled:opacity-50"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => m.user && (
                    <option key={m.user.id} value={m.user.id}>
                      {m.user.name} ({m.role})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="my-2 border-t border-white/10" />

            {/* Timestamps */}
            <div className="space-y-2 text-xs text-gray-400">
              <div className="flex justify-between">
                <span>Created:</span>
                <span className="text-gray-200">{new Date(incident.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Acknowledged:</span>
                <span className="text-gray-200">
                  {incident.acknowledgedAt ? new Date(incident.acknowledgedAt).toLocaleTimeString() : 'Not yet'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Resolved:</span>
                <span className="text-gray-200">
                  {incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleTimeString() : 'Not yet'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Reporter:</span>
                <span className="text-gray-200">{incident.createdBy?.name || 'System'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
