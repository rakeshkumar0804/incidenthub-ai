import React from 'react';
import type { AnalyticsTimeWindow } from '@incidenthub/shared';

interface AnalyticsFilterBarProps {
  selectedWindow: AnalyticsTimeWindow;
  onWindowChange: (win: AnalyticsTimeWindow) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const AnalyticsFilterBar: React.FC<AnalyticsFilterBarProps> = ({
  selectedWindow,
  onWindowChange,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/5 bg-gray-900/60 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Time Range:</span>
        <div className="flex rounded-lg bg-gray-800 p-1">
          {(['24h', '7d', '30d', '90d'] as AnalyticsTimeWindow[]).map((win) => (
            <button
              key={win}
              type="button"
              onClick={() => onWindowChange(win)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                selectedWindow === win
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {win.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-700 disabled:opacity-50"
        >
          <svg className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {isRefreshing ? 'Refreshing...' : 'Force Refresh'}
        </button>
      </div>
    </div>
  );
};
