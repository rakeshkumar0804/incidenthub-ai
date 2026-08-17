import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InvestigationRunDto } from '@incidenthub/shared';
import { investigationService } from '../../../services/investigationService';

interface AIInvestigationSectionProps {
  organizationId: string;
  incidentId: string;
}

export const AIInvestigationSection: React.FC<AIInvestigationSectionProps> = ({
  organizationId,
  incidentId,
}) => {
  const queryClient = useQueryClient();
  const [latestRun, setLatestRun] = useState<InvestigationRunDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Monotonic fetch counter — prevents a stale/slow response from overwriting a newer result
  const fetchGenRef = useRef(0);

  const fetchInvestigation = async (silent = false) => {
    const gen = ++fetchGenRef.current;
    try {
      if (!silent) setIsLoading(true);
      setErrorMsg(null);
      const data = await investigationService.getLatestInvestigation(organizationId, incidentId);
      if (gen !== fetchGenRef.current) return;
      setLatestRun(data.latestRun);
    } catch (err: unknown) {
      if (gen !== fetchGenRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to fetch AI investigation';
      setErrorMsg(msg);
    } finally {
      if (gen === fetchGenRef.current && !silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchInvestigation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, incidentId]);

  const handleRunInvestigation = async () => {
    if (isRunning) return; // Prevent duplicate concurrent submissions
    try {
      setIsRunning(true);
      setErrorMsg(null);
      await investigationService.triggerInvestigation(organizationId, incidentId, 'MANUAL_REQUEST');
      // Silent refetch — does not wipe the rendered result while reloading
      await fetchInvestigation(true);
      void queryClient.invalidateQueries({ queryKey: ['investigation', incidentId] });
      void queryClient.invalidateQueries({ queryKey: ['timeline', incidentId] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI investigation execution failed';
      setErrorMsg(msg);
    } finally {
      setIsRunning(false);
    }
  };

  const getTierBadge = (tier: string | null) => {
    switch (tier) {
      case 'HIGH':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'MEDIUM':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'LOW':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      default:
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    }
  };

  return (
    <div className="rounded-2xl border border-purple-500/20 bg-purple-500/[0.02] p-6 shadow-xl backdrop-blur-sm">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/20 border border-purple-500/30 text-purple-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">AI Investigation Engine</h2>
              {latestRun?.confidenceTier && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${getTierBadge(latestRun.confidenceTier)}`}>
                  {latestRun.confidenceTier} CONFIDENCE ({Math.round((latestRun.confidence || 0) * 100)}%)
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              Evidence-grounded root cause analysis, risk evaluation &amp; mitigation steps.
              {latestRun?.completedAt && (
                <span className="ml-1 text-gray-500">
                  Last generated: {new Date(latestRun.completedAt).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleRunInvestigation()}
          disabled={isRunning}
          className="flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-purple-500/20 transition hover:bg-purple-500 disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Running AI investigation...</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              </svg>
              <span>Run AI Investigation</span>
            </>
          )}
        </button>
      </div>

      {/* Error Alert Banner */}
      {errorMsg && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          <span>AI investigation failed: {errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="ml-2 font-bold text-red-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
          <span>Synthesizing investigation findings...</span>
        </div>
      ) : !latestRun ? (
        <div className="py-8 text-center text-sm text-gray-500">
          No AI investigation generated yet. Click &quot;Run AI Investigation&quot; to synthesize evidence.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary & Probable Root Cause */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-purple-400">Incident Overview</h3>
              <p className="text-xs text-gray-300 leading-relaxed">{latestRun.incidentSummary}</p>
            </div>
            <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-purple-300">Probable Root Cause</h3>
              <p className="text-xs font-medium text-white leading-relaxed">{latestRun.probableRootCause}</p>
            </div>
          </div>

          {/* Supporting & Contradictory Evidence */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Supporting */}
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.02] p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Supporting Evidence ({Array.isArray(latestRun.supportingEvidence) ? latestRun.supportingEvidence.length : 0})
              </h3>
              {Array.isArray(latestRun.supportingEvidence) && latestRun.supportingEvidence.length > 0 ? (
                <div className="space-y-2">
                  {latestRun.supportingEvidence.map((item, idx) => (
                    <div key={idx} className="rounded-lg border border-emerald-500/10 bg-emerald-500/5 p-2.5 text-xs text-gray-300">
                      <p className="font-semibold text-emerald-300">{item.claim}</p>
                      <p className="mt-1 text-[11px] text-gray-400">{item.relevanceReason}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">No supporting evidence items cited.</p>
              )}
            </div>

            {/* Contradictory */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.02] p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Contradictory / Disproven Factors ({Array.isArray(latestRun.contradictoryEvidence) ? latestRun.contradictoryEvidence.length : 0})
              </h3>
              {Array.isArray(latestRun.contradictoryEvidence) && latestRun.contradictoryEvidence.length > 0 ? (
                <div className="space-y-2">
                  {latestRun.contradictoryEvidence.map((item, idx) => (
                    <div key={idx} className="rounded-lg border border-amber-500/10 bg-amber-500/5 p-2.5 text-xs text-gray-300">
                      <p className="font-semibold text-amber-300">{item.contradiction}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">No contradictory factors detected.</p>
              )}
            </div>
          </div>

          {/* Recommended Actions */}
          {Array.isArray(latestRun.recommendedActions) && latestRun.recommendedActions.length > 0 && (
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-purple-400">Recommended Remediation Steps</h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {latestRun.recommendedActions.map((act, idx) => (
                  <div key={idx} className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300 uppercase">
                        {act.priority}
                      </span>
                      <span className="text-[10px] text-gray-500 uppercase">{act.category}</span>
                    </div>
                    <p className="font-medium text-gray-200">{act.action}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risk, Uncertainty & Limitations */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="text-[10px] font-bold uppercase text-gray-400">Impact Assessment</span>
              <p className="mt-1 text-gray-300">{latestRun.impactAssessment || 'N/A'}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="text-[10px] font-bold uppercase text-gray-400">Risk Assessment</span>
              <p className="mt-1 text-gray-300">{latestRun.riskAssessment || 'N/A'}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="text-[10px] font-bold uppercase text-gray-400">Limitations &amp; Uncertainty</span>
              <p className="mt-1 text-gray-400">{latestRun.investigationLimitations || 'None noted'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
