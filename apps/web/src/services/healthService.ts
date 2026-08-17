import { apiClient } from '../lib/axios';
import type { HealthResponse } from '@incidenthub/shared';

export const checkApiHealth = async (): Promise<HealthResponse> => {
  const { data } = await apiClient.get<HealthResponse>('/health');
  return data;
};
