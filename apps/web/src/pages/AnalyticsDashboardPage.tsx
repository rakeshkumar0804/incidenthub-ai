import React, { useState, useEffect } from 'react';
import type {
  AnalyticsOverviewResponseDto,
  ServiceRankingDto,
  DeploymentCorrelationDto,
  AnalyticsTimeWindow,
} from '@incidenthub/shared';
import { analyticsService } from '../services/analyticsService';
import { useAuth } from '../features/auth/AuthContext';
import { AnalyticsFilterBar } from '../features/analytics/components/AnalyticsFilterBar';
import { KpiCardGrid } from '../features/analytics/components/KpiCardGrid';
import { IncidentTrendChart } from '../features/analytics/components/IncidentTrendChart';
import { ServiceRankingTable } from '../features/analytics/components/ServiceRankingTable';
import { DeploymentCorrelationSection } from '../features/analytics/components/DeploymentCorrelationSection';
import { IntelligenceSignalsSection } from '../features/analytics/components/IntelligenceSignalsSection';

export const AnalyticsDashboardPage: React.FC = () => {
  const { activeOrg } = useAuth();
  const [selectedWindow, setSelectedWindow] = useState<AnalyticsTimeWindow>('30d');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const [overviewData, setOverviewData] = useState<AnalyticsOverviewResponseDto | null>(null);
  const [serviceRankings, setServiceRankings] = useState<ServiceRankingDto[]>([]);
  const [correlations, setCorrelations] = useState<DeploymentCorrelationDto[]>([]);

  const fetchAnalytics = async (refresh = false) => {
    if (!activeOrg) return;
    try {
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);

      const [overview, services, deps] = await Promise.all([
        analyticsService.getOverview(activeOrg.organizationId, selectedWindow, refresh),
        analyticsService.getServiceMetrics(activeOrg.organizationId, selectedWindow),
        analyticsService.getDeployments(activeOrg.organizationId, selectedWindow),
      ]);

      setOverviewData(overview);
      setServiceRankings(services);
      setCorrelations(deps);
    } catch {
      // Error handling
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchAnalytics(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id, selectedWindow]);

  if (!activeOrg) {
    return <div className="p-8 text-center text-sm text-gray-500">Please select an organization.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Analytics & Engineering Intelligence</h1>
        <p className="text-xs text-gray-400">
          Deterministic reliability metrics, MTTR/MTTD trends, candidate deployment associations, and engineering signals.
        </p>
      </div>

      {/* Filter Bar */}
      <AnalyticsFilterBar
        selectedWindow={selectedWindow}
        onWindowChange={setSelectedWindow}
        onRefresh={() => void fetchAnalytics(true)}
        isRefreshing={isRefreshing}
      />

      {isLoading || !overviewData ? (
        <div className="py-16 text-center text-sm text-gray-500">Calculating analytics & signals...</div>
      ) : (
        <div className="space-y-6">
          {/* KPI Cards */}
          <KpiCardGrid overview={overviewData.overview} />

          {/* Trend Chart & Signals Grid */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <IncidentTrendChart timeSeries={overviewData.timeSeries} />
            </div>
            <div>
              <IntelligenceSignalsSection signals={overviewData.signals} />
            </div>
          </div>

          {/* Service Rankings & Candidate Deployment Correlation */}
          <div className="grid gap-6 lg:grid-cols-2">
            <ServiceRankingTable rankings={serviceRankings} />
            <DeploymentCorrelationSection correlations={correlations} />
          </div>
        </div>
      )}
    </div>
  );
};
