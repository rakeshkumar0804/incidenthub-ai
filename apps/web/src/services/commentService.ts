import { apiClient } from '../lib/axios';
import type { IncidentCommentDto, ApiSuccess } from '@incidenthub/shared';

export const getIncidentComments = async (
  organizationId: string,
  incidentId: string,
): Promise<IncidentCommentDto[]> => {
  const { data } = await apiClient.get<ApiSuccess<IncidentCommentDto[]>>(
    `/organizations/${organizationId}/incidents/${incidentId}/comments`,
  );
  return data.data;
};

export const createIncidentComment = async (
  organizationId: string,
  incidentId: string,
  content: string,
  parentId?: string,
): Promise<IncidentCommentDto> => {
  const { data } = await apiClient.post<ApiSuccess<IncidentCommentDto>>(
    `/organizations/${organizationId}/incidents/${incidentId}/comments`,
    { content, parentId },
  );
  return data.data;
};

export const updateIncidentComment = async (
  organizationId: string,
  incidentId: string,
  commentId: string,
  content: string,
): Promise<IncidentCommentDto> => {
  const { data } = await apiClient.patch<ApiSuccess<IncidentCommentDto>>(
    `/organizations/${organizationId}/incidents/${incidentId}/comments/${commentId}`,
    { content },
  );
  return data.data;
};

export const deleteIncidentComment = async (
  organizationId: string,
  incidentId: string,
  commentId: string,
): Promise<void> => {
  await apiClient.delete(
    `/organizations/${organizationId}/incidents/${incidentId}/comments/${commentId}`,
  );
};
