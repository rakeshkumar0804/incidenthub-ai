import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PostmortemStatus, ActionItemPriority, ActionItemStatus } from '@incidenthub/shared';
import type { PostmortemDto, PostmortemVersionDto } from '@incidenthub/shared';
import { postmortemService } from '../../../services/postmortemService';

interface PostmortemSectionProps {
  organizationId: string;
  incidentId: string;
  isViewer?: boolean;
}

export const PostmortemSection: React.FC<PostmortemSectionProps> = ({
  organizationId,
  incidentId,
  isViewer = false,
}) => {
  const queryClient = useQueryClient();
  const [postmortemData, setPostmortemData] = useState<PostmortemDto | null>(null);
  const [activeVersion, setActiveVersion] = useState<PostmortemVersionDto | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Form states for editing
  const [summary, setSummary] = useState<string>('');
  const [impact, setImpact] = useState<string>('');
  const [rootCause, setRootCause] = useState<string>('');
  const [contributingFactors, setContributingFactors] = useState<string>('');
  const [resolution, setResolution] = useState<string>('');
  const [wentWell, setWentWell] = useState<string>('');
  const [wentWrong, setWentWrong] = useState<string>('');

  // Action item modal state
  const [actionTitle, setActionTitle] = useState<string>('');
  const [actionPriority, setActionPriority] = useState<ActionItemPriority>(ActionItemPriority.MEDIUM);
  const [isAddingAction, setIsAddingAction] = useState<boolean>(false);

  const fetchPostmortem = async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      const data = await postmortemService.getPostmortem(organizationId, incidentId);
      setPostmortemData(data.postmortem);

      if (data.postmortem?.activeVersion) {
        setActiveVersion(data.postmortem.activeVersion);
        setSelectedVersionId(data.postmortem.activeVersion.id);
        populateEditForm(data.postmortem.activeVersion);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch postmortem document';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const populateEditForm = (ver: PostmortemVersionDto) => {
    setSummary(ver.summary || '');
    setImpact(ver.impact || '');
    setRootCause(ver.rootCause || '');
    setContributingFactors(ver.contributingFactors || '');
    setResolution(ver.resolution || '');
    setWentWell(ver.wentWell || '');
    setWentWrong(ver.wentWrong || '');
  };

  useEffect(() => {
    void fetchPostmortem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, incidentId]);

  const handleVersionChange = (versionId: string) => {
    setSelectedVersionId(versionId);
    const selected = postmortemData?.versions.find((v) => v.id === versionId);
    if (selected) {
      setActiveVersion(selected);
      populateEditForm(selected);
    }
  };

  const handleGenerate = async () => {
    try {
      setIsGenerating(true);
      setErrorMsg(null);
      await postmortemService.generatePostmortem(organizationId, incidentId, 'MANUAL_REQUEST');
      await fetchPostmortem();
      void queryClient.invalidateQueries({ queryKey: ['timeline', incidentId] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Postmortem generation failed';
      setErrorMsg(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveEdit = async () => {
    try {
      setIsLoading(true);
      setErrorMsg(null);
      await postmortemService.updatePostmortem(organizationId, incidentId, {
        summary,
        impact,
        rootCause,
        contributingFactors,
        resolution,
        wentWell,
        wentWrong,
      });
      setIsEditing(false);
      await fetchPostmortem();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save postmortem edits';
      setErrorMsg(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateActionItem = async () => {
    if (!actionTitle.trim()) return;
    try {
      setErrorMsg(null);
      await postmortemService.createActionItem(organizationId, incidentId, {
        title: actionTitle,
        priority: actionPriority,
      });
      setActionTitle('');
      setIsAddingAction(false);
      await fetchPostmortem();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create action item';
      setErrorMsg(msg);
    }
  };

  const handleActionItemStatusToggle = async (actionItemId: string, currentStatus: ActionItemStatus) => {
    const nextStatus: ActionItemStatus = currentStatus === ActionItemStatus.COMPLETED ? ActionItemStatus.OPEN : ActionItemStatus.COMPLETED;
    try {
      setErrorMsg(null);
      await postmortemService.updateActionItem(organizationId, incidentId, actionItemId, {
        status: nextStatus,
      });
      await fetchPostmortem();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update action item';
      setErrorMsg(msg);
    }
  };

  const getStatusBadgeClass = (status: PostmortemStatus) => {
    switch (status) {
      case PostmortemStatus.DRAFT:
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case PostmortemStatus.IN_REVIEW:
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case PostmortemStatus.APPROVED:
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case PostmortemStatus.PUBLISHED:
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      default:
        return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    }
  };

  const versions = postmortemData?.versions || [];

  return (
    <div className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.02] p-6 shadow-xl backdrop-blur-sm">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-400">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">AI Postmortem Engine</h2>
              {activeVersion && (
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getStatusBadgeClass(activeVersion.status)}`}>
                  {activeVersion.status} (v{activeVersion.versionNumber})
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              Evidence-grounded postmortem versioning with human review &amp; action item extraction.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Version Selector */}
          {versions.length > 0 && (
            <select
              value={selectedVersionId}
              onChange={(e) => handleVersionChange(e.target.value)}
              className="rounded-xl border border-white/10 bg-gray-900 px-3 py-2 text-xs font-mono text-gray-200 focus:outline-none"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber} ({v.status}) {v.aiGenerated ? '· AI' : '· Human'}
                </option>
              ))}
            </select>
          )}

          {!isViewer && (
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isGenerating}
              className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-500 disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Generating Postmortem...</span>
                </>
              ) : (
                <>
                  <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L5.601 15.1a2 2 0 00-1.022.547l-1.002 1.002a2 2 0 00-.547 1.022l-.477 2.387a2 2 0 002.387 2.387l2.387-.477a2 2 0 001.022-.547l1.002-1.002a2 2 0 00.547-1.022l.477-2.387a6 6 0 00-.517-3.86l-.158-.318a6 6 0 01-.517-3.86l.477-2.387a2 2 0 00-.547-1.022L12.387 2.1a2 2 0 00-2.387 2.387l.477 2.387a2 2 0 00.547 1.022l1.002 1.002a2 2 0 001.022.547l2.387.477a6 6 0 003.86-.517l.318-.158a6 6 0 013.86-.517l2.387.477a2 2 0 001.022.547l1.002 1.002z" />
                  </svg>
                  <span>
                    {versions.length > 0 ? `Re-Generate v${activeVersion ? activeVersion.versionNumber + 1 : 'Next'}` : 'Generate Postmortem'}
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error Alert Banner */}
      {errorMsg && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          <span>Postmortem error: {errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="ml-2 font-bold text-red-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <span>Loading postmortem version...</span>
        </div>
      ) : !activeVersion ? (
        <div className="py-8 text-center text-sm text-gray-500">
          No postmortem draft generated yet. Click &quot;Generate Postmortem&quot; to synthesize document.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Postmortem Document View/Edit Mode */}
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-400">
              Version {activeVersion.versionNumber} Document
            </h3>

            {!isViewer && (
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="text-xs font-medium text-violet-400 hover:text-violet-300 transition"
              >
                {isEditing ? 'Cancel Edit' : 'Edit Document'}
              </button>
            )}
          </div>

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Executive Summary</label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-gray-900 p-3 text-xs text-gray-100 focus:outline-none focus:border-violet-500"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Impact Narrative</label>
                  <textarea
                    value={impact}
                    onChange={(e) => setImpact(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-gray-900 p-3 text-xs text-gray-100 focus:outline-none focus:border-violet-500"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Root Cause Analysis</label>
                  <textarea
                    value={rootCause}
                    onChange={(e) => setRootCause(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-gray-900 p-3 text-xs text-gray-100 focus:outline-none focus:border-violet-500"
                    rows={3}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">What Went Well</label>
                  <textarea
                    value={wentWell}
                    onChange={(e) => setWentWell(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-gray-900 p-3 text-xs text-gray-100 focus:outline-none focus:border-violet-500"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">What Went Wrong</label>
                  <textarea
                    value={wentWrong}
                    onChange={(e) => setWentWrong(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-gray-900 p-3 text-xs text-gray-100 focus:outline-none focus:border-violet-500"
                    rows={3}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Resolution &amp; Remediation</label>
                <textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-gray-900 p-3 text-xs text-gray-100 focus:outline-none focus:border-violet-500"
                  rows={2}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-gray-300 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 hover:bg-violet-500"
                >
                  Save New Version
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary & Root Cause */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-violet-400">Executive Summary</h4>
                  <p className="text-xs text-gray-300 leading-relaxed">{activeVersion.summary || 'N/A'}</p>
                </div>
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-violet-300">Root Cause Analysis</h4>
                  <p className="text-xs font-medium text-white leading-relaxed">{activeVersion.rootCause || 'N/A'}</p>
                </div>
              </div>

              {/* Impact & Resolution */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Impact Assessment</h4>
                  <p className="text-xs text-gray-300 leading-relaxed">{activeVersion.impact || 'N/A'}</p>
                </div>
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Resolution &amp; Prevention</h4>
                  <p className="text-xs text-gray-300 leading-relaxed">{activeVersion.resolution || 'N/A'}</p>
                </div>
              </div>

              {/* Went Well vs Went Wrong */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.02] p-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">What Went Well</h4>
                  <p className="text-xs text-gray-300 leading-relaxed">{activeVersion.wentWell || 'N/A'}</p>
                </div>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.02] p-4">
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">What Went Wrong</h4>
                  <p className="text-xs text-gray-300 leading-relaxed">{activeVersion.wentWrong || 'N/A'}</p>
                </div>
              </div>

              {/* Evidence Citations */}
              {Array.isArray(activeVersion.evidenceReferences) && activeVersion.evidenceReferences.length > 0 && (
                <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-violet-400">Evidence Citations ({activeVersion.evidenceReferences.length})</h4>
                  <div className="space-y-2">
                    {activeVersion.evidenceReferences.map((ref, idx) => (
                      <div key={idx} className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-2.5 text-xs">
                        <div>
                          <span className="rounded bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300 uppercase mr-2">
                            {ref.claimType}
                          </span>
                          <span className="text-gray-300">{ref.description}</span>
                        </div>
                        <span className="text-[10px] text-gray-500 font-mono shrink-0">{ref.sourceType}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Structured Action Items */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                    Action Items ({postmortemData?.actionItems.length || 0})
                  </h4>

                  {!isViewer && (
                    <button
                      type="button"
                      onClick={() => setIsAddingAction(!isAddingAction)}
                      className="text-xs font-medium text-violet-400 hover:text-violet-300 transition"
                    >
                      + Add Action Item
                    </button>
                  )}
                </div>

                {isAddingAction && (
                  <div className="mb-4 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 space-y-3">
                    <input
                      type="text"
                      placeholder="Action item title..."
                      value={actionTitle}
                      onChange={(e) => setActionTitle(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-gray-900 p-2 text-xs text-white focus:outline-none focus:border-violet-500"
                    />
                    <div className="flex items-center justify-between">
                      <select
                        value={actionPriority}
                        onChange={(e) => setActionPriority(e.target.value as ActionItemPriority)}
                        className="rounded-lg border border-white/10 bg-gray-900 px-3 py-1.5 text-xs text-white"
                      >
                        <option value={ActionItemPriority.HIGH}>HIGH Priority</option>
                        <option value={ActionItemPriority.MEDIUM}>MEDIUM Priority</option>
                        <option value={ActionItemPriority.LOW}>LOW Priority</option>
                      </select>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setIsAddingAction(false)}
                          className="rounded-lg px-3 py-1 text-xs text-gray-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCreateActionItem()}
                          className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-500"
                        >
                          Save Item
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {postmortemData?.actionItems && postmortemData.actionItems.length > 0 ? (
                  <div className="space-y-2">
                    {postmortemData.actionItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-3 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            disabled={isViewer}
                            checked={item.status === ActionItemStatus.COMPLETED}
                            onChange={() => void handleActionItemStatusToggle(item.id, item.status)}
                            className="h-4 w-4 rounded accent-violet-500 cursor-pointer disabled:opacity-50"
                          />
                          <span className={item.status === ActionItemStatus.COMPLETED ? 'line-through text-gray-500' : 'text-white'}>
                            {item.title}
                          </span>
                        </div>
                        <span className="rounded bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-300 uppercase">
                          {item.priority}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No action items created yet.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
