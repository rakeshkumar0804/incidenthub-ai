/**
 * Shared API types for IncidentHub AI.
 *
 * These types define the shape of API requests and responses.
 * Both the Express backend and the React frontend use these types.
 *
 * Rules:
 * - No framework-specific imports
 * - No business logic
 * - Types only — no implementations
 */

import type { PostmortemStatus, ActionItemPriority, ActionItemStatus, IntegrationProvider } from '../enums';

// =============================================================================
// API Response Envelope
// =============================================================================

/// All successful API responses are wrapped in this envelope.
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/// All error API responses follow this shape.
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/// Union type for all API responses.
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// =============================================================================
// Pagination
// =============================================================================

export interface PaginationMeta {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface PaginationQuery {
  page?: number;
  perPage?: number;
}

// =============================================================================
// Health Check
// =============================================================================

export type ServiceHealth = 'connected' | 'disconnected' | 'unknown';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  services: {
    database: ServiceHealth;
    redis?: ServiceHealth;
  };
}

// =============================================================================
// Common field types
// =============================================================================

/// ISO 8601 timestamp string
export type ISOTimestamp = string;

/// CUID string identifier
export type ID = string;

// =============================================================================
// Authentication & RBAC (Phase 2)
// =============================================================================

import type { OrgRole } from '../enums';

export interface UserDto {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
  createdAt: ISOTimestamp;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface OrgMemberDto {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  joinedAt: ISOTimestamp;
  organization?: OrganizationDto;
  user?: UserDto;
}

export interface AuthResponseData {
  user: UserDto;
  accessToken: string;
  activeOrganizationId?: string;
  organizations: OrgMemberDto[];
}

export type Permission =
  | 'organization:read'
  | 'organization:update'
  | 'members:read'
  | 'members:manage'
  | 'teams:read'
  | 'teams:manage'
  | 'projects:read'
  | 'projects:manage'
  | 'incidents:read'
  | 'incidents:create'
  | 'incidents:update'
  | 'incidents:delete'
  | 'incidents:comment'
  | 'incidents:assign'
  | 'analytics:read'
  | 'integrations:read'
  | 'integrations:manage';

// =============================================================================
// Workspace Hierarchy DTOs (Phase 3)
// =============================================================================

import type { InvitationStatus, ProjectStatus } from '../enums';

export interface InvitationDto {
  id: string;
  organizationId: string;
  email: string;
  role: OrgRole;
  invitedById: string;
  status: InvitationStatus;
  expiresAt: ISOTimestamp;
  createdAt: ISOTimestamp;
  invitedBy?: {
    id: string;
    name: string;
    email: string;
  };
  organization?: OrganizationDto;
}

export interface CreateInvitationResponseDto {
  invitation: InvitationDto;
  inviteUrl?: string;
}

export interface TeamMemberDto {
  id: string;
  teamId: string;
  userId: string;
  joinedAt: ISOTimestamp;
  user: UserDto;
}

export interface TeamDto {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  memberCount?: number;
  members?: TeamMemberDto[];
}

export interface ProjectDto {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  teamId: string | null;
  team?: {
    id: string;
    name: string;
  } | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  serviceCount?: number;
}

export interface ServiceDto {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  repositoryUrl: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  project?: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
  };
}

// =============================================================================
// Incident Management DTOs (Phase 4)
// =============================================================================

import type { IncidentSeverity, IncidentStatus, IncidentEnvironment, EventSource } from '../enums';

export interface IncidentDto {
  id: string;
  organizationId: string;
  projectId: string;
  serviceId: string | null;
  number: number;
  incidentNumber: string; // Formatted "INC-0001"
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  environment: IncidentEnvironment;
  detectedAt: ISOTimestamp;
  acknowledgedAt: ISOTimestamp | null;
  resolvedAt: ISOTimestamp | null;
  createdById: string;
  assignedToId: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  createdBy?: {
    id: string;
    name: string;
    email: string;
  };
  assignee?: {
    id: string;
    name: string;
    email: string;
  } | null;
  project?: {
    id: string;
    name: string;
    slug: string;
  };
  service?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  events?: IncidentTimelineEventDto[];
}

export interface IncidentTimelineEventDto {
  id: string;
  incidentId: string;
  organizationId: string;
  userId: string | null;
  source: EventSource;
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  occurredAt: ISOTimestamp;
  user?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

export interface PaginatedResponseData<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

// =============================================================================
// Real-Time Collaboration & Comments DTOs (Phase 5)
// =============================================================================

export interface IncidentCommentDto {
  id: string;
  incidentId: string;
  userId: string;
  parentId: string | null;
  content: string;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

export interface PresenceUserDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  socketId?: string;
  joinedAt: ISOTimestamp;
}

export interface SocketPresencePayload {
  incidentId: string;
  viewers: PresenceUserDto[];
}

// =============================================================================
// GitHub Integration DTOs (Phase 6)
// =============================================================================

export interface GitHubIntegrationDto {
  id: string;
  organizationId: string;
  provider: 'GITHUB';
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  metadata: {
    appId?: string;
    installationId?: string;
    accountName?: string;
    accountType?: 'User' | 'Organization';
    connectedAt?: string;
    connectedBy?: string;
    authType?: 'GITHUB_APP' | 'PAT';
    githubUsername?: string;
  } | null;
  lastSyncAt: ISOTimestamp | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface ConnectGitHubAppInput {
  installationId: string;
  appId?: string;
  privateKey?: string;
}

export interface ConnectGitHubPatInput {
  personalAccessToken: string;
}

export interface GitHubRepositoryDto {
  id: string;
  organizationId: string;
  integrationId: string;
  githubRepoId: string;
  name: string;
  fullName: string;
  owner: string;
  defaultBranch: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  pushedAt: ISOTimestamp | null;
  projectId: string | null;
  serviceId: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  project?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  service?: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface LinkRepoInput {
  projectId?: string | null;
  serviceId?: string | null;
}

export interface GitHubCommitDto {
  id: string;
  repositoryId: string;
  sha: string;
  authorName: string;
  authorEmail: string | null;
  message: string;
  branch: string;
  url: string;
  committedAt: ISOTimestamp;
  createdAt: ISOTimestamp;
}

export interface GitHubPullRequestDto {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  state: string;
  author: string;
  branch: string;
  targetBranch: string;
  url: string;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
  mergedAt: ISOTimestamp | null;
  closedAt: ISOTimestamp | null;
}

export interface GitHubDeploymentDto {
  id: string;
  repositoryId: string;
  deploymentId: string;
  environment: string;
  state: string;
  commitSha: string;
  creator: string;
  url: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface GitHubWorkflowRunDto {
  id: string;
  repositoryId: string;
  runId: string;
  name: string;
  event: string;
  status: string;
  conclusion: string | null;
  branch: string;
  commitSha: string;
  url: string;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface LinkIncidentActivityInput {
  activityType: 'GITHUB_COMMIT' | 'GITHUB_PR' | 'GITHUB_DEPLOYMENT' | 'GITHUB_WORKFLOW_RUN';
  activityId: string;
}

// =============================================================================
// Sentry Integration DTOs (Phase 7)
// =============================================================================

export interface SentryIntegrationDto {
  id: string;
  organizationId: string;
  provider: 'SENTRY';
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  metadata: {
    sentryOrgSlug?: string;
    authType?: 'OAUTH' | 'TOKEN';
    connectedAt?: string;
    connectedBy?: string;
    scope?: string[];
  } | null;
  lastSyncAt: ISOTimestamp | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface ConnectSentryOAuthInput {
  code: string;
  state?: string;
  codeVerifier?: string;
  redirectUri: string;
  sentryOrgSlug?: string;
}

export interface SentryOAuthAuthorizeResponseDto {
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  authorizeUrl: string;
}

export interface SentryIssueDto {
  id: string;
  organizationId: string;
  integrationId: string;
  sentryIssueId: string;
  projectSlug: string;
  title: string;
  culprit: string | null;
  level: string;
  userCount: number;
  eventCount: number;
  firstSeen: ISOTimestamp;
  lastSeen: ISOTimestamp;
  release: string | null;
  environment: string;
  permalink: string | null;
  stackTrace: string | null;
  projectId: string | null;
  serviceId: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface SentryRuleDto {
  id: string;
  organizationId: string;
  name: string;
  environment: string | null;
  minEventCount: number;
  minUserCount: number;
  levelFilter: string | null;
  mappedSeverity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  autoCreateIncident: boolean;
  projectId: string | null;
  serviceId: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface CreateSentryRuleInput {
  name: string;
  environment?: string | null;
  minEventCount?: number;
  minUserCount?: number;
  levelFilter?: string | null;
  mappedSeverity?: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  autoCreateIncident?: boolean;
  projectId?: string | null;
  serviceId?: string | null;
}

export interface LinkSentryIssueInput {
  sentryIssueId: string;
}

// =============================================================================
// Correlation Engine DTOs (Phase 8)
// =============================================================================

export type CorrelationRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type EvidenceConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';
export type CorrelationTriggerType =
  | 'AUTOMATIC_INCIDENT_CREATED'
  | 'AUTOMATIC_INCIDENT_UPDATED'
  | 'AUTOMATIC_SIGNAL_RECEIVED'
  | 'MANUAL_REQUEST'
  | 'RERUN_REQUEST';

export interface CorrelationReasonsDto {
  temporalProximity: boolean;
  projectMatch: boolean;
  serviceMatch: boolean;
  environmentMatch: boolean;
  deploymentRelation: boolean;
  commitRelation: boolean;
  sentrySpike: boolean;
  workflowFailure: boolean;
}

export interface IncidentEvidenceDto {
  id: string;
  incidentId: string;
  correlationRunId: string | null;
  externalEventId: string | null;
  type: string;
  source: string;
  externalRefId: string;
  confidenceTier: EvidenceConfidenceTier | null;
  title: string;
  description: string | null;
  url: string | null;
  confidence: number | null;
  reasons: CorrelationReasonsDto | null;
  scoreBreakdown: Record<string, number> | null;
  metadata: Record<string, unknown> | null;
  acknowledgedAt: ISOTimestamp | null;
  dismissedAt: ISOTimestamp | null;
  dismissedById: string | null;
  addedAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface CorrelationRunDto {
  id: string;
  organizationId: string;
  incidentId: string;
  triggerType: CorrelationTriggerType;
  status: CorrelationRunStatus;
  windowStart: ISOTimestamp;
  windowEnd: ISOTimestamp;
  candidateCount: number;
  correlatedCount: number;
  isTruncated: boolean;
  error: string | null;
  triggeredById: string | null;
  startedAt: ISOTimestamp;
  completedAt: ISOTimestamp | null;
}

export interface TriggerCorrelationInput {
  triggerType?: CorrelationTriggerType;
}

export interface UpdateEvidenceStatusInput {
  action: 'acknowledge' | 'dismiss' | 'reset';
}

// =============================================================================
// AI Investigation Engine DTOs (Phase 9)
// =============================================================================

export type InvestigationStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type InvestigationConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCERTAIN';
export type InvestigationTriggerType =
  | 'AUTOMATIC_CORRELATION_COMPLETED'
  | 'MANUAL_REQUEST'
  | 'RERUN_REQUEST';

export interface SupportingEvidenceDto {
  evidenceId: string;
  claim: string;
  relevanceReason: string;
}

export interface ContradictoryEvidenceDto {
  evidenceId: string;
  contradiction: string;
}

export interface AlternativeHypothesisDto {
  hypothesis: string;
  likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
  evidenceIds: string[];
}

export interface RecommendedActionDto {
  action: string;
  priority: 'IMMEDIATE' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'MITIGATION' | 'PREVENTION' | 'INVESTIGATION';
}

export interface InvestigationRunDto {
  id: string;
  organizationId: string;
  incidentId: string;
  correlationRunId: string | null;
  status: InvestigationStatus;
  triggerType: InvestigationTriggerType;
  confidenceTier: InvestigationConfidenceTier | null;
  confidence: number | null;
  incidentSummary: string | null;
  probableRootCause: string | null;
  supportingEvidence: SupportingEvidenceDto[] | null;
  contradictoryEvidence: ContradictoryEvidenceDto[] | null;
  alternativeHypotheses: AlternativeHypothesisDto[] | null;
  impactAssessment: string | null;
  riskAssessment: string | null;
  recommendedActions: RecommendedActionDto[] | null;
  uncertainty: string[] | null;
  investigationLimitations: string | null;
  providerName: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  validationError: string | null;
  triggeredById: string | null;
  startedAt: ISOTimestamp;
  completedAt: ISOTimestamp | null;
}

export interface TriggerInvestigationInput {
  triggerType?: InvestigationTriggerType;
}

// =============================================================================
// Incident Replay Engine DTOs (Phase 10)
// =============================================================================

export type ReplayRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';
export type ReplayTriggerType =
  | 'AUTOMATIC_INCIDENT_RESOLVED'
  | 'MANUAL_REQUEST'
  | 'RERUN_REQUEST';
export type ReplayCategory =
  | 'STATE_CHANGE'
  | 'TELEMETRY'
  | 'CORRELATION'
  | 'INVESTIGATION'
  | 'COMMUNICATION';

export interface ReplayEventDto {
  id: string;
  replayRunId: string;
  incidentId: string;
  organizationId: string;
  sequenceIndex: number;
  category: ReplayCategory;
  categoryWeight: number;
  eventType: string;
  source: string;
  sourceEventId: string;
  timestamp: ISOTimestamp;
  actorName: string | null;
  actorEmail: string | null;
  title: string;
  description: string | null;
  externalUrl: string | null;
  evidenceId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ReplayRunDto {
  id: string;
  organizationId: string;
  incidentId: string;
  triggerType: ReplayTriggerType;
  status: ReplayRunStatus;
  windowStart: ISOTimestamp;
  windowEnd: ISOTimestamp;
  totalEventCount: number;
  isTruncated: boolean;
  error: string | null;
  triggeredById: string | null;
  startedAt: ISOTimestamp;
  completedAt: ISOTimestamp | null;
}

export interface TriggerReplayInput {
  triggerType?: ReplayTriggerType;
}

// =============================================================================
// AI Postmortem Engine DTOs (Phase 11)
// =============================================================================

export type PostmortemTriggerType =
  | 'AUTOMATIC_INCIDENT_RESOLVED'
  | 'MANUAL_REQUEST'
  | 'REGENERATE_REQUEST';

export type ClaimType =
  | 'FACT'
  | 'INVESTIGATION_CONCLUSION'
  | 'RECOMMENDATION'
  | 'UNCERTAINTY'
  | 'METADATA'
  | 'UNSUPPORTED_CLAIM';

export interface EvidenceCitationDto {
  sourceId: string;
  sourceType: 'EVIDENCE' | 'REPLAY_EVENT' | 'INVESTIGATION_RUN' | 'COMMENT';
  claimType: ClaimType;
  description: string;
  isValid: boolean;
}

export interface PostmortemVersionDto {
  id: string;
  postmortemId: string;
  organizationId: string;
  incidentId: string;
  versionNumber: number;
  status: PostmortemStatus;
  isCurrent: boolean;
  aiGenerated: boolean;
  summary: string | null;
  impact: string | null; // Normalized field name
  incidentTimeline: string | null;
  rootCause: string | null;
  contributingFactors: string | null;
  detection: string | null;
  resolution: string | null;
  wentWell: string | null;
  wentWrong: string | null;
  uncertainty: string | null;
  evidenceReferences: EvidenceCitationDto[] | null;
  correlationRunId: string | null;
  investigationRunId: string | null;
  replayRunId: string | null;
  providerName: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  schemaVersion: string;
  createdById: string | null;
  approvedById: string | null;
  publishedById: string | null;
  publishedAt: ISOTimestamp | null;
  createdAt: ISOTimestamp;
}

export interface ActionItemDto {
  id: string;
  organizationId: string;
  postmortemId: string;
  postmortemVersionId: string | null;
  incidentId: string;
  title: string;
  description: string | null;
  status: ActionItemStatus;
  priority: ActionItemPriority;
  assigneeId: string | null;
  dueDate: ISOTimestamp | null;
  jiraIssueId: string | null;
  jiraIssueUrl: string | null;
  createdById: string | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface PostmortemDto {
  id: string;
  organizationId: string;
  incidentId: string;
  activeVersionId: string | null;
  status: PostmortemStatus;
  activeVersion: PostmortemVersionDto | null;
  versions: PostmortemVersionDto[];
  actionItems: ActionItemDto[];
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface GeneratePostmortemInput {
  triggerType?: PostmortemTriggerType;
}

export interface UpdatePostmortemInput {
  summary?: string;
  impact?: string;
  incidentTimeline?: string;
  rootCause?: string;
  contributingFactors?: string;
  detection?: string;
  resolution?: string;
  wentWell?: string;
  wentWrong?: string;
  uncertainty?: string;
  status?: PostmortemStatus;
}

export interface CreateActionItemInput {
  title: string;
  description?: string;
  priority?: ActionItemPriority;
  assigneeId?: string;
  dueDate?: ISOTimestamp;
}

export interface UpdateActionItemInput {
  title?: string;
  description?: string;
  priority?: ActionItemPriority;
  status?: ActionItemStatus;
  assigneeId?: string;
  dueDate?: ISOTimestamp;
}

// =============================================================================
// Analytics + Engineering Intelligence DTOs (Phase 12)
// =============================================================================

export type AnalyticsTimeWindow = '24h' | '7d' | '30d' | '90d' | 'custom';

export interface MetricValueStatus<T> {
  status: 'OK' | 'NO_DATA' | 'INSUFFICIENT_DATA' | 'NO_RESOLVED_INCIDENTS' | 'UNAVAILABLE';
  value: T | null;
  sampleCount: number;
  message?: string;
}

export interface KpiOverviewDto {
  totalIncidents: number;
  activeIncidents: number;
  resolvedIncidents: number;
  sev1Count: number;
  sev2Count: number;
  sev3Count: number;
  sev4Count: number;
  mttd: MetricValueStatus<number>; // Value in ms
  mttr: MetricValueStatus<number>; // Value in ms
  cfr: MetricValueStatus<number>;  // Value in %
  totalDeployments: number;
  associatedDeploymentsCount: number;
  missingDataCount: number;
  anomalyCount: number;
  /**
   * Exact approved semantic description for MTTD:
   * "Time from monitoring-source anomaly detection to IncidentHub incident creation."
   */
  mttdDocumentationLabel: string;
}

export interface TimeSeriesBucketDto {
  bucketStart: ISOTimestamp;
  bucketEnd: ISOTimestamp;
  label: string;
  count: number;
  sev1Count: number;
  sev2Count: number;
  sev3Count: number;
  sev4Count: number;
}

export interface ServiceRankingDto {
  serviceId: string;
  serviceName: string;
  projectId: string;
  projectName: string;
  totalIncidents: number;
  sev1Count: number;
  mttrMs: number | null;
  mttdMs: number | null;
  cfrPercent: number | null;
}

export interface DeploymentCorrelationDto {
  deploymentId: string;
  repositoryId: string;
  repositoryName: string;
  commitSha: string;
  environment: string;
  deployedAt: ISOTimestamp;
  creator: string;
  candidateAssociatedIncidentsCount: number;
  candidateAssociatedIncidents: Array<{
    id: string;
    number: number;
    title: string;
    severity: string;
    status: string;
    detectedAt: ISOTimestamp;
  }>;
}

export interface EngineeringSignalDto {
  id: string;
  type: 'HIGH_INCIDENT_FREQUENCY' | 'ELEVATED_MTTR' | 'RECURRING_FAILURE_CATEGORY' | 'CHANGE_SENSITIVE_SERVICE';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  entityId: string | null;
  entityName: string | null;
  provenance: {
    incidentIds: string[];
    deploymentIds?: string[];
  };
}

export interface AnalyticsOverviewResponseDto {
  window: AnalyticsTimeWindow;
  periodStart: ISOTimestamp;
  periodEnd: ISOTimestamp;
  overview: KpiOverviewDto;
  timeSeries: TimeSeriesBucketDto[];
  signals: EngineeringSignalDto[];
}

export interface AnalyticsDrilldownResponseDto {
  metric: string;
  totalCount: number;
  incidentIds: string[];
  deploymentIds?: string[];
}

// =============================================================================
// PHASE 13 — SLACK + JIRA INTEGRATIONS DTOs
// =============================================================================

export type IntegrationDeliveryStatus = 'PENDING' | 'PROCESSING' | 'RETRYING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export interface SlackConfigDto {
  teamId?: string;
  teamName?: string;
  botUserId?: string;
  defaultChannelId?: string;
  autoCreateChannels?: boolean;
  notifySeverities?: IncidentSeverity[];
}

export interface JiraConfigDto {
  siteId?: string;
  siteUrl?: string;
  defaultProjectKey?: string;
  authMode?: 'OAUTH_3LO' | 'API_TOKEN';
}

export interface ExternalReferenceDto {
  id: string;
  organizationId: string;
  integrationId: string;
  provider: IntegrationProvider;
  entityType: string;
  entityId: string;
  externalResourceType: string;
  externalId: string;
  externalUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface IntegrationDeliveryDto {
  id: string;
  organizationId: string;
  integrationId: string;
  provider: IntegrationProvider;
  eventType: string;
  sanitizedBody: Record<string, unknown>;
  status: IntegrationDeliveryStatus;
  attemptCount: number;
  lastError?: string | null;
  nextRetryAt?: ISOTimestamp | null;
  createdAt: ISOTimestamp;
  updatedAt: ISOTimestamp;
}

export interface CreateJiraIssueInputDto {
  projectKey?: string;
  issueType?: string;
}

export interface CreateJiraIssueResponseDto {
  jiraIssueId: string;
  jiraIssueUrl: string;
  externalReferenceId: string;
}

export interface SlackConnectResponseDto {
  authorizeUrl: string;
}

export interface JiraConnectResponseDto {
  authorizeUrl: string;
}
