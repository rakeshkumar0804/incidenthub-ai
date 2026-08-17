import React from 'react';
import type { DeploymentCorrelationDto } from '@incidenthub/shared';

interface DeploymentCorrelationSectionProps {
  correlations: DeploymentCorrelationDto[];
}

export const DeploymentCorrelationSection: React.FC<DeploymentCorrelationSectionProps> = ({ correlations }) => {
  return (
    <div className="rounded-2xl border border-white/5 bg-gray-900/60 p-6 backdrop-blur-sm">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-white">Candidate Deployment Associations</h3>
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/20">
            Temporal Candidate Association Only
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Rollouts temporally associated within the candidate window [-2h, +30m] of incident detection.
          <strong className="text-gray-300"> Note: Temporal association does not imply unverified causality.</strong>
        </p>
      </div>

      {correlations.length === 0 ? (
        <div className="py-8 text-center text-xs text-gray-500">No candidate associated deployments recorded in window.</div>
      ) : (
        <div className="space-y-3">
          {correlations.map((dep) => (
            <div key={dep.deploymentId} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-200">{dep.repositoryName}</span>
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono text-violet-400">
                    {dep.commitSha.substring(0, 7)}
                  </span>
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">
                    {dep.environment}
                  </span>
                </div>
                <span className="text-gray-400">{new Date(dep.deployedAt).toLocaleString()}</span>
              </div>

              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                  Candidate Associated Incidents ({dep.candidateAssociatedIncidentsCount})
                </p>
                {dep.candidateAssociatedIncidents.length === 0 ? (
                  <p className="text-[11px] text-gray-500">No candidate incidents linked to this rollout.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {dep.candidateAssociatedIncidents.map((inc) => (
                      <span key={inc.id} className="rounded bg-gray-800/80 px-2 py-1 text-[11px] text-gray-300 border border-white/5">
                        <strong className="text-red-400">INC-{inc.number}</strong>: {inc.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
