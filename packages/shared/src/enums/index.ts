/**
 * Shared domain enums for IncidentHub AI.
 *
 * These are the canonical enum values shared between the frontend and backend.
 * The Prisma schema uses the same string values — keep them in sync.
 *
 * Do NOT add framework-specific types here (no React, no Express imports).
 * Do NOT add business logic here.
 */

// =============================================================================
// Organization
// =============================================================================

export enum OrgRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  RESPONDER = 'RESPONDER',
  VIEWER = 'VIEWER',
}

/// Human-readable labels for display in UI
export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  [OrgRole.OWNER]: 'Owner',
  [OrgRole.ADMIN]: 'Admin',
  [OrgRole.RESPONDER]: 'Responder',
  [OrgRole.VIEWER]: 'Viewer',
};

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

export enum ProjectStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ARCHIVED = 'ARCHIVED',
}

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  [InvitationStatus.PENDING]: 'Pending',
  [InvitationStatus.ACCEPTED]: 'Accepted',
  [InvitationStatus.REVOKED]: 'Revoked',
  [InvitationStatus.EXPIRED]: 'Expired',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  [ProjectStatus.ACTIVE]: 'Active',
  [ProjectStatus.PAUSED]: 'Paused',
  [ProjectStatus.ARCHIVED]: 'Archived',
};

// =============================================================================
// Incident
// =============================================================================

export enum IncidentSeverity {
  SEV1 = 'SEV1',
  SEV2 = 'SEV2',
  SEV3 = 'SEV3',
  SEV4 = 'SEV4',
}

export enum IncidentStatus {
  OPEN = 'OPEN',
  INVESTIGATING = 'INVESTIGATING',
  MITIGATING = 'MITIGATING',
  RESOLVED = 'RESOLVED',
}

export enum IncidentEnvironment {
  PRODUCTION = 'PRODUCTION',
  STAGING = 'STAGING',
  DEVELOPMENT = 'DEVELOPMENT',
}

export enum TimelineEventType {
  INCIDENT_CREATED = 'INCIDENT_CREATED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  SEVERITY_CHANGED = 'SEVERITY_CHANGED',
  ASSIGNEE_CHANGED = 'ASSIGNEE_CHANGED',
  DESCRIPTION_UPDATED = 'DESCRIPTION_UPDATED',
  SERVICE_CHANGED = 'SERVICE_CHANGED',
  PROJECT_CHANGED = 'PROJECT_CHANGED',
  SYSTEM_EVENT = 'SYSTEM_EVENT',
}

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  [IncidentSeverity.SEV1]: 'SEV-1 · Critical',
  [IncidentSeverity.SEV2]: 'SEV-2 · High',
  [IncidentSeverity.SEV3]: 'SEV-3 · Medium',
  [IncidentSeverity.SEV4]: 'SEV-4 · Low',
};

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  [IncidentStatus.OPEN]: 'Open',
  [IncidentStatus.INVESTIGATING]: 'Investigating',
  [IncidentStatus.MITIGATING]: 'Mitigating',
  [IncidentStatus.RESOLVED]: 'Resolved',
};

export const ENVIRONMENT_LABELS: Record<IncidentEnvironment, string> = {
  [IncidentEnvironment.PRODUCTION]: 'Production',
  [IncidentEnvironment.STAGING]: 'Staging',
  [IncidentEnvironment.DEVELOPMENT]: 'Development',
};

// =============================================================================
// Events
// =============================================================================

export enum EventSource {
  USER = 'USER',
  GITHUB = 'GITHUB',
  SENTRY = 'SENTRY',
  SLACK = 'SLACK',
  SYSTEM = 'SYSTEM',
  AI = 'AI',
}

// =============================================================================
// Integrations
// =============================================================================

export enum IntegrationProvider {
  GITHUB = 'GITHUB',
  SENTRY = 'SENTRY',
  SLACK = 'SLACK',
  JIRA = 'JIRA',
}

export enum IntegrationStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  ERROR = 'ERROR',
}

// =============================================================================
// Evidence
// =============================================================================

export enum EvidenceType {
  GITHUB_COMMIT = 'GITHUB_COMMIT',
  GITHUB_PR = 'GITHUB_PR',
  GITHUB_DEPLOYMENT = 'GITHUB_DEPLOYMENT',
  GITHUB_WORKFLOW_RUN = 'GITHUB_WORKFLOW_RUN',
  SENTRY_ERROR = 'SENTRY_ERROR',
  SLACK_MESSAGE = 'SLACK_MESSAGE',
  TIMELINE_EVENT = 'TIMELINE_EVENT',
  HISTORICAL_INCIDENT = 'HISTORICAL_INCIDENT',
  MANUAL = 'MANUAL',
}

export enum EvidenceSource {
  CORRELATION_ENGINE = 'CORRELATION_ENGINE',
  AI_SUGGESTED = 'AI_SUGGESTED',
  MANUAL = 'MANUAL',
}

// =============================================================================
// Postmortem
// =============================================================================

export enum PostmortemStatus {
  DRAFT = 'DRAFT',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  PUBLISHED = 'PUBLISHED',
}

export enum ActionItemStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ActionItemPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// =============================================================================
// Real-Time Socket Events (Phase 5)
// =============================================================================

export enum SocketEvent {
  // Client -> Server
  JOIN_INCIDENT = 'incident:join',
  LEAVE_INCIDENT = 'incident:leave',

  // Server -> Client
  PRESENCE_UPDATE = 'presence:update',
  INCIDENT_UPDATED = 'incident:updated',
  TIMELINE_EVENT = 'timeline:event',
  COMMENT_CREATED = 'comment:created',
  COMMENT_UPDATED = 'comment:updated',
  COMMENT_DELETED = 'comment:deleted',

  // GitHub Real-Time Integration (Phase 6)
  GITHUB_ACTIVITY_RECEIVED = 'github:activity_received',
  GITHUB_ACTIVITY_LINKED = 'github:activity_linked',

  // Sentry Real-Time Integration (Phase 7)
  SENTRY_SIGNAL_RECEIVED = 'sentry:signal_received',
  SENTRY_SIGNAL_LINKED = 'sentry:signal_linked',
}
