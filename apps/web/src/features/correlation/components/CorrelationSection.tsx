import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { correlationService } from '../../../services/correlationService';
import type { IncidentEvidenceDto, CorrelationRunDto } from '@incidenthub/shared';

interface Props {
  organizationId: string;
  incidentId: string;
}

export function CorrelationSection({ organizationId, incidentId }: Props) {
  const queryClient = useQueryClient();
  const [evidence, setEvidence] = useState<IncidentEvidenceDto[]>([]);
  const [latestRun, setLatestRun] = useState<CorrelationRunDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');

  // Monotonic fetch counter — prevents a stale/slow response from overwriting a newer result
  const fetchGenRef = useRef(0);

  const fetchEvidence = async (silent = false) => {
    const gen = ++fetchGenRef.current;
    try {
      if (!silent) setIsLoading(true);
      setErrorMsg(null);
      const res = await correlationService.getCorrelationEvidence(organizationId, incidentId);
      // Discard if a newer fetch has already started
      if (gen !== fetchGenRef.current) return;
      setEvidence(res.evidence);
      setLatestRun(res.latestRun);
    } catch (err: unknown) {
      if (gen !== fetchGenRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to load correlation evidence';
      setErrorMsg(msg);
    } finally {
      if (gen === fetchGenRef.current && !silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchEvidence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, incidentId]);

  const handleRunCorrelation = async () => {
    if (isRunning) return; // Prevent duplicate concurrent submissions
    try {
      setIsRunning(true);
      setErrorMsg(null);
      await correlationService.triggerCorrelation(organizationId, incidentId, 'MANUAL_REQUEST');
      // Silent refetch — does not reset the evidence list or show the loading spinner
      await fetchEvidence(true);
      void queryClient.invalidateQueries({ queryKey: ['correlation', incidentId] });
      void queryClient.invalidateQueries({ queryKey: ['timeline', incidentId] });
      void queryClient.invalidateQueries({ queryKey: ['incidents'] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to run correlation analysis';
      setErrorMsg(msg);
    } finally {
      setIsRunning(false);
    }
  };



  const handleAction = async (evidenceId: string, action: 'acknowledge' | 'dismiss' | 'reset') => {
    try {
      const updated = await correlationService.updateEvidenceStatus(organizationId, incidentId, evidenceId, action);
      setEvidence((prev) => prev.map((item) => (item.id === evidenceId ? updated : item)));
    } catch {
      // Ignore action errors
    }
  };

  const filteredEvidence = evidence.filter((item) => {
    if (selectedTier === 'ALL') return true;
    return item.confidenceTier === selectedTier;
  });

  const highCount = evidence.filter((e) => e.confidenceTier === 'HIGH').length;
  const mediumCount = evidence.filter((e) => e.confidenceTier === 'MEDIUM').length;
  const lowCount = evidence.filter((e) => e.confidenceTier === 'LOW').length;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 shadow-xl backdrop-blur-sm">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white">Deterministic Correlation Evidence</h2>
            {latestRun?.isTruncated && (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400 border border-amber-500/20">
                Truncated Cap Reached
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            Rule-based temporal, project, service, deployment & error signals.
            {latestRun?.completedAt && (
              <span className="ml-1 text-gray-500">
                Last run: {new Date(latestRun.completedAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleRunCorrelation()}
          disabled={isRunning}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500 disabled:opacity-50"
        >
          {isRunning ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Running correlation…</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Run Correlation</span>
            </>
          )}
        </button>
      </div>

      {/* Error Alert Banner */}
      {errorMsg && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-white font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* Tier Filter Tabs */}
      <div className="mb-6 flex items-center gap-2 border-b border-white/5 pb-3">
        {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((tier) => {
          const count = tier === 'ALL' ? evidence.length : tier === 'HIGH' ? highCount : tier === 'MEDIUM' ? mediumCount : lowCount;
          const isActive = selectedTier === tier;
          return (
            <button
              key={tier}
              type="button"
              onClick={() => setSelectedTier(tier)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              {tier === 'ALL' ? 'All Evidence' : `${tier} Confidence`} ({count})
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span>Loading evidence signals...</span>
        </div>
      ) : filteredEvidence.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          No correlation evidence found for this incident. Click &quot;Run Correlation&quot; to analyze.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEvidence.map((item) => {
            const isDismissed = Boolean(item.dismissedAt);
            const isAcknowledged = Boolean(item.acknowledgedAt);

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-4 transition ${
                  isDismissed
                    ? 'border-white/5 bg-gray-900/40 opacity-50'
                    : item.confidenceTier === 'HIGH'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : item.confidenceTier === 'MEDIUM'
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                          item.confidenceTier === 'HIGH'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : item.confidenceTier === 'MEDIUM'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {item.confidenceTier || 'LOW'} CONFIDENCE ({((item.confidence || 0) * 100).toFixed(0)}%)
                      </span>

                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-white hover:text-blue-400 transition"
                        >
                          {item.title}
                        </a>
                      ) : (
                        <span className="font-semibold text-white">{item.title}</span>
                      )}
                    </div>

                    {item.description && (
                      <p className="mt-1 text-xs text-gray-400">{item.description}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {isAcknowledged ? (
                      <button
                        type="button"
                        onClick={() => void handleAction(item.id, 'reset')}
                        className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/30"
                      >
                        ✓ Acknowledged
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleAction(item.id, 'acknowledge')}
                        className="rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gray-300 hover:bg-white/10"
                      >
                        Acknowledge
                      </button>
                    )}

                    {isDismissed ? (
                      <button
                        type="button"
                        onClick={() => void handleAction(item.id, 'reset')}
                        className="rounded-lg bg-gray-700/50 px-2.5 py-1 text-[11px] font-medium text-gray-400 hover:bg-gray-700"
                      >
                        Dismissed (Restore)
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleAction(item.id, 'dismiss')}
                        className="rounded-lg bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>

                {/* Reason Pills */}
                {item.reasons && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.reasons.deploymentRelation && (
                      <span className="rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-300 border border-purple-500/20">
                        Preceding Deployment
                      </span>
                    )}
                    {item.reasons.commitRelation && (
                      <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-300 border border-blue-500/20">
                        Included Commit
                      </span>
                    )}
                    {item.reasons.sentrySpike && (
                      <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300 border border-red-500/20">
                        Sentry Error Spike
                      </span>
                    )}
                    {item.reasons.workflowFailure && (
                      <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/20">
                        Workflow Failure
                      </span>
                    )}
                    {item.reasons.serviceMatch && (
                      <span className="rounded-md bg-teal-500/10 px-2 py-0.5 text-[10px] font-medium text-teal-300 border border-teal-500/20">
                        Service Match
                      </span>
                    )}
                    {item.reasons.temporalProximity && (
                      <span className="rounded-md bg-gray-500/10 px-2 py-0.5 text-[10px] font-medium text-gray-400 border border-gray-500/20">
                        Temporal Proximity
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
