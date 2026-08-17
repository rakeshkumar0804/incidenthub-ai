import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { apiClient } from '../lib/axios';
import {
  IncidentSeverity,
  IncidentEnvironment,
  SEVERITY_LABELS,
  ENVIRONMENT_LABELS,
  OrgRole,
} from '@incidenthub/shared';
import type { IncidentDto, ProjectDto, ServiceDto, OrgMemberDto, ApiSuccess } from '@incidenthub/shared';

export const CreateIncidentPage: React.FC = () => {
  const navigate = useNavigate();
  const { activeOrg } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>(IncidentSeverity.SEV3);
  const [environment, setEnvironment] = useState<IncidentEnvironment>(IncidentEnvironment.PRODUCTION);
  const [projectId, setProjectId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [assignedToId, setAssignedToId] = useState('');

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [services, setServices] = useState<ServiceDto[]>([]);
  const [members, setMembers] = useState<OrgMemberDto[]>([]);

  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isViewer = activeOrg?.role === OrgRole.VIEWER;

  useEffect(() => {
    if (!activeOrg) return;
    const fetchProjectsAndMembers = async () => {
      setIsLoadingProjects(true);
      try {
        const [projRes, memRes] = await Promise.all([
          apiClient.get<ApiSuccess<ProjectDto[]>>(`/organizations/${activeOrg.organizationId}/projects`),
          apiClient.get<ApiSuccess<OrgMemberDto[]>>(`/organizations/${activeOrg.organizationId}/members`),
        ]);
        setProjects(projRes.data.data);
        if (projRes.data.data.length > 0 && projRes.data.data[0]) {
          setProjectId(projRes.data.data[0].id);
        }
        setMembers(memRes.data.data);
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && 'response' in err) {
          const resErr = err as { response?: { data?: { error?: { message?: string } } } };
          setErrorMsg(resErr.response?.data?.error?.message || 'Failed to load projects and workspace members');
        } else {
          setErrorMsg('Failed to load projects and workspace members');
        }
      } finally {
        setIsLoadingProjects(false);
      }
    };
    void fetchProjectsAndMembers();
  }, [activeOrg]);

  useEffect(() => {
    if (!projectId) {
      setServices([]);
      setServiceId('');
      return;
    }
    const fetchServices = async () => {
      try {
        const res = await apiClient.get<ApiSuccess<ServiceDto[]>>(`/projects/${projectId}/services`);
        setServices(res.data.data);
        setServiceId('');
      } catch {
        setServices([]);
      }
    };
    void fetchServices();
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;
    if (isViewer) {
      setErrorMsg('VIEWER role is read-only and cannot declare incidents.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const payload: Record<string, unknown> = {
        title,
        projectId,
        severity,
        environment,
      };
      if (description.trim()) payload['description'] = description.trim();
      if (serviceId) payload['serviceId'] = serviceId;
      if (assignedToId) payload['assignedToId'] = assignedToId;

      const res = await apiClient.post<ApiSuccess<IncidentDto>>(
        `/organizations/${activeOrg.organizationId}/incidents`,
        payload,
      );

      navigate(`/incidents/${res.data.data.id}`);
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMsg(resErr.response?.data?.error?.message || 'Failed to create incident');
      } else {
        setErrorMsg('Failed to create incident');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
            <Link to="/incidents" className="hover:text-white transition">
              Incidents
            </Link>
            <span>/</span>
            <span className="text-gray-200">Declare Incident</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Declare New Incident</h1>
          <p className="mt-1 text-sm text-gray-400">
            Create an active incident tracking record and notify responding engineers.
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-400">
          {errorMsg}
        </div>
      )}

      {isLoadingProjects ? (
        <div className="py-12 text-center text-sm text-gray-400">Loading form options...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
          <p className="text-sm font-semibold text-gray-300">No active projects found</p>
          <p className="mt-1 text-xs text-gray-500">
            You must create at least one Project in this workspace before declaring an incident.
          </p>
          <Link
            to={`/organizations/${activeOrg?.id}/projects`}
            className="mt-4 inline-block rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Create Project
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-sm">
          {/* Title */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-300">
              Incident Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. High latency and 500 error spikes on Payment Gateway"
              className="w-full rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-300">
              Description / Summary
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide initial observations, affected endpoints, or error symptoms..."
              className="w-full rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500"
            />
          </div>

          {/* Grid of Selects */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Severity */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                Severity Level *
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                className="w-full rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
              >
                {Object.values(IncidentSeverity).map((sev) => (
                  <option key={sev} value={sev}>
                    {SEVERITY_LABELS[sev]}
                  </option>
                ))}
              </select>
            </div>

            {/* Environment */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                Target Environment *
              </label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as IncidentEnvironment)}
                className="w-full rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
              >
                {Object.values(IncidentEnvironment).map((env) => (
                  <option key={env} value={env}>
                    {ENVIRONMENT_LABELS[env]}
                  </option>
                ))}
              </select>
            </div>

            {/* Project */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                Associated Project *
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Service */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                Affected Service (Optional)
              </label>
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
              >
                <option value="">None (Whole Project)</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-300">
              Assignee (Optional Responder)
            </label>
            <select
              value={assignedToId}
              onChange={(e) => setAssignedToId(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-gray-900 px-4 py-2.5 text-sm text-white outline-none focus:border-blue-500"
            >
              <option value="">Unassigned</option>
              {members.map((m) => m.user && (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name} ({m.user.email}) — {m.role}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
            <Link
              to="/incidents"
              className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-gray-300 hover:bg-white/5"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting || isViewer}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? 'Declaring Incident...' : 'Declare Incident'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
