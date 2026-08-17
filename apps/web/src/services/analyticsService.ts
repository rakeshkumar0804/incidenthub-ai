import axios from 'axios';
import type {
  AnalyticsOverviewResponseDto,
  ServiceRankingDto,
  DeploymentCorrelationDto,
  EngineeringSignalDto,
  AnalyticsTimeWindow,
  AnalyticsDrilldownResponseDto,
} from '@incidenthub/shared';

const API_URL = (import.meta.env['VITE_API_URL'] as string | undefined) || 'http://localhost:4000';

const client = axios.create({
  baseURL: `${API_URL}/api/v1`,
  withCredentials: true,
});

export const analyticsService = {
  getOverview: async (
    organizationId: string,
    window: AnalyticsTimeWindow = '30d',
    refresh = false,
  ): Promise<AnalyticsOverviewResponseDto> => {
    const res = await client.get<{
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
    const res = await client.get<{
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
    const res = await client.get<{
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
    const res = await client.get<{
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
    const res = await client.get<{
      success: boolean;
      data: AnalyticsDrilldownResponseDto;
    }>(`/organizations/${organizationId}/analytics/drilldown`, {
      params: { metric, window },
    });
    return res.data.data;
  },
};
