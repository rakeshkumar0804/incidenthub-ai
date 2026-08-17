import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { apiClient } from '../lib/axios';
import { SlackIntegrationCard } from '../features/integrations/components/SlackIntegrationCard';
import { JiraIntegrationCard } from '../features/integrations/components/JiraIntegrationCard';
import { IntegrationDeliveryLogTable } from '../features/integrations/components/IntegrationDeliveryLogTable';
import type { IntegrationDeliveryLogItem } from '../features/integrations/components/IntegrationDeliveryLogTable';

interface IntegrationRecord {
  provider: string;
  status: string;
  metadata?: {
    teamName?: string;
    siteUrl?: string;
  };
}

export const IntegrationsSettingsPage: React.FC = () => {
  const { organizationId = 'default-org' } = useParams<{ organizationId: string }>();
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [deliveries] = useState<IntegrationDeliveryLogItem[]>([]);

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await apiClient.get<{ success: boolean; data: IntegrationRecord[] }>(
        `/organizations/${organizationId}/integrations/github`,
      );
      setIntegrations(res.data?.data || []);
    } catch {
      // Fallback state
    }
  }, [organizationId]);

  useEffect(() => {
    void fetchIntegrations();
  }, [fetchIntegrations]);

  const slackIntegration = integrations.find((i) => i.provider === 'SLACK');
  const jiraIntegration = integrations.find((i) => i.provider === 'JIRA');

  return (
    <div className="space-y-8 p-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Integrations & Workflows</h1>
        <p className="text-sm text-gray-400">
          Connect external collaboration and task tracking tools for bi-directional operational sync.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <SlackIntegrationCard
          organizationId={organizationId}
          isConnected={slackIntegration?.status === 'CONNECTED'}
          teamName={slackIntegration?.metadata?.teamName}
          onRefresh={() => void fetchIntegrations()}
        />

        <JiraIntegrationCard
          organizationId={organizationId}
          isConnected={jiraIntegration?.status === 'CONNECTED'}
          siteUrl={jiraIntegration?.metadata?.siteUrl}
          onRefresh={() => void fetchIntegrations()}
        />
      </div>

      <IntegrationDeliveryLogTable deliveries={deliveries} />
    </div>
  );
};
