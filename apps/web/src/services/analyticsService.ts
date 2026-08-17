import { apiClient } from '../lib/axios';
import type {
  AnalyticsOverviewResponseDto,
  ServiceRankingDto,
  DeploymentCorrelationDto,
  EngineeringSignalDto,
  AnalyticsTimeWindow,
  AnalyticsDrilldownResponseDto,
} from '@incidenthub/shared';

export const analyticsService = {
  getOverview: async (
    organizationId: string,
    window: AnalyticsTimeWindow = '30d',
    refresh = false,
  ): Promise<AnalyticsOverviewResponseDto> => {
    const res = await apiClient.get<{

      success: boolean;
      data: AnalyticsOverviewResponseDto;
    }>(`/organizations/${organizationId}/analytics/overview`, {
      params: { window, refresh: refresh ? 'true' : 'false' },
    });
    return res.data.data;
  },

  getServiceMetrics: async (
    organizationId: string,
    window: AnalyticsTimeWindow = '30d',
  ): Promise<ServiceRankingDto[]> => {
    const res = await apiClient.get<{
      success: boolean;
      data: ServiceRankingDto[];
    }>(`/organizations/${organizationId}/analytics/services`, {
      params: { window },
    });
    return res.data.data;
  },

  getDeployments: async (
    organizationId: string,
    window: AnalyticsTimeWindow = '30d',
  ): Promise<DeploymentCorrelationDto[]> => {
    const res = await apiClient.get<{
      success: boolean;
      data: DeploymentCorrelationDto[];
    }>(`/organizations/${organizationId}/analytics/deployments`, {
      params: { window },
    });
    return res.data.data;
  },

  getSignals: async (
    organizationId: string,
    window: AnalyticsTimeWindow = '30d',
  ): Promise<EngineeringSignalDto[]> => {
    const res = await apiClient.get<{
      success: boolean;
      data: EngineeringSignalDto[];
    }>(`/organizations/${organizationId}/analytics/intelligence-signals`, {
      params: { window },
    });
    return res.data.data;
  },

  getDrilldown: async (
    organizationId: string,
    metric: string,
    window: AnalyticsTimeWindow = '30d',
  ): Promise<AnalyticsDrilldownResponseDto> => {
    const res = await apiClient.get<{
      success: boolean;
      data: AnalyticsDrilldownResponseDto;
    }>(`/organizations/${organizationId}/analytics/drilldown`, {
      params: { metric, window },
    });
    return res.data.data;
  },
};
