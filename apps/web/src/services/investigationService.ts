import { apiClient } from '../lib/axios';
import type { ApiSuccess, InvestigationRunDto, TriggerInvestigationInput } from '@incidenthub/shared';

export const investigationService = {
  getLatestInvestigation: async (
    organizationId: string,
    incidentId: string,
  ): Promise<{ incidentId: string; latestRun: InvestigationRunDto | null }> => {
    const res = await apiClient.get<
      ApiSuccess<{ incidentId: string; latestRun: InvestigationRunDto | null }>
    >(`/organizations/${organizationId}/incidents/${incidentId}/investigation`);
    return res.data.data;
  },

  getInvestigationRuns: async (
    organizationId: string,
    incidentId: string,
  ): Promise<InvestigationRunDto[]> => {
    const res = await apiClient.get<ApiSuccess<InvestigationRunDto[]>>(
      `/organizations/${organizationId}/incidents/${incidentId}/investigation/runs`,
    );
    return res.data.data;
  },

  triggerInvestigation: async (
    organizationId: string,
    incidentId: string,
    triggerType: 'AUTOMATIC_CORRELATION_COMPLETED' | 'MANUAL_REQUEST' | 'RERUN_REQUEST' = 'MANUAL_REQUEST',
  ): Promise<{ runId: string; status: string }> => {
    const payload: TriggerInvestigationInput = { triggerType };
    const res = await apiClient.post<ApiSuccess<{ runId: string; status: string }>>(
      `/organizations/${organizationId}/incidents/${incidentId}/investigation`,
      payload,
    );
    return res.data.data;
  },
};
