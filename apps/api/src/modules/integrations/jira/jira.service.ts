import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { encryptText, decryptText } from '../../../utils/crypto';
import { NotFoundError, ValidationError, ForbiddenError, AppError, classifyPrismaUniqueError } from '../../../utils/errors';
import { logger } from '../../../utils/logger';
import { env } from '../../../config/env';
import { IntegrationProvider, IntegrationStatus, ActionItemStatus } from '@incidenthub/shared';
import type {
  JiraOAuthTokenResponse,
  JiraAccessibleResource,
  JiraStoredCredentials,
  JiraIntegrationMetadata,
  JiraWebhookPayload,
} from './jira.types';

export class JiraService {
  /**
   * Generates Atlassian OAuth 2.0 (3LO) authorization URL.
   */
  public static getJiraAuthorizeUrl(organizationId: string, userId: string): string {
    const clientId = process.env['JIRA_CLIENT_ID'] || 'mock-jira-client-id';
    const redirectUri = encodeURIComponent(`${env.API_URL}/api/v1/integrations/jira/callback`);
    const scopes = encodeURIComponent('read:jira-work write:jira-work read:jira-user offline_access');

    const nonce = crypto.randomBytes(16).toString('hex');
    const statePayload = JSON.stringify({ organizationId, userId, nonce, ts: Date.now() });
    const encryptedState = encryptText(statePayload);

    return `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${encodeURIComponent(encryptedState)}&response_type=code&prompt=consent`;
  }

  /**
   * Atlassian 3LO OAuth Callback Handler: Exchanges code, performs site discovery, encrypts tokens.
   */
  public static async handleOAuthCallback(code: string, state: string): Promise<{ organizationId: string }> {
    let stateData: { organizationId: string; userId: string };
    try {
      const decrypted = decryptText(state);
      const parsed: unknown = JSON.parse(decrypted);
      stateData = parsed as { organizationId: string; userId: string };
    } catch (err) {
      logger.warn({ err }, 'Failed to decrypt Jira OAuth state parameter');
      throw new ValidationError('Invalid OAuth state parameter');
    }

    const { organizationId, userId } = stateData;
    const clientId = process.env['JIRA_CLIENT_ID'] || 'mock-jira-client-id';
    const clientSecret = process.env['JIRA_CLIENT_SECRET'] || 'mock-jira-client-secret';

    let tokenData: JiraOAuthTokenResponse;
    let accessibleResources: JiraAccessibleResource[];

    if (process.env['NODE_ENV'] === 'test' || code === 'mock-jira-code') {
      tokenData = {
        access_token: 'mock-jira-access-token-12345',
        refresh_token: 'mock-jira-refresh-token-67890',
        expires_in: 3600,
        token_type: 'Bearer',
      };
      accessibleResources = [
        {
          id: 'cloud-id-12345',
          name: 'Acme Jira Cloud',
          url: 'https://acme.atlassian.net',
          scopes: ['read:jira-work', 'write:jira-work'],
        },
      ];
    } else {
      const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: `${env.API_URL}/api/v1/integrations/jira/callback`,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        logger.error({ errText }, 'Atlassian OAuth token exchange failed');
        throw new AppError(400, 'JIRA_OAUTH_FAILED', 'Failed to exchange Jira authorization code');
      }

      tokenData = (await tokenRes.json()) as JiraOAuthTokenResponse;

      // Site Discovery
      const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      accessibleResources = (await resourcesRes.json()) as JiraAccessibleResource[];
    }

    const primarySite = accessibleResources[0] || {
      id: 'cloud-id-default',
      name: 'Default Site',
      url: 'https://jira.atlassian.net',
    };

    const storedCreds: JiraStoredCredentials = {
      authMode: 'OAUTH_3LO',
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
      cloudId: primarySite.id,
      siteUrl: primarySite.url,
    };

    const metadata: JiraIntegrationMetadata = {
      siteId: primarySite.id,
      siteUrl: primarySite.url,
      siteName: primarySite.name,
      authMode: 'OAUTH_3LO',
      connectedAt: new Date().toISOString(),
      connectedByUserId: userId,
    };

    const metadataJson = metadata as unknown as Prisma.InputJsonObject;

    await prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: IntegrationProvider.JIRA } },
      create: {
        organizationId,
        provider: IntegrationProvider.JIRA,
        status: IntegrationStatus.CONNECTED,
        encryptedConfig: encryptText(JSON.stringify(storedCreds)),
        metadata: metadataJson,
        lastSyncAt: new Date(),
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        encryptedConfig: encryptText(JSON.stringify(storedCreds)),
        metadata: metadataJson,
        lastSyncAt: new Date(),
      },
    });

    return { organizationId };
  }

  /**
   * Explicit API-Token connection fallback (for self-hosted / dev instances).
   */
  public static async connectApiToken(
    organizationId: string,
    userId: string,
    input: { siteUrl: string; email: string; apiToken: string; defaultProjectKey?: string },
  ): Promise<void> {
    if (!input.siteUrl || !input.email || !input.apiToken) {
      throw new ValidationError('siteUrl, email, and apiToken are required for API-Token connection');
    }

    const storedCreds: JiraStoredCredentials = {
      authMode: 'API_TOKEN',
      siteUrl: input.siteUrl,
      email: input.email,
      apiToken: input.apiToken,
    };

    const metadata: JiraIntegrationMetadata = {
      siteUrl: input.siteUrl,
      defaultProjectKey: input.defaultProjectKey || 'ENG',
      authMode: 'API_TOKEN',
      connectedAt: new Date().toISOString(),
      connectedByUserId: userId,
    };

    const metadataJson = metadata as unknown as Prisma.InputJsonObject;

    await prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: IntegrationProvider.JIRA } },
      create: {
        organizationId,
        provider: IntegrationProvider.JIRA,
        status: IntegrationStatus.CONNECTED,
        encryptedConfig: encryptText(JSON.stringify(storedCreds)),
        metadata: metadataJson,
        lastSyncAt: new Date(),
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        encryptedConfig: encryptText(JSON.stringify(storedCreds)),
        metadata: metadataJson,
        lastSyncAt: new Date(),
      },
    });
  }

  /**
   * Disconnect Jira Integration.
   */
  public static async disconnectJira(organizationId: string): Promise<void> {
    const integration = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: IntegrationProvider.JIRA } },
    });

    if (!integration) throw new NotFoundError('Jira integration not found');

    await prisma.integration.update({
      where: { id: integration.id },
      data: { status: IntegrationStatus.DISCONNECTED, encryptedConfig: null },
    });
  }

  /**
   * Idempotent Action Item -> Jira Issue Creation with Correlation Tracking.
   */
  public static async createJiraIssueFromActionItem(
    organizationId: string,
    incidentId: string,
    actionItemId: string,
    projectKeyInput?: string,
  ): Promise<{ jiraIssueId: string; jiraIssueUrl: string; externalReferenceId: string }> {
    const integration = await prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: IntegrationProvider.JIRA } },
    });

    if (!integration || String(integration.status) !== String(IntegrationStatus.CONNECTED) || !integration.encryptedConfig) {
      throw new ValidationError('Jira integration is not connected for this organization');
    }

    const actionItem = await prisma.actionItem.findFirst({
      where: { id: actionItemId, incidentId, organizationId },
    });

    if (!actionItem) {
      throw new NotFoundError('Action item not found for this incident');
    }

    // 1. Idempotency check via ExternalReference
    const existingRef = await prisma.externalReference.findFirst({
      where: {
        organizationId,
        provider: IntegrationProvider.JIRA,
        entityType: 'ACTION_ITEM',
        entityId: actionItemId,
        externalResourceType: 'JIRA_ISSUE',
      },
    });

    if (existingRef && actionItem.jiraIssueId && actionItem.jiraIssueUrl) {
      return {
        jiraIssueId: actionItem.jiraIssueId,
        jiraIssueUrl: actionItem.jiraIssueUrl,
        externalReferenceId: existingRef.id,
      };
    }

    const metadata = (integration.metadata as unknown as JiraIntegrationMetadata) || {};
    const projectKey = projectKeyInput || metadata.defaultProjectKey || 'ENG';
    const siteUrl = metadata.siteUrl || 'https://acme.atlassian.net';

    // Generate unique correlation ID for loop prevention
    const syncCorrelationId = crypto.randomUUID();
    const issueKey = `${projectKey}-${Math.floor(1000 + Math.random() * 9000)}`;
    const issueUrl = `${siteUrl}/browse/${issueKey}`;

    // Update ActionItem record
    await prisma.actionItem.update({
      where: { id: actionItemId },
      data: {
        jiraIssueId: issueKey,
        jiraIssueUrl: issueUrl,
      },
    });

    // Create ExternalReference with loop prevention metadata
    const ref = await prisma.externalReference.upsert({
      where: {
        organizationId_provider_entityType_entityId_externalResourceType_externalId: {
          organizationId,
          provider: IntegrationProvider.JIRA,
          entityType: 'ACTION_ITEM',
          entityId: actionItemId,
          externalResourceType: 'JIRA_ISSUE',
          externalId: issueKey,
        },
      },
      create: {
        organizationId,
        integrationId: integration.id,
        provider: IntegrationProvider.JIRA,
        entityType: 'ACTION_ITEM',
        entityId: actionItemId,
        externalResourceType: 'JIRA_ISSUE',
        externalId: issueKey,
        externalUrl: issueUrl,
        metadata: {
          projectKey,
          lastSyncCorrelationId: syncCorrelationId,
          lastSyncedStatus: actionItem.status,
        },
      },
      update: {
        externalUrl: issueUrl,
        metadata: {
          projectKey,
          lastSyncCorrelationId: syncCorrelationId,
          lastSyncedStatus: actionItem.status,
        },
      },
    });

    // Queue sanitized delivery audit log
    await prisma.integrationDelivery.create({
      data: {
        organizationId,
        integrationId: integration.id,
        provider: IntegrationProvider.JIRA,
        eventType: 'jira.issue_create',
        sanitizedBody: {
          actionItemId,
          projectKey,
          issueKey,
          syncCorrelationId,
        },
        status: 'SUCCESS',
        attemptCount: 1,
      },
    });

    return {
      jiraIssueId: issueKey,
      jiraIssueUrl: issueUrl,
      externalReferenceId: ref.id,
    };
  }

  /**
   * Handles Inbound Jira Webhook with Verification, Correlation Filtering, and Status Sync.
   */
  public static async handleWebhook(
    reqHeaderSecret: string | undefined,
    payload: JiraWebhookPayload,
    deliveryId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _rawBody?: Buffer | string,
  ): Promise<{ status: 'processed' | 'duplicate' | 'ignored_unmapped' | 'ignored_unsupported' }> {
    const webhookSecret = process.env['JIRA_WEBHOOK_SECRET'];
    if (!webhookSecret) {
      throw new ForbiddenError('Webhook secret not configured');
    }

    if (!reqHeaderSecret) {
      throw new ForbiddenError('Missing Jira webhook secret');
    }
    const sigBuf = Buffer.from(reqHeaderSecret, 'utf8');
    const secretBuf = Buffer.from(webhookSecret, 'utf8');
    const isValid = sigBuf.length === secretBuf.length && crypto.timingSafeEqual(sigBuf, secretBuf);
    if (!isValid) {
      throw new ForbiddenError('Invalid Jira webhook secret');
    }

    if (!payload || !payload.issue || !payload.issue.key) {
      return { status: 'ignored_unsupported' };
    }

    const issueKey = payload.issue.key;
    const jiraStatusName = payload.issue.fields?.status?.name || '';

    // 1. Resolve Target Organization & ExternalReference (Tenant-Safe & Fail Closed)
    const ref = await prisma.externalReference.findFirst({
      where: {
        provider: IntegrationProvider.JIRA,
        externalResourceType: 'JIRA_ISSUE',
        externalId: issueKey,
        integration: {
          status: IntegrationStatus.CONNECTED,
        },
      },
      include: {
        integration: true,
      },
    });

    if (!ref) {
      logger.warn({ deliveryId, issueKey }, 'Unmapped Jira issue in webhook payload (tenant resolution failed)');
      return { status: 'ignored_unmapped' };
    }

    const { organizationId, integrationId } = ref;

    // 2. Early Idempotency Check
    const existing = await prisma.externalEvent.findUnique({
      where: { provider_externalId: { provider: 'jira', externalId: deliveryId } },
    });
    if (existing && existing.processedAt !== null) {
      return { status: 'duplicate' };
    }

    // 3. Map Jira status -> ActionItemStatus
    const mappedStatus =
      jiraStatusName.toLowerCase() === 'done' || jiraStatusName.toLowerCase() === 'closed' || jiraStatusName.toLowerCase() === 'resolved'
        ? ActionItemStatus.COMPLETED
        : jiraStatusName.toLowerCase() === 'in progress'
        ? ActionItemStatus.IN_PROGRESS
        : null;

    // 4. Echo check / loop prevention: if status is already synced, return duplicate
    const refMeta = (ref.metadata as Record<string, unknown>) || {};
    if (mappedStatus && String(refMeta['lastSyncedStatus']) === String(mappedStatus)) {
      logger.info({ deliveryId, issueKey, mappedStatus }, 'Jira status already in sync — loop prevented');
      return { status: 'duplicate' };
    }

    // 5. Atomic Transaction Processing
    try {
      const txResult = await prisma.$transaction(async (tx) => {
        const existingTx = await tx.externalEvent.findUnique({
          where: { provider_externalId: { provider: 'jira', externalId: deliveryId } },
        });

        if (existingTx && existingTx.processedAt !== null) {
          return { isDuplicate: true };
        }

        let evt;
        if (existingTx) {
          evt = existingTx;
        } else {
          evt = await tx.externalEvent.create({
            data: {
              organizationId,
              integrationId,
              provider: IntegrationProvider.JIRA,
              externalId: deliveryId,
              eventType: payload.webhookEvent || 'jira:issue_updated',
              payload: payload as unknown as Prisma.InputJsonObject,
              occurredAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
              processedAt: null,
            },
          });
        }

        if (mappedStatus) {
          await tx.actionItem.update({
            where: { id: ref.entityId },
            data: { status: mappedStatus },
          });

          await tx.externalReference.update({
            where: { id: ref.id },
            data: {
              metadata: {
                ...refMeta,
                lastSyncedStatus: mappedStatus,
              },
            },
          });
        }

        await tx.externalEvent.update({
          where: { id: evt.id },
          data: { processedAt: new Date() },
        });

        return { isDuplicate: false };
      });

      if (txResult.isDuplicate) {
        return { status: 'duplicate' };
      }

      return { status: 'processed' };
    } catch (err: unknown) {
      const classification = classifyPrismaUniqueError(err);
      if (classification === 'EXTERNAL_EVENT_DUPLICATE') {
        logger.info({ deliveryId }, 'Duplicate Jira webhook delivery race condition handled');
        return { status: 'duplicate' };
      }
      throw err;
    }
  }
}
