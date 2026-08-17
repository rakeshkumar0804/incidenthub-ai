import React from 'react';
import type { EngineeringSignalDto } from '@incidenthub/shared';

interface IntelligenceSignalsSectionProps {
  signals: EngineeringSignalDto[];
}

export const IntelligenceSignalsSection: React.FC<IntelligenceSignalsSectionProps> = ({ signals }) => {
  return (
    <div className="rounded-2xl border border-white/5 bg-gray-900/60 p-6 backdrop-blur-sm">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-white">Engineering Intelligence Signals</h3>
        <p className="text-xs text-gray-400">Automated reliability signals derived from operational data.</p>
      </div>

      {signals.length === 0 ? (
        <div className="py-8 text-center text-xs text-gray-500">No active engineering risk signals detected in window.</div>
      ) : (
        <div className="space-y-3">
          {signals.map((sig) => (
            <div
              key={sig.id}
              className={`rounded-xl border p-4 text-xs ${
                sig.severity === 'HIGH'
                  ? 'border-red-500/20 bg-red-500/5'
                  : sig.severity === 'MEDIUM'
                  ? 'border-amber-500/20 bg-amber-500/5'
                  : 'border-blue-500/20 bg-blue-500/5'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    sig.severity === 'HIGH'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}>
                    {sig.severity} RISK
                  </span>
                  <span className="font-semibold text-gray-200">{sig.title}</span>
                </div>
                <span className="text-[10px] font-mono text-gray-400">{sig.type}</span>
              </div>
              <p className="mt-2 text-gray-300 leading-relaxed">{sig.description}</p>
              {sig.provenance.incidentIds.length > 0 && (
                <p className="mt-2 text-[10px] text-gray-400">
                  Source Provenance: {sig.provenance.incidentIds.length} incident records
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
