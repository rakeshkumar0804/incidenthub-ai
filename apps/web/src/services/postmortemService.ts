import { apiClient } from '../lib/axios';
import type {
  ApiSuccess,
  PostmortemDto,
  PostmortemVersionDto,
  ActionItemDto,
  UpdatePostmortemInput,
  CreateActionItemInput,
  UpdateActionItemInput,
  PostmortemRunDto,
  LatestPostmortemFailureDto,
} from '@incidenthub/shared';

export interface PostmortemResponseData {
  incidentId: string;
  postmortem: PostmortemDto | null;
  latestRun?: PostmortemRunDto | null;
  latestCompletedRun?: PostmortemRunDto | null;
  latestFailure?: LatestPostmortemFailureDto | null;
  isRunning?: boolean;
}

export const postmortemService = {
  getPostmortem: async (
    organizationId: string,
    incidentId: string,
  ): Promise<PostmortemResponseData> => {
    const res = await apiClient.get<ApiSuccess<PostmortemResponseData>>(
      `/organizations/${organizationId}/incidents/${incidentId}/postmortem`,
    );
    return res.data.data;
  },

  generatePostmortem: async (
    organizationId: string,
    incidentId: string,
    triggerType: string = 'MANUAL_REQUEST',
  ): Promise<{ postmortemId: string; versionId: string; versionNumber: number; status?: string; runId?: string }> => {
    const res = await apiClient.post<
      ApiSuccess<{ postmortemId: string; versionId: string; versionNumber: number; status?: string; runId?: string }>
    >(`/organizations/${organizationId}/incidents/${incidentId}/postmortem`, { triggerType });
    return res.data.data;
  },

  updatePostmortem: async (
    organizationId: string,
    incidentId: string,
    input: UpdatePostmortemInput,
  ): Promise<PostmortemVersionDto> => {
    const res = await apiClient.patch<ApiSuccess<PostmortemVersionDto>>(
      `/organizations/${organizationId}/incidents/${incidentId}/postmortem`,
      input,
    );
    return res.data.data;
  },

  createActionItem: async (
    organizationId: string,
    incidentId: string,
    input: CreateActionItemInput,
  ): Promise<ActionItemDto> => {
    const res = await apiClient.post<ApiSuccess<ActionItemDto>>(
      `/organizations/${organizationId}/incidents/${incidentId}/postmortem/action-items`,
      input,
    );
    return res.data.data;
  },

  updateActionItem: async (
    organizationId: string,
    incidentId: string,
    actionItemId: string,
    input: UpdateActionItemInput,
  ): Promise<ActionItemDto> => {
    const res = await apiClient.patch<ApiSuccess<ActionItemDto>>(
      `/organizations/${organizationId}/incidents/${incidentId}/postmortem/action-items/${actionItemId}`,
      input,
    );
    return res.data.data;
  },
};
