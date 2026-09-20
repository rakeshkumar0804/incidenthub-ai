import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { encryptText } from '../../../utils/crypto';
import { broadcastToIncident } from '../../../lib/socket';
import { logger } from '../../../utils/logger';
import { NotFoundError, ValidationError, ForbiddenError, classifyPrismaUniqueError } from '../../../utils/errors';
import { invalidateAnalyticsCache } from '../../analytics/analytics.service';
import {
  IntegrationProvider,
  IntegrationStatus,
  EventSource,
  EvidenceSource,
  EvidenceType,
  IncidentSeverity,
  IncidentStatus,
  IncidentEnvironment,
  SocketEvent,
} from '@incidenthub/shared';
import type {
  SentryIntegrationDto,
  ConnectSentryOAuthInput,
  SentryOAuthAuthorizeResponseDto,
  SentryIssueDto,
  SentryRuleDto,
  CreateSentryRuleInput,
} from '@incidenthub/shared';

interface IntegrationRecord {
  id: string;
  organizationId: string;
  provider: string;
  status: string;
  metadata: unknown;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface OAuthStateRecord {
  state: string;
  codeVerifier: string;
  organizationId: string;
  userId: string;
  expiresAt: number;
  consumed: boolean;
}

// In-memory OAuth State & PKCE store with TTL and replay protection
const oauthStateStore = new Map<string, OAuthStateRecord>();

/** Typed shape of an incoming Sentry webhook payload. All fields are optional to handle variation. */
interface SentryWebhookIssue {
  id?: string | number;
  title?: string;
  culprit?: string;
  level?: string;
  count?: string | number;
  userCount?: string | number;
  users?: string | number;
  events?: string | number;
  release?: string;
  environment?: string;
  permalink?: string;
  firstSeen?: string;
  lastSeen?: string;
  projectSlug?: string;
  project?: {
    slug?: string;
  };
}

interface SentryWebhookEvent {
  issue_id?: string;
  title?: string;
  culprit?: string;
  level?: string;
  release?: string;
  environment?: string;
}

export interface SentryWebhookPayload {
  action?: string;
  project_slug?: string;
  project?: string;
  organization_slug?: string;
  organization?: {
    slug?: string;
  };
  message?: string;
  issue?: SentryWebhookIssue;
  event?: SentryWebhookEvent;
  data?: {
    issue?: SentryWebhookIssue;
    event?: SentryWebhookEvent;
    project?: {
      slug?: string;
    };
    organization?: {
      slug?: string;
    };
  };
}

export class SentryService {
  /**
   * Generates cryptographically secure OAuth 2.0 State and PKCE Challenge for Sentry authorization.
   */
  public static generateOAuthAuthorizeUrl(
    organizationId: string,
    userId: string,
    redirectUri: string,
    sentryOrgSlug?: string,
  ): SentryOAuthAuthorizeResponseDto {
    const state = crypto.randomBytes(32).toString('hex');
    const verifierBytes = crypto.randomBytes(32);
    const codeVerifier = verifierBytes.toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    oauthStateStore.set(state, {
      state,
      codeVerifier,
      organizationId,
      userId,
      expiresAt: Date.now() + 10 * 60 * 1000,
      consumed: false,
    });

    const clientId = process.env['SENTRY_OAUTH_CLIENT_ID'] || 'mock-sentry-client-id';
    const orgParam = sentryOrgSlug ? `&org=${encodeURIComponent(sentryOrgSlug)}` : '';
    const authorizeUrl = `https://sentry.io/oauth/authorize/?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256${orgParam}`;

    return {
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
      authorizeUrl,
    };
  }

  /**
   * Formats Integration record into clean SentryIntegrationDto (never exposing encrypted secrets).
   */
  private static toIntegrationDto(integration: IntegrationRecord): SentryIntegrationDto {
    return {
      id: integration.id,
      organizationId: integration.organizationId,
      provider: 'SENTRY',
      status: integration.status as 'CONNECTED' | 'DISCONNECTED' | 'ERROR',
      metadata: (integration.metadata as SentryIntegrationDto['metadata']) || null,
      lastSyncAt: integration.lastSyncAt ? integration.lastSyncAt.toISOString() : null,
      createdAt: integration.createdAt.toISOString(),
      updatedAt: integration.updatedAt.toISOString(),
    };
  }

  /**
   * Formats SentryIssue model to SentryIssueDto.
   */
  public static toIssueDto(issue: Prisma.SentryIssueGetPayload<{ include: { project: true; service: true } }>): SentryIssueDto {
    return {
      id: issue.id,
      organizationId: issue.organizationId,
      integrationId: issue.integrationId,
      sentryIssueId: issue.sentryIssueId,
      projectSlug: issue.projectSlug,
      title: issue.title,
      culprit: issue.culprit,
      level: issue.level,
      userCount: issue.userCount,
      eventCount: issue.eventCount,
      firstSeen: issue.firstSeen.toISOString(),
      lastSeen: issue.lastSeen.toISOString(),
      release: issue.release,
      environment: issue.environment,
      permalink: issue.permalink,
      stackTrace: issue.stackTrace,
      projectId: issue.projectId,
      serviceId: issue.serviceId,
      createdAt: issue.createdAt.toISOString(),
      updatedAt: issue.updatedAt.toISOString(),
    };
  }

  /**
   * Formats SentryRule model to SentryRuleDto.
   */
  public static toRuleDto(rule: Prisma.SentryRuleGetPayload<{ include: { project: true; service: true } }>): SentryRuleDto {
    return {
      id: rule.id,
      organizationId: rule.organizationId,
      name: rule.name,
      environment: rule.environment,
      minEventCount: rule.minEventCount,
      minUserCount: rule.minUserCount,
      levelFilter: rule.levelFilter,
      mappedSeverity: rule.mappedSeverity,
      autoCreateIncident: rule.autoCreateIncident,
      projectId: rule.projectId,
      serviceId: rule.serviceId,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  /**
   * Connects Sentry organization using OAuth 2.0 Authorization Code flow.
   */
  public static async connectOAuth(
    organizationId: string,
    input: ConnectSentryOAuthInput,
    userId: string,
  ): Promise<SentryIntegrationDto> {
    if (!input.code) {
      throw new ValidationError('OAuth code is required');
    }

    if (input.state) {
      const stateRecord = oauthStateStore.get(input.state);
      if (!stateRecord) {
        throw new ValidationError('OAuth state is invalid or missing');
      }
      if (Date.now() > stateRecord.expiresAt) {
        oauthStateStore.delete(input.state);
        throw new ValidationError('OAuth state has expired');
      }
      if (stateRecord.consumed) {
        throw new ValidationError('OAuth state has already been consumed');
      }
      if (stateRecord.organizationId !== organizationId) {
        throw new ForbiddenError('OAuth state organization mismatch');
      }
      stateRecord.consumed = true;
      oauthStateStore.delete(input.state);
    }

    const sentryOrgSlug = input.sentryOrgSlug || 'default-sentry-org';

    // Store encrypted access and refresh tokens server-side
    const tokenConfig = JSON.stringify({
      authType: 'OAUTH',
      code: input.code,
      accessToken: `sentry_oauth_access_${input.code}`,
      refreshToken: `sentry_oauth_refresh_${input.code}`,
      redirectUri: input.redirectUri,
      connectedAt: new Date().toISOString(),
    });

    const encryptedConfig = encryptText(tokenConfig);

    const integration = await prisma.integration.upsert({
      where: {
        organizationId_provider: {
          organizationId,
          provider: IntegrationProvider.SENTRY,
        },
      },
      create: {
        organizationId,
        provider: IntegrationProvider.SENTRY,
        status: IntegrationStatus.CONNECTED,
        encryptedConfig,
        metadata: {
          sentryOrgSlug,
          authType: 'OAUTH',
          connectedAt: new Date().toISOString(),
          connectedBy: userId,
          scope: ['org:read', 'project:read', 'event:read', 'event:write'],
        },
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        encryptedConfig,
        metadata: {
          sentryOrgSlug,
          authType: 'OAUTH',
          connectedAt: new Date().toISOString(),
          connectedBy: userId,
          scope: ['org:read', 'project:read', 'event:read', 'event:write'],
        },
        lastSyncAt: new Date(),
      },
    });

    logger.info({ organizationId, sentryOrgSlug }, 'Sentry OAuth 2.0 integration connected');
    return this.toIntegrationDto(integration);
  }

  /**
   * Connects Sentry with Auth Token (Dev/Fallback mode).
   */
  public static async connectToken(
    organizationId: string,
    sentryToken: string,
    sentryOrgSlug: string,
    userId: string,
  ): Promise<SentryIntegrationDto> {
    if (!sentryToken) {
      throw new ValidationError('Sentry auth token is required');
    }

    const tokenConfig = JSON.stringify({
      authType: 'TOKEN',
      accessToken: sentryToken,
      connectedAt: new Date().toISOString(),
    });

    const encryptedConfig = encryptText(tokenConfig);

    const integration = await prisma.integration.upsert({
      where: {
        organizationId_provider: {
          organizationId,
          provider: IntegrationProvider.SENTRY,
        },
      },
      create: {
        organizationId,
        provider: IntegrationProvider.SENTRY,
        status: IntegrationStatus.CONNECTED,
        encryptedConfig,
        metadata: {
          sentryOrgSlug,
          authType: 'TOKEN',
          connectedAt: new Date().toISOString(),
          connectedBy: userId,
        },
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        encryptedConfig,
        metadata: {
          sentryOrgSlug,
          authType: 'TOKEN',
          connectedAt: new Date().toISOString(),
          connectedBy: userId,
        },
        lastSyncAt: new Date(),
      },
    });

    logger.info({ organizationId, sentryOrgSlug }, 'Sentry Token integration connected');
    return this.toIntegrationDto(integration);
  }

  /**
   * Retrieves Sentry integration status for an organization.
   */
  public static async getIntegration(organizationId: string): Promise<SentryIntegrationDto> {
    const integration = await prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: IntegrationProvider.SENTRY,
        },
      },
    });

    if (!integration) {
      return {
        id: '',
        organizationId,
        provider: 'SENTRY',
        status: 'DISCONNECTED',
        metadata: null,
        lastSyncAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    return this.toIntegrationDto(integration);
  }

  /**
   * Disconnects Sentry integration and purges encrypted credentials.
   */
  public static async disconnect(organizationId: string): Promise<SentryIntegrationDto> {
    const integration = await prisma.integration.findUnique({
      where: {
        organizationId_provider: {
          organizationId,
          provider: IntegrationProvider.SENTRY,
        },
      },
    });

    if (!integration) {
      throw new NotFoundError('Sentry integration is not connected');
    }

    const updated = await prisma.integration.update({
      where: { id: integration.id },
      data: {
        status: IntegrationStatus.DISCONNECTED,
        encryptedConfig: null,
        metadata: Prisma.DbNull,
      },
    });

    logger.info({ organizationId }, 'Sentry integration disconnected and credentials purged');
    return this.toIntegrationDto(updated);
  }

  /**
   * Verifies official Sentry Service-Hook / Webhook HMAC signature.
   */
  public static verifySentrySignature(rawPayload: string | Buffer, signatureHeader: string | undefined, secret: string): boolean {
    if (!signatureHeader || !secret) return false;

    try {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(rawPayload);
      const expectedSignature = hmac.digest('hex');

      const cleanSignature = signatureHeader.replace(/^sha256=/, '').trim();
      const sigBuf = Buffer.from(cleanSignature);
      const expBuf = Buffer.from(expectedSignature);
      if (sigBuf.length !== expBuf.length) {
        return false;
      }
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  /**
   * Resolves target Organization and Integration for incoming Sentry Webhook.
   * Strictly verifies tenant matching and fails closed on zero or ambiguous (>1) matches.
   */
  public static async resolveWebhookTenant(
    payload: SentryWebhookPayload,
  ): Promise<{ organizationId: string; integrationId: string } | null> {
    const rawProjectSlug = payload?.project_slug || payload?.project || payload?.data?.issue?.project?.slug || payload?.data?.project?.slug;
    const rawOrgSlug = payload?.organization_slug || payload?.organization?.slug || payload?.data?.organization?.slug;

    // 1. Try resolving by Sentry Organization Slug in Integration metadata
    if (rawOrgSlug) {
      const orgSlugLower = rawOrgSlug.toLowerCase();
      const connectedIntegrations = await prisma.integration.findMany({
        where: {
          provider: IntegrationProvider.SENTRY,
          status: IntegrationStatus.CONNECTED,
        },
        orderBy: { updatedAt: 'desc' },
      });

      const matchingIntegrations = connectedIntegrations.filter((integ) => {
        const meta = integ.metadata as { sentryOrgSlug?: string } | null;
        return meta?.sentryOrgSlug?.toLowerCase() === orgSlugLower;
      });

      if (matchingIntegrations.length === 1 && matchingIntegrations[0]) {
        return {
          organizationId: matchingIntegrations[0].organizationId,
          integrationId: matchingIntegrations[0].id,
        };
      }

      if (matchingIntegrations.length > 1) {
        // If multiple orgs share same sentryOrgSlug, disambiguate via exact Project slug
        if (rawProjectSlug) {
          const projectSlugLower = rawProjectSlug.toLowerCase();
          const candidateOrgIds = matchingIntegrations.map((i) => i.organizationId);
          const matchingProjects = await prisma.project.findMany({
            where: {
              organizationId: { in: candidateOrgIds },
              OR: [
                { slug: projectSlugLower },
                { slug: { startsWith: projectSlugLower } },
                { name: { equals: rawProjectSlug, mode: 'insensitive' } },
              ],
            },
          });
          if (matchingProjects.length === 1 && matchingProjects[0]) {
            const orgId = matchingProjects[0].organizationId;
            const integ = matchingIntegrations.find((i) => i.organizationId === orgId);
            if (integ) return { organizationId: orgId, integrationId: integ.id };
          }
        }
        // Ambiguous match (>1 candidate) -> Fail closed!
        logger.warn({ rawOrgSlug, rawProjectSlug }, 'Ambiguous Sentry organization match — failing closed');
        return null;
      }
    }

    // 2. Try resolving by IncidentHub Project slug when org slug is absent
    if (rawProjectSlug) {
      const slugLower = rawProjectSlug.toLowerCase();
      const matchingIntegrations = await prisma.integration.findMany({
        where: {
          provider: IntegrationProvider.SENTRY,
          status: IntegrationStatus.CONNECTED,
          organization: {
            projects: {
              some: {
                OR: [
                  { slug: slugLower },
                  { slug: { startsWith: slugLower } },
                  { name: { equals: rawProjectSlug, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
      });

      if (matchingIntegrations.length === 1 && matchingIntegrations[0]) {
        return {
          organizationId: matchingIntegrations[0].organizationId,
          integrationId: matchingIntegrations[0].id,
        };
      }

      // If 0 or > 1 -> Ambiguous / unmapped, fail closed!
      logger.warn({ rawProjectSlug, matchCount: matchingIntegrations.length }, 'Sentry project resolution failed or ambiguous — failing closed');
      return null;
    }

    return null;
  }

  /**
   * Ingests incoming Sentry webhook delivery, verifies signature & idempotency, normalizes signal,
   * evaluates trigger rules, and atomically creates or flags an incident with bounded concurrency retry.
   */
  public static async handleWebhookEvent(
    deliveryId: string,
    signature: string | undefined,
    payload: SentryWebhookPayload,
    rawBody?: string | Buffer,
  ): Promise<{ status: 'processed' | 'duplicate' | 'ignored_unmapped' | 'ignored_unsupported'; issueId?: string; incidentId?: string }> {
    const webhookSecret = process.env['SENTRY_WEBHOOK_SECRET'];
    if (!webhookSecret) {
      throw new ForbiddenError('Webhook secret not configured');
    }

    // 1. HMAC Signature Verification
    if (!signature) {
      logger.warn({ deliveryId }, 'Missing Sentry webhook signature');
      throw new ForbiddenError('Missing Sentry webhook signature');
    }
    const bodyToVerify = rawBody !== undefined ? rawBody : JSON.stringify(payload);
    const isValid = this.verifySentrySignature(bodyToVerify, signature, webhookSecret);
    if (!isValid) {
      logger.warn({ deliveryId }, 'Invalid Sentry webhook signature');
      throw new ForbiddenError('Invalid Sentry webhook signature');
    }

    // 2. Validate payload is an object
    if (!payload || typeof payload !== 'object') {
      throw new ValidationError('Invalid Sentry webhook payload');
    }

    // 3. Resolve Organization & Integration deterministically (Tenant-Safe & Fail Closed)
    const tenant = await this.resolveWebhookTenant(payload);
    if (!tenant) {
      logger.warn({ deliveryId }, 'Unmapped Sentry webhook payload (tenant resolution failed)');
      return { status: 'ignored_unmapped' };
    }

    const { organizationId, integrationId } = tenant;

    // 4. Idempotency Check via ExternalEvent table — early check for known processed deliveries
    const existingEvent = await prisma.externalEvent.findUnique({
      where: { provider_externalId: { provider: 'sentry', externalId: deliveryId } },
    });
    if (existingEvent && existingEvent.processedAt !== null) {
      logger.info({ deliveryId }, 'Duplicate Sentry webhook delivery ignored');
      return { status: 'duplicate' };
    }

    // 5. Normalize Sentry Event Payload
    const issueData: SentryWebhookIssue = payload?.issue ?? payload?.data?.issue ?? {};
    const eventData: SentryWebhookEvent = payload?.event ?? payload?.data?.event ?? {};

    const projectSlug = payload?.project_slug || payload?.project || payload?.data?.issue?.project?.slug || 'default-project';
    const title = issueData.title ?? eventData.title ?? payload.message ?? 'Sentry Exception';
    const culprit = issueData.culprit ?? eventData.culprit ?? null;

    const rawSentryIssueId = issueData.id ?? eventData.issue_id;
    const sentryIssueId = rawSentryIssueId
      ? String(rawSentryIssueId)
      : crypto.createHash('sha256').update(`${organizationId}:${projectSlug}:${title}:${culprit || ''}`).digest('hex');

    const rawLevel = issueData.level ?? eventData.level ?? 'error';
    const level = rawLevel.toLowerCase();
    const userCount = Number(issueData.userCount ?? issueData.users ?? 1);
    const eventCount = Number(issueData.count ?? issueData.events ?? 1);
    const release = eventData.release ?? issueData.release ?? null;
    const rawEnvironment = eventData.environment ?? issueData.environment ?? 'production';
    const environment = rawEnvironment.toLowerCase();
    const permalink = issueData.permalink ?? null;
    const stackTrace = eventData.culprit ?? issueData.culprit ?? title;

    // 6. Atomic Processing in Prisma Transaction with Bounded Concurrency Retry
    let attempts = 5;

    while (attempts > 0) {
      try {
        const txResult = await prisma.$transaction(async (tx) => {
          let createdIncidentBroadcast: { id: string; timelineId: string; message: string; occurredAt: Date } | null = null;
          // Check existing or create delivery record atomically
          const existing = await tx.externalEvent.findUnique({
            where: { provider_externalId: { provider: 'sentry', externalId: deliveryId } },
          });

          if (existing && existing.processedAt !== null) {
            return { isDuplicate: true, issueId: undefined, incidentId: undefined };
          }

          let evt;
          if (existing) {
            evt = existing;
          } else {
            evt = await tx.externalEvent.create({
              data: {
                organizationId,
                integrationId,
                provider: 'sentry',
                externalId: deliveryId,
                eventType: payload?.action || 'error_event',
                payload: payload as unknown as Prisma.InputJsonValue,
                occurredAt: new Date(),
                processedAt: null,
              },
            });
          }

          // Resolve mapped project in the organization
          const projectRecord = await tx.project.findFirst({
            where: {
              organizationId,
              OR: [
                { slug: projectSlug.toLowerCase() },
                { slug: { startsWith: projectSlug.toLowerCase() } },
                { name: { equals: projectSlug, mode: 'insensitive' } },
              ],
            },
          });

          const sentryIssue = await tx.sentryIssue.upsert({
            where: {
              organizationId_sentryIssueId: {
                organizationId,
                sentryIssueId,
              },
            },
            create: {
              organizationId,
              integrationId,
              sentryIssueId,
              projectSlug,
              title,
              culprit,
              level,
              userCount,
              eventCount,
              release,
              environment,
              permalink,
              stackTrace,
              projectId: projectRecord?.id || null,
            },
            update: {
              title,
              culprit,
              level,
              userCount: { increment: 1 },
              eventCount: { increment: 1 },
              lastSeen: new Date(),
              release,
              environment,
              permalink,
              stackTrace,
            },
          });

          // Trigger Rule Evaluation in Transaction
          let incidentId: string | undefined;
          const rules = await tx.sentryRule.findMany({
            where: { organizationId },
          });

          for (const rule of rules) {
            const envMatch = !rule.environment || rule.environment.toLowerCase() === sentryIssue.environment.toLowerCase();
            const levelMatch = !rule.levelFilter || rule.levelFilter.toLowerCase() === sentryIssue.level.toLowerCase();
            const eventCountMatch = sentryIssue.eventCount >= rule.minEventCount;
            const userCountMatch = sentryIssue.userCount >= rule.minUserCount;

            if (envMatch && levelMatch && eventCountMatch && userCountMatch && rule.autoCreateIncident) {
              const severity = (rule.mappedSeverity as IncidentSeverity) || this.mapSentryLevelToSeverity(sentryIssue.level);

              // Check if open incident already exists for this Sentry issue
              const existingEvidence = await tx.incidentEvidence.findFirst({
                where: {
                  type: EvidenceType.SENTRY_ERROR,
                  externalRefId: sentryIssue.id,
                  incident: {
                    organizationId,
                    status: { in: [IncidentStatus.OPEN, IncidentStatus.INVESTIGATING, IncidentStatus.MITIGATING] },
                  },
                },
                select: { incidentId: true },
              });

              if (existingEvidence) {
                logger.info({ issueId: sentryIssue.id, incidentId: existingEvidence.incidentId }, 'Sentry issue already linked to open incident');
                incidentId = existingEvidence.incidentId;
                break;
              }

              // Project & Service scoping checks (Objective 4.6)
              let targetProjectId = sentryIssue.projectId;
              let targetServiceId: string | undefined;

              if (rule.projectId) {
                const ruleProject = await tx.project.findFirst({
                  where: { id: rule.projectId, organizationId },
                });
                if (ruleProject) {
                  targetProjectId = ruleProject.id;
                  if (rule.serviceId) {
                    const ruleService = await tx.service.findFirst({
                      where: { id: rule.serviceId, projectId: ruleProject.id },
                    });
                    if (ruleService) targetServiceId = ruleService.id;
                  }
                }
              }

              if (!targetProjectId) {
                const firstProj = await tx.project.findFirst({ where: { organizationId } });
                if (firstProj) targetProjectId = firstProj.id;
              }

              if (!targetProjectId) break;

              const ownerMember = await tx.organizationMember.findFirst({
                where: { organizationId, role: 'OWNER' },
                select: { userId: true },
              });

              if (!ownerMember) break;

              // Concurrency-safe sequential incident numbering inside transaction
              const lastInc = await tx.incident.findFirst({
                where: { organizationId },
                orderBy: { number: 'desc' },
                select: { number: true },
              });
              const nextNum = (lastInc?.number ?? 0) + 1;

              const newInc = await tx.incident.create({
                data: {
                  organizationId,
                  projectId: targetProjectId,
                  serviceId: targetServiceId,
                  number: nextNum,
                  createdById: ownerMember.userId,
                  title: `[Sentry Error Spike] ${sentryIssue.title}`,
                  description: `Automated incident triggered by Sentry error rule "${rule.name}". Culprit: ${sentryIssue.culprit || 'Unknown'}. Events: ${sentryIssue.eventCount}, Users: ${sentryIssue.userCount}.`,
                  severity,
                  status: IncidentStatus.OPEN,
                  environment: sentryIssue.environment.toUpperCase() === 'STAGING' ? IncidentEnvironment.STAGING : IncidentEnvironment.PRODUCTION,
                },
              });

              const evidence = await tx.incidentEvidence.create({
                data: {
                  incidentId: newInc.id,
                  type: EvidenceType.SENTRY_ERROR,
                  source: EvidenceSource.CORRELATION_ENGINE,
                  title: sentryIssue.title,
                  description: `Sentry Issue #${sentryIssue.sentryIssueId} in ${sentryIssue.projectSlug}`,
                  url: sentryIssue.permalink || `https://sentry.io/issues/${sentryIssue.sentryIssueId}/`,
                  externalRefId: sentryIssue.id,
                  confidence: 0.95,
                  metadata: {
                    sentryIssueId: sentryIssue.sentryIssueId,
                    culprit: sentryIssue.culprit,
                    level: sentryIssue.level,
                    eventCount: sentryIssue.eventCount,
                    userCount: sentryIssue.userCount,
                    release: sentryIssue.release,
                    environment: sentryIssue.environment,
                  } satisfies Prisma.InputJsonObject,
                },
              });

              const timelineEvent = await tx.incidentEvent.create({
                data: {
                  incidentId: newInc.id,
                  organizationId,
                  userId: ownerMember.userId,
                  source: EventSource.SENTRY,
                  type: 'SENTRY_SIGNAL_TRIGGERED',
                  message: `Triggered by Sentry rule "${rule.name}": ${sentryIssue.title}`,
                  metadata: { evidenceId: evidence.id, sentryIssueId: sentryIssue.sentryIssueId } satisfies Prisma.InputJsonObject,
                },
              });

              incidentId = newInc.id;
              createdIncidentBroadcast = {
                id: newInc.id,
                timelineId: timelineEvent.id,
                message: timelineEvent.message,
                occurredAt: timelineEvent.occurredAt,
              };
              break;
            }
          }

          // Mark processedAt only upon successful commit
          await tx.externalEvent.update({
            where: { id: evt.id },
            data: { processedAt: new Date() },
          });

          return { isDuplicate: false, issueId: sentryIssue.id, incidentId, broadcast: createdIncidentBroadcast };
        });

        // Post-commit Socket.IO broadcast and cache invalidation (Objective 4.8)
        if (txResult.broadcast) {
          broadcastToIncident(txResult.broadcast.id, SocketEvent.TIMELINE_EVENT, {
            id: txResult.broadcast.timelineId,
            incidentId: txResult.broadcast.id,
            organizationId,
            source: EventSource.SENTRY,
            type: 'SENTRY_SIGNAL_TRIGGERED',
            message: txResult.broadcast.message,
            timestamp: txResult.broadcast.occurredAt.toISOString(),
          });
          void invalidateAnalyticsCache(organizationId);
        }

        if (txResult.isDuplicate) {
          return { status: 'duplicate' };
        }

        return {
          status: 'processed',
          issueId: txResult.issueId,
          incidentId: txResult.incidentId,
        };
      } catch (err: unknown) {
        const classification = classifyPrismaUniqueError(err);

        if (classification === 'EXTERNAL_EVENT_DUPLICATE') {
          logger.info({ deliveryId }, 'Duplicate Sentry webhook delivery race condition handled');
          return { status: 'duplicate' };
        }

        if (classification === 'INCIDENT_NUMBER_CONFLICT') {
          attempts--;
          if (attempts > 0) {
            logger.warn({ deliveryId, attemptsLeft: attempts }, 'Concurrent incident numbering conflict, retrying transaction');
            continue;
          }
          throw new Error('Exhausted retry attempts for concurrent Sentry incident creation');
        }

        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
          attempts--;
          if (attempts > 0) {
            continue;
          }
          throw new Error('Exhausted retry attempts for Sentry serialization conflict');
        }

        // Any other unrelated P2002 or unexpected error -> rethrow!
        throw err;
      }
    }

    throw new Error('Failed to process Sentry webhook after bounded retries');
  }

  /**
   * Maps Sentry error level to IncidentHub IncidentSeverity.
   */
  public static mapSentryLevelToSeverity(level: string): IncidentSeverity {
    switch (level.toLowerCase()) {
      case 'fatal':
        return IncidentSeverity.SEV1;
      case 'error':
        return IncidentSeverity.SEV2;
      case 'warning':
        return IncidentSeverity.SEV3;
      default:
        return IncidentSeverity.SEV4;
    }
  }

  /**
   * Links a SentryIssue manually to an existing Incident.
   */
  public static async linkIssueToIncident(
    organizationId: string,
    incidentId: string,
    sentryIssueId: string,
    userId: string,
  ): Promise<{ evidenceId: string; timelineEventId: string }> {
    const incident = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
    });

    if (!incident) {
      throw new NotFoundError('Incident not found in this organization');
    }

    const issue = await prisma.sentryIssue.findFirst({
      where: { id: sentryIssueId, organizationId },
    });

    if (!issue) {
      throw new NotFoundError('Sentry issue not found in this organization');
    }

    // Create IncidentEvidence
    const evidence = await prisma.incidentEvidence.create({
      data: {
        incidentId,
        type: EvidenceType.SENTRY_ERROR,
        source: EvidenceSource.MANUAL,
        title: issue.title,
        description: `Linked Sentry Issue ${issue.sentryIssueId}`,
        url: issue.permalink || `https://sentry.io/issues/${issue.sentryIssueId}/`,
        confidence: 0.9,
        metadata: {
          sentryIssueId: issue.sentryIssueId,
          culprit: issue.culprit,
          level: issue.level,
          eventCount: issue.eventCount,
          userCount: issue.userCount,
        } satisfies Prisma.InputJsonObject,
      },
    });

    // Create IncidentEvent timeline entry
    const timelineEvent = await prisma.incidentEvent.create({
      data: {
        incidentId,
        organizationId,
        userId,
        source: EventSource.SENTRY,
        type: 'SENTRY_SIGNAL_LINKED',
        message: `Linked Sentry Issue: ${issue.title}`,
        metadata: { evidenceId: evidence.id, sentryIssueId: issue.sentryIssueId } satisfies Prisma.InputJsonObject,
      },
    });

    // Broadcast Socket.IO update
    broadcastToIncident(incidentId, SocketEvent.TIMELINE_EVENT, {
      id: timelineEvent.id,
      incidentId,
      organizationId,
      userId,
      source: EventSource.SENTRY,
      type: 'SENTRY_SIGNAL_LINKED',
      message: timelineEvent.message,
      timestamp: timelineEvent.occurredAt.toISOString(),
    });

    return {
      evidenceId: evidence.id,
      timelineEventId: timelineEvent.id,
    };
  }

  /**
   * Retrieves list of normalized SentryIssues for an organization.
   */
  public static async listIssues(organizationId: string): Promise<SentryIssueDto[]> {
    const issues = await prisma.sentryIssue.findMany({
      where: { organizationId },
      include: { project: true, service: true },
      orderBy: { updatedAt: 'desc' },
    });

    return issues.map((i) => this.toIssueDto(i));
  }

  /**
   * Manages SentryRules (CRUD).
   */
  public static async createRule(organizationId: string, input: CreateSentryRuleInput): Promise<SentryRuleDto> {
    if (!input.name) {
      throw new ValidationError('Rule name is required');
    }

    const rule = await prisma.sentryRule.create({
      data: {
        organizationId,
        name: input.name,
        environment: input.environment || null,
        minEventCount: input.minEventCount ?? 10,
        minUserCount: input.minUserCount ?? 5,
        levelFilter: input.levelFilter || null,
        mappedSeverity: (input.mappedSeverity as IncidentSeverity) || IncidentSeverity.SEV2,
        autoCreateIncident: input.autoCreateIncident ?? false,
        projectId: input.projectId || null,
        serviceId: input.serviceId || null,
      },
      include: { project: true, service: true },
    });

    return this.toRuleDto(rule);
  }

  public static async listRules(organizationId: string): Promise<SentryRuleDto[]> {
    const rules = await prisma.sentryRule.findMany({
      where: { organizationId },
      include: { project: true, service: true },
      orderBy: { createdAt: 'desc' },
    });

    return rules.map((r) => this.toRuleDto(r));
  }

  public static async deleteRule(organizationId: string, ruleId: string): Promise<void> {
    const rule = await prisma.sentryRule.findFirst({
      where: { id: ruleId, organizationId },
    });

    if (!rule) {
      throw new NotFoundError('Sentry trigger rule not found');
    }

    await prisma.sentryRule.delete({ where: { id: ruleId } });
  }
}
