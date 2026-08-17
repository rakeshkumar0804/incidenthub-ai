import React from 'react';
import type { TimeSeriesBucketDto } from '@incidenthub/shared';

interface IncidentTrendChartProps {
  timeSeries: TimeSeriesBucketDto[];
}

export const IncidentTrendChart: React.FC<IncidentTrendChartProps> = ({ timeSeries }) => {
  const maxCount = Math.max(...timeSeries.map((b) => b.count), 1);

  return (
    <div className="rounded-2xl border border-white/5 bg-gray-900/60 p-6 backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">Incident Volume Trend</h3>
          <p className="text-xs text-gray-400">Chronological incident frequency grouped by severity.</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-red-400 font-medium">
            <span className="h-2 w-2 rounded-full bg-red-500" /> SEV-1
          </span>
          <span className="flex items-center gap-1 text-amber-400 font-medium">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> SEV-2
          </span>
          <span className="flex items-center gap-1 text-blue-400 font-medium">
            <span className="h-2 w-2 rounded-full bg-blue-500" /> SEV-3/4
          </span>
        </div>
      </div>

      {timeSeries.length === 0 ? (
        <div className="py-12 text-center text-xs text-gray-500">No time-series data in window.</div>
      ) : (
        <div className="flex h-48 items-end gap-1 border-b border-white/10 pt-4 pb-2">
          {timeSeries.map((bucket, idx) => {
            const heightPercent = Math.max(Math.round((bucket.count / maxCount) * 100), bucket.count > 0 ? 8 : 2);
            return (
              <div key={idx} className="group relative flex flex-1 flex-col items-center justify-end h-full">
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 hidden rounded-lg bg-gray-800 p-2 text-[10px] text-gray-200 shadow-xl group-hover:block z-10 whitespace-nowrap border border-white/10">
                  <p className="font-semibold">{bucket.label}</p>
                  <p className="text-violet-400">Total: {bucket.count}</p>
                  <p className="text-red-400">SEV-1: {bucket.sev1Count}</p>
                  <p className="text-amber-400">SEV-2: {bucket.sev2Count}</p>
                </div>

                {/* Bar */}
                <div
                  style={{ height: `${heightPercent}%` }}
                  className={`w-full rounded-t transition-all ${
                    bucket.sev1Count > 0
                      ? 'bg-red-500 hover:bg-red-400'
                      : bucket.sev2Count > 0
                      ? 'bg-amber-500 hover:bg-amber-400'
                      : bucket.count > 0
                      ? 'bg-violet-600 hover:bg-violet-500'
                      : 'bg-gray-800/40'
                  }`}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
