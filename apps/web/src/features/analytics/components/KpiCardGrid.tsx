import React from 'react';
import type { KpiOverviewDto } from '@incidenthub/shared';

interface KpiCardGridProps {
  overview: KpiOverviewDto;
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms < 0) return 'N/A';
  const minutes = Math.round(ms / (60 * 1000));
  if (minutes < 60) return `${minutes}m`;
  const hours = (minutes / 60).toFixed(1);
  return `${hours}h`;
}

export const KpiCardGrid: React.FC<KpiCardGridProps> = ({ overview }) => {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Card 1: Total Incidents */}
      <div className="rounded-2xl border border-white/5 bg-gray-900/60 p-5 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Incidents</span>
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-400 border border-violet-500/20">
            {overview.activeIncidents} Active
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">{overview.totalIncidents}</span>
          <span className="text-xs text-gray-400">incidents</span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-400">
          <span className="text-red-400 font-semibold">{overview.sev1Count} SEV-1</span>
          <span>·</span>
          <span className="text-amber-400 font-semibold">{overview.sev2Count} SEV-2</span>
        </div>
      </div>

      {/* Card 2: MTTD */}
      <div className="rounded-2xl border border-white/5 bg-gray-900/60 p-5 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">MTTD</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
            overview.mttd.status === 'OK' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-gray-800 text-gray-400 border-gray-700'
          }`}>
            {overview.mttd.status}
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">
            {formatDurationMs(overview.mttd.value)}
          </span>
          <span className="text-xs text-gray-400">avg detection</span>
        </div>
        <p className="mt-3 text-[11px] text-gray-400 line-clamp-2 italic title={overview.mttdDocumentationLabel}">
          &quot;{overview.mttdDocumentationLabel}&quot;
        </p>
      </div>

      {/* Card 3: MTTR */}
      <div className="rounded-2xl border border-white/5 bg-gray-900/60 p-5 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">MTTR</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
            overview.mttr.status === 'OK' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-gray-800 text-gray-400 border-gray-700'
          }`}>
            {overview.mttr.status}
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">
            {formatDurationMs(overview.mttr.value)}
          </span>
          <span className="text-xs text-gray-400">detection-to-resolution</span>
        </div>
        <p className="mt-3 text-[11px] text-gray-400">
          Resolved: <strong className="text-gray-200">{overview.resolvedIncidents}</strong> / {overview.totalIncidents}
        </p>
      </div>

      {/* Card 4: Change-Failure Rate (CFR) */}
      <div className="rounded-2xl border border-white/5 bg-gray-900/60 p-5 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Change-Failure Rate</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
            overview.cfr.status === 'OK' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-gray-800 text-gray-400 border-gray-700'
          }`}>
            {overview.cfr.status}
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">
            {overview.cfr.value !== null ? `${overview.cfr.value}%` : 'INSUFFICIENT_DATA'}
          </span>
          <span className="text-xs text-gray-400">candidate rollout link</span>
        </div>
        <p className="mt-3 text-[11px] text-gray-400">
          {overview.cfr.message || `${overview.associatedDeploymentsCount} associated rollouts out of ${overview.totalDeployments} deployments`}
        </p>
      </div>
    </div>
  );
};
