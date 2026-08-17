import { apiClient } from '../lib/axios';
import type { ApiSuccess, ReplayRunDto, ReplayEventDto, TriggerReplayInput } from '@incidenthub/shared';

export interface ReplayResponseData {
  incidentId: string;
  latestRun: (ReplayRunDto & { events: ReplayEventDto[] }) | null;
}

export const replayService = {
  getLatestReplay: async (
    organizationId: string,
    incidentId: string,
  ): Promise<ReplayResponseData> => {
    const res = await apiClient.get<ApiSuccess<ReplayResponseData>>(
      `/organizations/${organizationId}/incidents/${incidentId}/replay`,
    );
    return res.data.data;
  },

  getReplayRuns: async (
    organizationId: string,
    incidentId: string,
  ): Promise<ReplayRunDto[]> => {
    const res = await apiClient.get<ApiSuccess<ReplayRunDto[]>>(
      `/organizations/${organizationId}/incidents/${incidentId}/replay/runs`,
    );
    return res.data.data;
  },

  triggerReplay: async (
    organizationId: string,
    incidentId: string,
    triggerType: 'AUTOMATIC_INCIDENT_RESOLVED' | 'MANUAL_REQUEST' | 'RERUN_REQUEST' = 'MANUAL_REQUEST',
  ): Promise<{ runId: string; status: string }> => {
    const payload: TriggerReplayInput = { triggerType };
    const res = await apiClient.post<ApiSuccess<{ runId: string; status: string }>>(
      `/organizations/${organizationId}/incidents/${incidentId}/replay`,
      payload,
    );
    return res.data.data;
  },
};
