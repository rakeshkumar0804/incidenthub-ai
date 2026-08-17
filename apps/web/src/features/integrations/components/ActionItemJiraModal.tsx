import React, { useState } from 'react';
import { IntegrationService } from '@/services/integrationService';

interface Props {
  organizationId: string;
  incidentId: string;
  actionItemId: string;
  actionItemTitle: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (jiraIssueUrl: string) => void;
}

export const ActionItemJiraModal: React.FC<Props> = ({
  organizationId,
  incidentId,
  actionItemId,
  actionItemTitle,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [projectKey, setProjectKey] = useState('ENG');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      const res = await IntegrationService.createJiraIssue(organizationId, incidentId, actionItemId, { projectKey });
      onSuccess(res.jiraIssueUrl);
      onClose();
    } catch {
      // Error handled by Toast / state
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-100 mb-2">Create Jira Issue</h3>
        <p className="text-xs text-gray-400 mb-4">
          Push action item <span className="text-gray-200 font-medium">&quot;{actionItemTitle}&quot;</span> to Jira.
        </p>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Jira Project Key</label>
            <input
              type="text"
              required
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
              placeholder="ENG"
              className="w-full rounded-lg border border-gray-800 bg-gray-950 p-2.5 text-sm text-gray-200 uppercase"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-gray-800 px-4 py-2 text-xs text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 shadow-md"
            >
              {loading ? 'Creating Ticket...' : 'Create Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
