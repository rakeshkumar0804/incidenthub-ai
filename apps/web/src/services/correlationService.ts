import { apiClient } from '../lib/axios';
import type {
  ApiSuccess,
  IncidentEvidenceDto,
  CorrelationRunDto,
  CorrelationTriggerType,
} from '@incidenthub/shared';

export interface CorrelationEvidenceResponse {
  incidentId: string;
  latestRun: CorrelationRunDto | null;
  evidence: IncidentEvidenceDto[];
}

export const correlationService = {
  async triggerCorrelation(
    organizationId: string,
    incidentId: string,
    triggerType: CorrelationTriggerType = 'MANUAL_REQUEST',
  ): Promise<{ runId: string; status: string; correlatedCount: number }> {
    const { data } = await apiClient.post<
      ApiSuccess<{ runId: string; status: string; correlatedCount: number }>
    >(`/organizations/${organizationId}/incidents/${incidentId}/correlation`, {
      triggerType,
    });
    return data.data;
  },

  async getCorrelationEvidence(
    organizationId: string,
    incidentId: string,
  ): Promise<CorrelationEvidenceResponse> {
    const { data } = await apiClient.get<ApiSuccess<CorrelationEvidenceResponse>>(
      `/organizations/${organizationId}/incidents/${incidentId}/correlation`,
    );
    return data.data;
  },

  async getCorrelationRuns(
    organizationId: string,
    incidentId: string,
  ): Promise<CorrelationRunDto[]> {
    const { data } = await apiClient.get<ApiSuccess<CorrelationRunDto[]>>(
      `/organizations/${organizationId}/incidents/${incidentId}/correlation/runs`,
    );
    return data.data;
  },

  async updateEvidenceStatus(
    organizationId: string,
    incidentId: string,
    evidenceId: string,
    action: 'acknowledge' | 'dismiss' | 'reset',
  ): Promise<IncidentEvidenceDto> {
    const { data } = await apiClient.patch<ApiSuccess<IncidentEvidenceDto>>(
      `/organizations/${organizationId}/incidents/${incidentId}/correlation/evidence/${evidenceId}`,
      { action },
    );
    return data.data;
  },
};
