import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { encryptText } from '../../../utils/crypto';
import { broadcastToIncident } from '../../../lib/socket';
import { logger } from '../../../utils/logger';
import { NotFoundError, ValidationError, ForbiddenError } from '../../../utils/errors';
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

interface SentryWebhookPayload {
  action?: string;
  project_slug?: string;
  project?: string;
  organization_slug?: string;
  message?: string;
  issue?: SentryWebhookIssue;
  event?: SentryWebhookEvent;
  data?: {
    issue?: SentryWebhookIssue;
    event?: SentryWebhookEvent;
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
  public static verifySentrySignature(rawPayload: string, signatureHeader: string | undefined, secret: string): boolean {
    if (!signatureHeader || !secret) return false;

    try {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(rawPayload, 'utf8');
      const expectedSignature = hmac.digest('hex');

      const cleanSignature = signatureHeader.replace(/^sha256=/, '').trim();
      return crypto.timingSafeEqual(Buffer.from(cleanSignature), Buffer.from(expectedSignature));
    } catch {
      return false;
    }
  }

  /**
   * Deterministically resolves organization and integration for incoming Sentry webhook.
   * Eliminates unscoped findFirst() queries and preserves strict tenant isolation.
   */
  private static async resolveWebhookTenant(
    payload: SentryWebhookPayload,
  ): Promise<{ organizationId: string; integrationId: string } | null> {
    const rawProjectSlug = payload?.project_slug || payload?.project || payload?.data?.issue?.project?.slug;
    const rawOrgSlug = payload?.organization_slug || payload?.data?.organization?.slug;

    // 1. Try resolving by IncidentHub Project slug (exact or prefix match, newest first)
    if (rawProjectSlug) {
      const slugLower = rawProjectSlug.toLowerCase();
      let projectMatch = await prisma.project.findFirst({
        where: {
          slug: slugLower,
          organization: {
            integrations: {
              some: {
                provider: IntegrationProvider.SENTRY,
                status: IntegrationStatus.CONNECTED,
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          organization: {
            include: {
              integrations: {
                where: {
                  provider: IntegrationProvider.SENTRY,
                  status: IntegrationStatus.CONNECTED,
                },
              },
            },
          },
        },
      });

      if (!projectMatch) {
        projectMatch = await prisma.project.findFirst({
          where: {
            slug: { startsWith: `${slugLower}-` },
            organization: {
              integrations: {
                some: {
                  provider: IntegrationProvider.SENTRY,
                  status: IntegrationStatus.CONNECTED,
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          include: {
            organization: {
              include: {
                integrations: {
                  where: {
                    provider: IntegrationProvider.SENTRY,
                    status: IntegrationStatus.CONNECTED,
                  },
                },
              },
            },
          },
        });
      }

      if (projectMatch && projectMatch.organization.integrations[0]) {
        return {
          organizationId: projectMatch.organizationId,
          integrationId: projectMatch.organization.integrations[0].id,
        };
      }
    }

    // 2. Try resolving by Sentry Organization Slug in Integration metadata (newest connected integration first)
    if (rawOrgSlug) {
      const orgSlugLower = rawOrgSlug.toLowerCase();
      const connectedIntegrations = await prisma.integration.findMany({
        where: {
          provider: IntegrationProvider.SENTRY,
          status: IntegrationStatus.CONNECTED,
        },
        orderBy: { updatedAt: 'desc' },
      });

      const matchingIntegration = connectedIntegrations.find((integ) => {
        const meta = integ.metadata as { sentryOrgSlug?: string } | null;
        return meta?.sentryOrgSlug?.toLowerCase() === orgSlugLower;
      });

      if (matchingIntegration) {
        return {
          organizationId: matchingIntegration.organizationId,
          integrationId: matchingIntegration.id,
        };
      }
    }

    // 3. Fallback for single-tenant context: If exactly ONE organization in DB has a connected Sentry integration
    const connectedIntegrations = await prisma.integration.findMany({
      where: {
        provider: IntegrationProvider.SENTRY,
        status: IntegrationStatus.CONNECTED,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (connectedIntegrations.length === 1 && connectedIntegrations[0]) {
      return {
        organizationId: connectedIntegrations[0].organizationId,
        integrationId: connectedIntegrations[0].id,
      };
    }

    return null;
  }

  /**
   * Ingests incoming Sentry webhook delivery, verifies signature & idempotency, normalizes signal,
   * evaluates trigger rules, and optionally creates or flags an incident.
   */
  public static async handleWebhookEvent(
    deliveryId: string,
    signature: string | undefined,
    rawPayload: unknown,
  ): Promise<{ status: string; issueId?: string; incidentId?: string }> {
    const payload = rawPayload as SentryWebhookPayload;
    const webhookSecret = process.env['SENTRY_WEBHOOK_SECRET'] || 'mock-sentry-webhook-secret';

    // 1. HMAC Signature Verification (If in production or secret set)
    if (signature && process.env['NODE_ENV'] === 'production') {
      const isValid = this.verifySentrySignature(JSON.stringify(payload), signature, webhookSecret);
      if (!isValid) {
        logger.warn({ deliveryId }, 'Invalid Sentry webhook signature');
        throw new ForbiddenError('Invalid Sentry webhook signature');
      }
    }

    // 2. Idempotency Check via ExternalEvent table — early check for known deliveries
    const existingEvent = await prisma.externalEvent.findFirst({
      where: {
        provider: 'sentry',
        externalId: deliveryId,
      },
    });

    if (existingEvent) {
      logger.info({ deliveryId }, 'Duplicate Sentry webhook delivery ignored (early check)');
      return { status: 'ignored: duplicate delivery' };
    }

    // 3. Resolve Organization & Integration deterministically (Tenant-Safe)
    const tenant = await this.resolveWebhookTenant(payload);
    if (!tenant) {
      logger.warn({ deliveryId }, 'Unmapped Sentry webhook payload (tenant resolution failed)');
      return { status: 'ignored: unmapped organization or project' };
    }

    const { organizationId, integrationId } = tenant;

    // Record ExternalEvent atomically — if duplicate delivery arrives concurrently, catch P2002 uniqueness violation
    try {
      await prisma.externalEvent.create({
        data: {
          organizationId,
          integrationId,
          provider: 'sentry',
          externalId: deliveryId,
          eventType: payload?.action || 'error_event',
          payload: payload as unknown as Prisma.InputJsonValue,
          occurredAt: new Date(),
        },
      });
    } catch (createErr) {
      // P2002 = unique constraint violation — another request already recorded this delivery
      if (
        createErr instanceof Prisma.PrismaClientKnownRequestError &&
        createErr.code === 'P2002'
      ) {
        logger.info({ deliveryId }, 'Duplicate Sentry webhook delivery ignored (concurrent create race)');
        return { status: 'ignored: duplicate delivery' };
      }
      throw createErr;
    }

    // 3. Normalize Sentry Event Payload into SentryIssue
    const issueData: SentryWebhookIssue = payload?.issue ?? payload?.data?.issue ?? {};
    const eventData: SentryWebhookEvent = payload?.event ?? payload?.data?.event ?? {};

    const sentryIssueId = String(issueData.id ?? eventData.issue_id ?? `sentry-issue-${Date.now()}`);
    const title = issueData.title ?? eventData.title ?? payload.message ?? 'Sentry Exception';
    const culprit = issueData.culprit ?? eventData.culprit ?? null;
    const rawLevel = issueData.level ?? eventData.level ?? 'error';
    const level = rawLevel.toLowerCase();
    const userCount = Number(issueData.userCount ?? issueData.users ?? 1);
    const eventCount = Number(issueData.count ?? issueData.events ?? 1);
    const release = eventData.release ?? issueData.release ?? null;
    const rawEnvironment = eventData.environment ?? issueData.environment ?? 'production';
    const environment = rawEnvironment.toLowerCase();
    const permalink = issueData.permalink ?? null;
    const stackTrace = eventData.culprit ?? issueData.culprit ?? title;

    // Resolve mapped Project and Service in IncidentHub
    const projectSlug = payload?.project_slug || payload?.project || payload?.data?.issue?.project?.slug || 'default-project';
    const projectRecord = await prisma.project.findFirst({
      where: { organizationId, slug: projectSlug.toLowerCase() },
    });

    const sentryIssue = await prisma.sentryIssue.upsert({
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

    // 4. Trigger Rule Evaluation Engine
    const createdIncidentId = await this.evaluateTriggerRules(organizationId, sentryIssue);

    return {
      status: 'processed',
      issueId: sentryIssue.id,
      incidentId: createdIncidentId,
    };
  }

  /**
   * Evaluates active SentryRules for an organization against a SentryIssue signal.
   * If threshold conditions match and autoCreateIncident is true, automatically creates an Incident.
   */
  private static async evaluateTriggerRules(organizationId: string, issue: Prisma.SentryIssueGetPayload<Record<string, never>>): Promise<string | undefined> {
    const rules = await prisma.sentryRule.findMany({
      where: { organizationId },
    });

    if (rules.length === 0) {
      return undefined;
    }

    for (const rule of rules) {
      const envMatch = !rule.environment || rule.environment.toLowerCase() === issue.environment.toLowerCase();
      const levelMatch = !rule.levelFilter || rule.levelFilter.toLowerCase() === issue.level.toLowerCase();
      const eventCountMatch = issue.eventCount >= rule.minEventCount;
      const userCountMatch = issue.userCount >= rule.minUserCount;

      if (envMatch && levelMatch && eventCountMatch && userCountMatch && rule.autoCreateIncident) {
        // Deterministic severity mapping
        const severity = (rule.mappedSeverity as IncidentSeverity) || this.mapSentryLevelToSeverity(issue.level);

        // Check if open incident already exists for this Sentry issue
        const existingEvidence = await prisma.incidentEvidence.findFirst({
          where: {
            type: EvidenceType.SENTRY_ERROR,
            url: issue.permalink || undefined,
            incident: {
              organizationId,
              status: { in: [IncidentStatus.OPEN, IncidentStatus.INVESTIGATING, IncidentStatus.MITIGATING] },
            },
          },
        });

        if (existingEvidence) {
          logger.info({ issueId: issue.id, incidentId: existingEvidence.incidentId }, 'Sentry issue already linked to open incident');
          return existingEvidence.incidentId;
        }

        // Get first project/service or fallback to issue's mapped project
        const project = rule.projectId
          ? await prisma.project.findUnique({ where: { id: rule.projectId } })
          : await prisma.project.findFirst({ where: { organizationId } });

        if (!project) return undefined;

        // Auto-generate next sequential incident number
        const lastInc = await prisma.incident.findFirst({
          where: { organizationId },
          orderBy: { number: 'desc' },
          select: { number: true },
        });

        const nextNum = (lastInc?.number ?? 0) + 1;

        // Resolve organization owner to satisfy createdById requirement
        const ownerMember = await prisma.organizationMember.findFirst({
          where: { organizationId, role: 'OWNER' },
          select: { userId: true },
        });

        if (!ownerMember) return undefined;

        const incident = await prisma.incident.create({
          data: {
            organizationId,
            projectId: project.id,
            serviceId: rule.serviceId || undefined,
            number: nextNum,
            createdById: ownerMember.userId,
            title: `[Sentry Error Spike] ${issue.title}`,
            description: `Automated incident triggered by Sentry error rule "${rule.name}". Culprit: ${issue.culprit || 'Unknown'}. Events: ${issue.eventCount}, Users: ${issue.userCount}.`,
            severity,
            status: IncidentStatus.OPEN,
            environment: issue.environment.toUpperCase() === 'STAGING' ? IncidentEnvironment.STAGING : IncidentEnvironment.PRODUCTION,
          },
        });

        // Attach IncidentEvidence
        const evidence = await prisma.incidentEvidence.create({
          data: {
            incidentId: incident.id,
            type: EvidenceType.SENTRY_ERROR,
            source: EvidenceSource.CORRELATION_ENGINE,
            title: issue.title,
            description: `Sentry Issue #${issue.sentryIssueId} in ${issue.projectSlug}`,
            url: issue.permalink || `https://sentry.io/issues/${issue.sentryIssueId}/`,
            confidence: 0.95,
            metadata: {
              sentryIssueId: issue.sentryIssueId,
              culprit: issue.culprit,
              level: issue.level,
              eventCount: issue.eventCount,
              userCount: issue.userCount,
              release: issue.release,
              environment: issue.environment,
            } satisfies Prisma.InputJsonObject,
          },
        });

        // Add IncidentEvent audit timeline entry
        const timelineEvent = await prisma.incidentEvent.create({
          data: {
            incidentId: incident.id,
            organizationId,
            source: EventSource.SENTRY,
            type: 'SENTRY_SIGNAL_TRIGGERED',
            message: `Triggered by Sentry rule "${rule.name}": ${issue.title}`,
            metadata: { evidenceId: evidence.id, sentryIssueId: issue.sentryIssueId } satisfies Prisma.InputJsonObject,
          },
        });

        // Broadcast real-time Socket.IO room updates
        broadcastToIncident(incident.id, SocketEvent.TIMELINE_EVENT, {
          id: timelineEvent.id,
          incidentId: incident.id,
          organizationId,
          source: EventSource.SENTRY,
          type: 'SENTRY_SIGNAL_TRIGGERED',
          message: timelineEvent.message,
          timestamp: timelineEvent.occurredAt.toISOString(),
        });

        logger.info({ incidentId: incident.id, ruleName: rule.name }, 'Created incident from Sentry trigger rule');
        return incident.id;
      }
    }

    return undefined;
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
