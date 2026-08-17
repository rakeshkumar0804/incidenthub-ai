import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { apiClient } from '../lib/axios';
import {
  IncidentSeverity,
  IncidentStatus,
  IncidentEnvironment,
  SEVERITY_LABELS,
  STATUS_LABELS,
  ENVIRONMENT_LABELS,
  OrgRole,
} from '@incidenthub/shared';
import type { IncidentDto, ProjectDto, PaginatedResponseData, ApiSuccess } from '@incidenthub/shared';

export const IncidentsPage: React.FC = () => {
  const { activeOrg } = useAuth();

  const [incidents, setIncidents] = useState<IncidentDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('ALL');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const isViewer = activeOrg?.role === OrgRole.VIEWER;

  useEffect(() => {
    if (!activeOrg) return;
    const fetchProjects = async () => {
      try {
        const res = await apiClient.get<ApiSuccess<ProjectDto[]>>(`/organizations/${activeOrg.organizationId}/projects`);
        setProjects(res.data.data);
      } catch {
        // Ignore
      }
    };
    void fetchProjects();
  }, [activeOrg]);

  useEffect(() => {
    if (!activeOrg) return;
    const fetchIncidents = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const params: Record<string, string | number> = {
          page,
          pageSize: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        };
        if (search.trim()) params['search'] = search.trim();
        if (selectedStatus !== 'ALL') params['status'] = selectedStatus;
        if (selectedSeverity !== 'ALL') params['severity'] = selectedSeverity;
        if (selectedEnvironment !== 'ALL') params['environment'] = selectedEnvironment;
        if (selectedProjectId !== 'ALL') params['projectId'] = selectedProjectId;

        const res = await apiClient.get<ApiSuccess<IncidentDto[]> & { pagination: PaginatedResponseData<IncidentDto>['pagination'] }>(
          `/organizations/${activeOrg.organizationId}/incidents`,
          { params },
        );
        setIncidents(res.data.data);
        setTotalPages(res.data.pagination.totalPages);
        setTotalItems(res.data.pagination.totalItems);
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && 'response' in err) {
          const resErr = err as { response?: { data?: { error?: { message?: string } } } };
          setErrorMsg(resErr.response?.data?.error?.message || 'Failed to fetch incidents');
        } else {
          setErrorMsg('Failed to fetch incidents');
        }
      } finally {
        setIsLoading(false);
      }
    };
    void fetchIncidents();
  }, [activeOrg, page, selectedStatus, selectedSeverity, selectedEnvironment, selectedProjectId, search]);

  const getSeverityBadgeClass = (severity: IncidentSeverity) => {
    switch (severity) {
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

  const getStatusBadgeClass = (status: IncidentStatus) => {
    switch (status) {
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Top Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Incidents Triage</h1>
          <p className="mt-1 text-sm text-gray-400">
            Monitor, investigate, and resolve production incidents across systems
          </p>
        </div>

        {!isViewer && (
          <Link
            to="/incidents/new"
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500"
          >
            + Create Incident
          </Link>
        )}
      </div>

      {errorMsg && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-400">
          {errorMsg}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="mb-6 space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm">
        {/* Search Bar & Filters */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5">
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="Search by title, description, or INC-0001..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-white/10 bg-gray-900/60 px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <select
            value={selectedSeverity}
            onChange={(e) => {
              setSelectedSeverity(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-white/10 bg-gray-900/60 px-3 py-2 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
          >
            <option value="ALL">All Severities</option>
            {Object.values(IncidentSeverity).map((sev) => (
              <option key={sev} value={sev}>
                {SEVERITY_LABELS[sev]}
              </option>
            ))}
          </select>

          <select
            value={selectedEnvironment}
            onChange={(e) => {
              setSelectedEnvironment(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-white/10 bg-gray-900/60 px-3 py-2 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
          >
            <option value="ALL">All Environments</option>
            {Object.values(IncidentEnvironment).map((env) => (
              <option key={env} value={env}>
                {ENVIRONMENT_LABELS[env]}
              </option>
            ))}
          </select>

          <select
            value={selectedProjectId}
            onChange={(e) => {
              setSelectedProjectId(e.target.value);
              setPage(1);
            }}
            className="rounded-xl border border-white/10 bg-gray-900/60 px-3 py-2 text-xs text-gray-300 focus:border-blue-500 focus:outline-none"
          >
            <option value="ALL">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Status Tabs */}
        <div className="flex flex-wrap gap-2 border-t border-white/5 pt-3">
          {['ALL', ...Object.values(IncidentStatus)].map((st) => (
            <button
              key={st}
              onClick={() => {
                setSelectedStatus(st);
                setPage(1);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                selectedStatus === st
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              {st === 'ALL' ? 'All Statuses' : STATUS_LABELS[st as IncidentStatus]}
            </button>
          ))}
        </div>
      </div>

      {/* Incidents List */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading incidents...</div>
      ) : incidents.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
          <p className="text-sm font-semibold text-gray-300">No incidents match your criteria</p>
          <p className="mt-1 text-xs text-gray-500">Try adjusting your filters or search query</p>
        </div>
      ) : (
        <div className="space-y-4">
          {incidents.map((inc) => (
            <Link
              key={inc.id}
              to={`/incidents/${inc.id}`}
              className="group block rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/[0.05]"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {/* Left info */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-bold text-blue-400">{inc.incidentNumber}</span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${getSeverityBadgeClass(
                        inc.severity,
                      )}`}
                    >
                      {SEVERITY_LABELS[inc.severity]}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${getStatusBadgeClass(
                        inc.status,
                      )}`}
                    >
                      {STATUS_LABELS[inc.status]}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white group-hover:text-blue-300 transition">
                    {inc.title}
                  </h3>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400">
                    <span>Project: <strong className="text-gray-300">{inc.project?.name || '—'}</strong></span>
                    {inc.service && <span>Service: <strong className="text-gray-300">{inc.service.name}</strong></span>}
                    <span>Env: <strong className="text-gray-300">{ENVIRONMENT_LABELS[inc.environment]}</strong></span>
                  </div>
                </div>

                {/* Right metadata */}
                <div className="text-right text-xs text-gray-400 space-y-1">
                  <div>Assigned: <strong className="text-gray-300">{inc.assignee?.name || 'Unassigned'}</strong></div>
                  <div className="text-[11px] text-gray-500">
                    Created {new Date(inc.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
            </Link>
          ))}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
              <span className="text-xs text-gray-400">
                Showing page {page} of {totalPages} ({totalItems} total incidents)
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
