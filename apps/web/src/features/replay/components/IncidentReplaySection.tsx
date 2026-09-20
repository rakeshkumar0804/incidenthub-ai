import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReplayCategory } from '@incidenthub/shared';
import { replayService, type ReplayResponseData } from '../../../services/replayService';

interface IncidentReplaySectionProps {
  organizationId: string;
  incidentId: string;
  incidentDetectedAt?: string;
  incidentResolvedAt?: string | null;
}

export function formatSignedRelativeTime(
  targetTime: Date | number | string,
  anchorTime: Date | number | string,
): string {
  const targetMs = typeof targetTime === 'number' ? targetTime : new Date(targetTime).getTime();
  const anchorMs = typeof anchorTime === 'number' ? anchorTime : new Date(anchorTime).getTime();

  if (isNaN(targetMs) || isNaN(anchorMs)) {
    return 'T+0s';
  }

  const diffMs = targetMs - anchorMs;
  if (diffMs === 0) {
    return 'T+0s';
  }

  const isNegative = diffMs < 0;
  const sign = isNegative ? 'T−' : 'T+';
  const absDiffSec = Math.floor(Math.abs(diffMs) / 1000);

  if (absDiffSec === 0) {
    return isNegative ? 'T−1s' : 'T+1s';
  }

  if (absDiffSec < 60) {
    return `${sign}${absDiffSec}s`;
  }

  const absDiffMin = Math.floor(absDiffSec / 60);
  const remSec = absDiffSec % 60;

  if (absDiffMin < 60) {
    if (remSec > 0) {
      return `${sign}${absDiffMin}m ${remSec}s`;
    }
    return `${sign}${absDiffMin}m`;
  }

  const absDiffHours = Math.floor(absDiffMin / 60);
  const remMin = absDiffMin % 60;

  if (remMin > 0) {
    return `${sign}${absDiffHours}h ${remMin}m`;
  }
  return `${sign}${absDiffHours}h`;
}

export const IncidentReplaySection: React.FC<IncidentReplaySectionProps> = ({
  organizationId,
  incidentId,
  incidentDetectedAt,
}) => {
  const queryClient = useQueryClient();
  const [replayData, setReplayData] = useState<ReplayResponseData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ReplayCategory | 'ALL'>('ALL');

  // Playback state
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);

  const fetchIdRef = useRef<number>(0);

  const fetchReplay = async () => {
    const currentFetchId = ++fetchIdRef.current;
    try {
      setIsLoading(true);
      setActionError(null);
      const data = await replayService.getLatestReplay(organizationId, incidentId);

      // Prevent stale responses from overwriting newer state
      if (currentFetchId !== fetchIdRef.current) return;

      setReplayData(data);
      const events = data.latestCompletedRun?.events || [];
      if (events.length > 0) {
        setCurrentStepIndex(events.length - 1); // Default to final step
      }
    } catch (err: unknown) {
      if (currentFetchId !== fetchIdRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to fetch incident replay';
      setActionError(msg);
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    void fetchReplay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, incidentId]);

  const displayedRun = replayData?.latestCompletedRun;
  const allEvents = useMemo(() => displayedRun?.events || [], [displayedRun]);

  // Determine anchor timestamp for relative offset calculations
  const anchorTimestampMs = useMemo(() => {
    if (incidentDetectedAt) {
      const parsed = new Date(incidentDetectedAt).getTime();
      if (!isNaN(parsed)) return parsed;
    }
    const detectedEvt = allEvents.find((e) => e.eventType === 'INCIDENT_DETECTED');
    if (detectedEvt) return new Date(detectedEvt.timestamp).getTime();
    if (allEvents.length > 0 && allEvents[0]) return new Date(allEvents[0].timestamp).getTime();
    return Date.now();
  }, [incidentDetectedAt, allEvents]);

  // Check if events span multiple calendar dates
  const spansMultipleDates = useMemo(() => {
    if (allEvents.length < 2) return false;
    const first = allEvents[0];
    const last = allEvents[allEvents.length - 1];
    if (!first || !last) return false;
    const firstDate = new Date(first.timestamp).toISOString().slice(0, 10);
    const lastDate = new Date(last.timestamp).toISOString().slice(0, 10);
    return firstDate !== lastDate;
  }, [allEvents]);

  // Automated playback timer
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isPlaying && allEvents.length > 0) {
      const intervalMs = Math.max(150, 1500 / playbackSpeed);
      timer = setInterval(() => {
        setCurrentStepIndex((prev) => {
          if (prev >= allEvents.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, playbackSpeed, allEvents]);

  const handlePlayToggle = () => {
    if (!isPlaying) {
      // If at the end, loop restart from step 0
      if (currentStepIndex >= allEvents.length - 1) {
        setCurrentStepIndex(0);
      }
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  };

  const handleScrubberChange = (value: number) => {
    setIsPlaying(false); // Pause on scrubber drag
    setCurrentStepIndex(value);
  };

  const handleCategoryChange = (cat: ReplayCategory | 'ALL') => {
    setIsPlaying(false); // Pause on filter change
    setActiveCategory(cat);
  };

  const handleRunReplay = async () => {
    try {
      setIsTriggering(true);
      setActionError(null);
      await replayService.triggerReplay(organizationId, incidentId, 'MANUAL_REQUEST');
      await fetchReplay();
      void queryClient.invalidateQueries({ queryKey: ['timeline', incidentId] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Replay execution failed';
      setActionError(msg);
    } finally {
      setIsTriggering(false);
    }
  };

  const getCategoryBadgeClass = (category: ReplayCategory) => {
    switch (category) {
      case 'STATE_CHANGE':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'TELEMETRY':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'CORRELATION':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'INVESTIGATION':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'COMMUNICATION':
        return 'bg-pink-500/10 text-pink-400 border-pink-500/20';
      default:
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  const filteredEvents = useMemo(() => {
    if (activeCategory === 'ALL') return allEvents;
    return allEvents.filter((e) => e.category === activeCategory);
  }, [allEvents, activeCategory]);

  const visibleEvents = useMemo(() => {
    return filteredEvents.slice(0, currentStepIndex + 1);
  }, [filteredEvents, currentStepIndex]);

  const isCurrentlyRunning = isTriggering || replayData?.isRunning;

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.02] p-6 shadow-xl backdrop-blur-sm">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-600/20 border border-cyan-500/30 text-cyan-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">Incident Replay</h2>
              {displayedRun?.totalEventCount !== undefined && (
                <span className="rounded-full bg-cyan-500/10 px-2.5 py-0.5 text-xs font-semibold border border-cyan-500/20 text-cyan-400">
                  {displayedRun.totalEventCount} EVENTS RECORDED
                </span>
              )}
              {displayedRun?.isTruncated && (
                <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold border border-amber-500/20 text-amber-400">
                  TRUNCATED (MAX 500)
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              Step-by-step chronological reconstruction of telemetry, state changes &amp; correlation.
              {displayedRun?.completedAt && (
                <span className="ml-1 text-gray-500">
                  Last updated: {new Date(displayedRun.completedAt).toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleRunReplay()}
          disabled={isCurrentlyRunning}
          aria-label="Re-run Incident Replay timeline reconstruction"
          className="flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-500 disabled:opacity-50"
        >
          {isCurrentlyRunning ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Reconstructing timeline...</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Re-Run Replay</span>
            </>
          )}
        </button>
      </div>

      {/* Non-blocking Running State Banner */}
      {isCurrentlyRunning && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs text-cyan-300">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
          <span>Timeline reconstruction is currently executing in the background. Previous completed replay remains accessible below.</span>
        </div>
      )}

      {/* Non-blocking Failure Alert Banner */}
      {(actionError || replayData?.latestFailure) && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          <span>Incident replay execution encountered an error: {actionError || replayData?.latestFailure?.error}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error banner"
            className="ml-2 font-bold text-red-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Content */}
      {isLoading && !displayedRun ? (
        <div className="py-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          <span>Reconstructing chronological incident timeline...</span>
        </div>
      ) : !displayedRun || allEvents.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          No incident replay generated yet. Click &quot;Re-Run Replay&quot; to synthesize timeline.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Playback Controls & Scrubber */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePlayToggle}
                  aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 transition"
                >
                  {isPlaying ? (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="4" width="4" height="16" rx="1" />
                      <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                <span className="text-xs font-semibold text-gray-300">
                  Step {Math.min(currentStepIndex + 1, allEvents.length)} of {allEvents.length}
                </span>
              </div>

              {/* Speed controls */}
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span>Speed:</span>
                {[1, 2, 5].map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => setPlaybackSpeed(speed)}
                    aria-label={`Set playback speed to ${speed}x`}
                    className={`rounded px-2 py-0.5 text-[11px] font-bold transition ${
                      playbackSpeed === speed
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            {/* Range Scrubber */}
            <input
              type="range"
              min={0}
              max={Math.max(0, allEvents.length - 1)}
              value={currentStepIndex}
              onChange={(e) => handleScrubberChange(Number(e.target.value))}
              aria-label="Replay timeline position scrubber"
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-gray-800 accent-cyan-500"
            />
          </div>

          {/* Category Filter Tabs */}
          <div className="flex items-center gap-2 border-b border-white/5 pb-3 overflow-x-auto">
            {(['ALL', 'STATE_CHANGE', 'TELEMETRY', 'CORRELATION', 'INVESTIGATION', 'COMMUNICATION'] as const).map((cat) => {
              const count = cat === 'ALL' ? allEvents.length : allEvents.filter((e) => e.category === cat).length;
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => handleCategoryChange(cat)}
                  aria-label={`Filter events by category ${cat}`}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap ${
                    isActive
                      ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {cat === 'ALL' ? 'All Events' : cat} ({count})
                </button>
              );
            })}
          </div>

          {/* Chronological Event Stream */}
          <div className="relative pl-12">
            {visibleEvents.length > 1 && (
              <div className="absolute left-[15px] top-[28px] bottom-[28px] w-0.5 bg-cyan-500/30" />
            )}

            <div className="space-y-4">
              {visibleEvents.map((evt, idx) => {
                const eventTimeMs = new Date(evt.timestamp).getTime();
                const signedOffset = formatSignedRelativeTime(eventTimeMs, anchorTimestampMs);
                const displayTime = spansMultipleDates
                  ? `${new Date(evt.timestamp).toLocaleDateString()} ${new Date(evt.timestamp).toLocaleTimeString()}`
                  : new Date(evt.timestamp).toLocaleTimeString();

                return (
                  <div key={evt.id || `evt-${idx}`} className="relative">
                    {/* Numbered Circle Node */}
                    <div className="absolute -left-12 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500/40 bg-cyan-950 text-xs font-bold text-cyan-300 shadow-md shadow-cyan-950/50 z-10">
                      {evt.sequenceIndex ?? idx + 1}
                    </div>

                    {/* Event Content Card */}
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 transition hover:border-cyan-500/20">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase border ${getCategoryBadgeClass(evt.category)}`}>
                            {evt.category}
                          </span>
                          <span className="font-semibold text-xs text-white truncate">{evt.title}</span>
                        </div>
                        <span className="text-[10px] text-gray-500 font-mono">
                          {displayTime} ({signedOffset})
                        </span>
                      </div>

                      {evt.description && (
                        <p className="mt-1 text-xs text-gray-400 leading-relaxed">{evt.description}</p>
                      )}

                      {evt.actorName && (
                        <span className="mt-1.5 inline-block text-[10px] text-gray-500">
                          Source / Actor: <span className="text-gray-300 font-medium">{evt.actorName}</span> ({evt.source})
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
