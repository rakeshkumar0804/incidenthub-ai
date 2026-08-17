import React from 'react';
import type { ServiceRankingDto } from '@incidenthub/shared';

interface ServiceRankingTableProps {
  rankings: ServiceRankingDto[];
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms < 0) return 'N/A';
  const minutes = Math.round(ms / (60 * 1000));
  if (minutes < 60) return `${minutes}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export const ServiceRankingTable: React.FC<ServiceRankingTableProps> = ({ rankings }) => {
  return (
    <div className="rounded-2xl border border-white/5 bg-gray-900/60 p-6 backdrop-blur-sm">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-white">Service Reliability Rankings</h3>
        <p className="text-xs text-gray-400">Services ranked by incident concentration and resolution duration.</p>
      </div>

      {rankings.length === 0 ? (
        <div className="py-8 text-center text-xs text-gray-500">No service metrics recorded.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/10 text-gray-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-2 px-3">Service</th>
                <th className="py-2 px-3">Project</th>
                <th className="py-2 px-3 text-right">Incidents</th>
                <th className="py-2 px-3 text-right">SEV-1</th>
                <th className="py-2 px-3 text-right">Avg MTTR</th>
                <th className="py-2 px-3 text-right">Avg MTTD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rankings.map((svc) => (
                <tr key={svc.serviceId} className="hover:bg-white/[0.02]">
                  <td className="py-3 px-3 font-semibold text-gray-200">{svc.serviceName}</td>
                  <td className="py-3 px-3 text-gray-400">{svc.projectName}</td>
                  <td className="py-3 px-3 text-right font-mono text-gray-200">{svc.totalIncidents}</td>
                  <td className="py-3 px-3 text-right font-mono text-red-400">{svc.sev1Count}</td>
                  <td className="py-3 px-3 text-right font-mono text-gray-300">{formatDurationMs(svc.mttrMs)}</td>
                  <td className="py-3 px-3 text-right font-mono text-gray-400">{formatDurationMs(svc.mttdMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
