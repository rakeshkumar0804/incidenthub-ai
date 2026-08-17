import { useQuery } from '@tanstack/react-query';
import { checkApiHealth } from '../services/healthService';
import type { HealthResponse } from '@incidenthub/shared';

export const useHealth = () => {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: checkApiHealth,
    refetchInterval: 30_000,
    retry: 1,
  });
};
