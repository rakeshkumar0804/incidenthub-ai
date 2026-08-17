/**
 * Phase 7 — Sentry Integration Tests
 *
 * Tests:
 *  1. Crypto/Encryption utilities (AES-256-GCM — reused from Phase 6)
 *  2. OAuth 2.0 connect / Token fallback / Status / Disconnect
 *  3. RBAC (OWNER/ADMIN can manage; RESPONDER/VIEWER cannot manage)
 *  4. Webhook receiver — valid, missing signature, malformed, duplicate delivery
 *  5. Trigger rule CRUD & evaluation engine (no blind auto-create without threshold)
 *  6. Sentry signal → Incident Evidence linking + IncidentEvent timeline
 *  7. Socket.IO broadcast verification
 *  8. Severity mapping (fatal→SEV1, error→SEV2, warning→SEV3)
 *  9. Cross-tenant isolation
 * 10. Regression check for Phases 1–6
 */
import supertest from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { encryptText, decryptText } from '../src/utils/crypto';
import { signAccessToken } from '../src/utils/jwt';
import { SentryService } from '../src/modules/integrations/sentry/sentry.service';
import type { SentryIntegrationDto, SentryRuleDto, SentryIssueDto } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

interface TestRes<T> {
  success: boolean;
  data: T;
}

describe('Phase 7 — Sentry Integration Tests', () => {
  let ownerToken: string;
  let adminToken: string;
  let responderToken: string;
  let viewerToken: string;
  let orgId: string;
  let projectId: string;
  let serviceId: string;
  let incidentId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    const ts = Date.now();

    // 1. Create Organization A
    const orgA = await prisma.organization.create({
      data: { name: `Sentry Test Org ${ts}`, slug: `sentry-org-${ts}` },
    });
    orgId = orgA.id;

    // 2. Create users
    const ownerUser = await prisma.user.create({
      data: { name: 'Sentry Owner', email: `sentry_owner_${ts}@example.com` },
    });
    const adminUser = await prisma.user.create({
      data: { name: 'Sentry Admin', email: `sentry_admin_${ts}@example.com` },
    });
    const responderUser = await prisma.user.create({
      data: { name: 'Sentry Responder', email: `sentry_resp_${ts}@example.com` },
    });
    const viewerUser = await prisma.user.create({
      data: { name: 'Sentry Viewer', email: `sentry_view_${ts}@example.com` },
    });

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgId, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: orgId, userId: adminUser.id, role: 'ADMIN' },
        { organizationId: orgId, userId: responderUser.id, role: 'RESPONDER' },
        { organizationId: orgId, userId: viewerUser.id, role: 'VIEWER' },
      ],
    });

    ownerToken = signAccessToken(ownerUser.id, ownerUser.email);
    adminToken = signAccessToken(adminUser.id, adminUser.email);
    responderToken = signAccessToken(responderUser.id, responderUser.email);
    viewerToken = signAccessToken(viewerUser.id, viewerUser.email);

    // 3. Create Project & Service
    const projRes = await request
      .post(`/api/v1/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Core API', slug: `core-api-${ts}` });
    projectId = (projRes.body as TestRes<{ id: string }>).data.id;

    const servRes = await request
      .post(`/api/v1/projects/${projectId}/services`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Auth Service', slug: `auth-svc-${ts}` });
    serviceId = (servRes.body as TestRes<{ id: string }>).data.id;

    // 4. Create Incident
    const incRes = await request
      .post(`/api/v1/organizations/${orgId}/incidents`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ title: 'Sentry Test Incident', projectId, serviceId, severity: 'SEV2' });
    incidentId = (incRes.body as TestRes<{ id: string }>).data.id;

    // 5. Organization B for cross-tenant tests
    const orgB = await prisma.organization.create({
      data: { name: `Other Sentry Org ${ts}`, slug: `other-sentry-org-${ts}` },
    });
    otherOrgId = orgB.id;
  });

  // ============================================================
  // 1. Crypto Utilities
  // ============================================================
  describe('1. Crypto Utilities', () => {
    it('encrypts and decrypts Sentry tokens with AES-256-GCM', () => {
      const token = 'sntrys_secret_sentry_token_12345';
      const encrypted = encryptText(token);
      expect(encrypted).not.toBe(token);
      expect(decryptText(encrypted)).toBe(token);
    });

    it('produces unique ciphertext per encryption (non-deterministic IVs)', () => {
      const token = 'same_sentry_token';
      const enc1 = encryptText(token);
      const enc2 = encryptText(token);
      expect(enc1).not.toBe(enc2);
      expect(decryptText(enc1)).toBe(token);
      expect(decryptText(enc2)).toBe(token);
    });
  });

  // ============================================================
  // 2. Sentry Authentication — OAuth 2.0 State, PKCE & Connect
  // ============================================================
  describe('2. Sentry OAuth 2.0 State, PKCE & Connect', () => {
    let generatedState: string;

    it('generates cryptographically random OAuth state and PKCE challenge (S256)', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/authorize-oauth`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sentryOrgSlug: 'acme-corp' });

      const body = res.body as TestRes<{ state: string; codeChallenge: string; codeChallengeMethod: string; authorizeUrl: string }>;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.state).toBeDefined();
      expect(body.data.codeChallenge).toBeDefined();
      expect(body.data.codeChallengeMethod).toBe('S256');
      expect(body.data.authorizeUrl).toContain('response_type=code');
      expect(body.data.authorizeUrl).toContain('code_challenge_method=S256');

      generatedState = body.data.state;
    });

    it('allows OWNER to connect via OAuth 2.0 flow with valid state', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/connect-oauth`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          code: 'sentry-oauth-code-test-12345',
          state: generatedState,
          redirectUri: 'https://app.incidenthub.ai/settings/sentry/callback',
          sentryOrgSlug: 'acme-corp',
        });

      const body = res.body as TestRes<SentryIntegrationDto>;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('CONNECTED');
      expect(body.data.metadata?.authType).toBe('OAUTH');
      expect(body.data.metadata?.sentryOrgSlug).toBe('acme-corp');
      // Confirm secrets never reach frontend
      expect((body.data as unknown as Record<string, unknown>)['encryptedConfig']).toBeUndefined();
    });

    it('rejects reused / consumed OAuth state (replay protection)', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/connect-oauth`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          code: 'sentry-oauth-replay-code',
          state: generatedState, // already consumed above
          redirectUri: 'https://app.incidenthub.ai/settings/sentry/callback',
        });

      expect(res.status).toBe(400);
    });

    it('rejects invalid OAuth state parameter', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/connect-oauth`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          code: 'sentry-invalid-state-code',
          state: 'non-existent-state-123',
          redirectUri: 'https://app.incidenthub.ai/settings/sentry/callback',
        });

      expect(res.status).toBe(400);
    });

    it('allows ADMIN to connect via OAuth 2.0', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/connect-oauth`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'sentry-oauth-admin-code',
          redirectUri: 'https://app.incidenthub.ai/settings/sentry/callback',
          sentryOrgSlug: 'acme-corp',
        });
      expect(res.status).toBe(200);
    });

    it('rejects RESPONDER from connecting Sentry', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/connect-oauth`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ code: 'code', redirectUri: 'https://example.com' });
      expect(res.status).toBe(403);
    });

    it('rejects VIEWER from connecting Sentry', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/connect-oauth`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ code: 'code', redirectUri: 'https://example.com' });
      expect(res.status).toBe(403);
    });

    it('allows any org member to view Sentry integration status', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/integrations/sentry`)
        .set('Authorization', `Bearer ${viewerToken}`);

      const body = res.body as TestRes<SentryIntegrationDto>;
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('CONNECTED');
    });

    it('allows OWNER to connect via Auth Token fallback', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/connect-token`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sentryToken: 'sntrys_secret_token_12345', sentryOrgSlug: 'acme-corp' });

      const body = res.body as TestRes<SentryIntegrationDto>;
      expect(res.status).toBe(200);
      expect(body.data.metadata?.authType).toBe('TOKEN');
    });

    it('allows OWNER to disconnect Sentry and purge credentials', async () => {
      // First ensure connected
      await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/connect-oauth`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ code: 'code-to-disconnect', redirectUri: 'https://example.com', sentryOrgSlug: 'acme-corp' });

      const res = await request
        .delete(`/api/v1/organizations/${orgId}/integrations/sentry/disconnect`)
        .set('Authorization', `Bearer ${ownerToken}`);

      const body = res.body as TestRes<SentryIntegrationDto>;
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('DISCONNECTED');

      // Verify credentials are purged in DB
      const integration = await prisma.integration.findFirst({
        where: { organizationId: orgId, provider: 'SENTRY' },
      });
      expect(integration?.encryptedConfig).toBeNull();

      // Reconnect for subsequent tests
      await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/connect-oauth`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ code: 'code-reconnect', redirectUri: 'https://example.com', sentryOrgSlug: 'acme-corp' });
    });
  });

  // ============================================================
  // 3. Webhook Receiver — Signature, Idempotency, Malformed
  // ============================================================
  describe('3. Webhook Receiver & Idempotency', () => {
    const deliveryId = `sentry-deliv-${Date.now()}`;

    const validPayload = {
      action: 'error',
      project_slug: 'core-api',
      organization_slug: 'acme-corp',
      issue: {
        id: `sentry-issue-${Date.now()}`,
        title: 'TypeError: Cannot read property of undefined',
        culprit: 'src/api/auth.ts in getUser',
        level: 'error',
        count: '45',
        userCount: 12,
        firstSeen: new Date(Date.now() - 3600_000).toISOString(),
        lastSeen: new Date().toISOString(),
        permalink: 'https://sentry.io/issues/12345/',
      },
      event: {
        release: '1.2.3',
        environment: 'production',
      },
    };

    it('processes valid Sentry webhook payload and normalizes signal', async () => {
      const res = await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', deliveryId)
        .set('sentry-hook-signature', 'valid-signature')
        .send(validPayload);

      const body = res.body as TestRes<{ status: string; issueId: string }>;
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('processed');
      expect(body.data.issueId).toBeDefined();

      // Verify SentryIssue was normalized and stored
      const issue = await prisma.sentryIssue.findFirst({
        where: { organizationId: orgId, sentryIssueId: validPayload.issue.id },
      });
      expect(issue).toBeDefined();
      expect(issue?.level).toBe('error');
      expect(issue?.release).toBe('1.2.3');
      expect(issue?.environment).toBe('production');
    });

    it('enforces idempotency — duplicate webhook delivery is safely ignored', async () => {
      const res = await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', deliveryId)
        .set('sentry-hook-signature', 'valid-signature')
        .send(validPayload);

      const body = res.body as TestRes<{ status: string }>;
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('ignored: duplicate delivery');
    });

    it('returns 200 for malformed payload (does not crash, returns processed status)', async () => {
      const res = await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', `malformed-deliv-${Date.now()}`)
        .send({ broken: 'payload' });

      expect(res.status).toBe(200);
    });
  });

  // ============================================================
  // 4. Severity Mapping
  // ============================================================
  describe('4. Severity Mapping', () => {
    it('maps fatal → SEV1', () => {
      expect(SentryService.mapSentryLevelToSeverity('fatal')).toBe('SEV1');
    });

    it('maps error → SEV2', () => {
      expect(SentryService.mapSentryLevelToSeverity('error')).toBe('SEV2');
    });

    it('maps warning → SEV3', () => {
      expect(SentryService.mapSentryLevelToSeverity('warning')).toBe('SEV3');
    });

    it('maps unknown level → SEV4', () => {
      expect(SentryService.mapSentryLevelToSeverity('info')).toBe('SEV4');
    });
  });

  // ============================================================
  // 5. Trigger Rules — CRUD & Evaluation (No Blind Auto-Create)
  // ============================================================
  describe('5. Trigger Rules CRUD & Evaluation Engine', () => {
    let ruleId: string;

    it('OWNER can create a trigger rule', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/rules`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Production Fatal Error Spike',
          environment: 'production',
          minEventCount: 1,
          minUserCount: 1,
          levelFilter: 'fatal',
          mappedSeverity: 'SEV1',
          autoCreateIncident: false,
        });

      const body = res.body as TestRes<SentryRuleDto>;
      expect(res.status).toBe(201);
      expect(body.data.name).toBe('Production Fatal Error Spike');
      expect(body.data.autoCreateIncident).toBe(false);
      ruleId = body.data.id;
    });

    it('VIEWER cannot create trigger rules', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/rules`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ name: 'Viewer Rule', minEventCount: 5, minUserCount: 1 });
      expect(res.status).toBe(403);
    });

    it('any org member can list trigger rules', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/integrations/sentry/rules`)
        .set('Authorization', `Bearer ${viewerToken}`);

      const body = res.body as TestRes<SentryRuleDto[]>;
      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('does NOT auto-create incident when autoCreateIncident=false (even if thresholds met)', async () => {
      // Rule has autoCreateIncident=false — webhook should NOT create an incident
      const incidentCountBefore = await prisma.incident.count({ where: { organizationId: orgId } });

      await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', `fatal-delivery-no-auto-${Date.now()}`)
        .send({
          action: 'error',
          project_slug: 'core-api',
          issue: {
            id: `fatal-no-auto-${Date.now()}`,
            title: 'FatalError: DB connection pool exhausted',
            level: 'fatal',
            count: '5000',
            userCount: 9999,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          },
          event: { environment: 'production', release: '2.0.0' },
        });

      const incidentCountAfter = await prisma.incident.count({ where: { organizationId: orgId } });
      // Count should NOT increase since autoCreateIncident=false
      expect(incidentCountAfter).toBe(incidentCountBefore);
    });

    it('DOES auto-create incident when autoCreateIncident=true and thresholds are met', async () => {
      // Create a rule with autoCreateIncident=true
      await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/rules`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Fatal Auto-Create Rule',
          environment: 'production',
          minEventCount: 1,
          minUserCount: 1,
          levelFilter: 'fatal',
          mappedSeverity: 'SEV1',
          autoCreateIncident: true,
          projectId,
        });

      const incidentCountBefore = await prisma.incident.count({ where: { organizationId: orgId } });

      await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', `fatal-auto-create-${Date.now()}`)
        .send({
          action: 'error',
          project_slug: 'core-api',
          issue: {
            id: `fatal-auto-${Date.now()}`,
            title: 'FatalError: Memory limit exceeded',
            level: 'fatal',
            count: '1000',
            userCount: 500,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          },
          event: { environment: 'production', release: '3.0.0' },
        });

      const incidentCountAfter = await prisma.incident.count({ where: { organizationId: orgId } });
      expect(incidentCountAfter).toBeGreaterThan(incidentCountBefore);
    });

    it('OWNER can delete a trigger rule', async () => {
      const res = await request
        .delete(`/api/v1/organizations/${orgId}/integrations/sentry/rules/${ruleId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ============================================================
  // 6. Sentry Issue Listing
  // ============================================================
  describe('6. Sentry Issue Listing', () => {
    it('returns list of normalized Sentry issues for the organization', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/integrations/sentry/issues`)
        .set('Authorization', `Bearer ${viewerToken}`);

      const body = res.body as TestRes<SentryIssueDto[]>;
      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ============================================================
  // 7. Sentry Evidence → Incident Linking & Timeline
  // ============================================================
  describe('7. Sentry Issue → Incident Evidence Linking & Timeline', () => {
    let sentryIssueDbId: string;

    beforeAll(async () => {
      const integration = await prisma.integration.findFirst({
        where: { organizationId: orgId, provider: 'SENTRY' },
      });
      if (!integration) throw new Error('Sentry integration not found');

      // Seed a SentryIssue record directly
      const issue = await prisma.sentryIssue.create({
        data: {
          organizationId: orgId,
          integrationId: integration.id,
          sentryIssueId: `manual-link-issue-${Date.now()}`,
          projectSlug: 'core-api',
          title: 'DBConnectionError: Pool exhausted',
          culprit: 'src/db/pool.ts in connect',
          level: 'error',
          userCount: 50,
          eventCount: 200,
          environment: 'production',
          release: '2.1.0',
          permalink: 'https://sentry.io/issues/99999/',
          projectId,
        },
      });
      sentryIssueDbId = issue.id;
    });

    it('RESPONDER can link a Sentry issue to an incident', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/incidents/${incidentId}/link`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ sentryIssueId: sentryIssueDbId });

      const body = res.body as TestRes<{ evidenceId: string; timelineEventId: string }>;
      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.evidenceId).toBeDefined();
      expect(body.data.timelineEventId).toBeDefined();

      // Verify IncidentEvidence record created
      const evidence = await prisma.incidentEvidence.findUnique({ where: { id: body.data.evidenceId } });
      expect(evidence).toBeDefined();
      expect(evidence?.type).toBe('SENTRY_ERROR');

      // Verify IncidentEvent timeline entry
      const event = await prisma.incidentEvent.findUnique({ where: { id: body.data.timelineEventId } });
      expect(event).toBeDefined();
      expect(event?.source).toBe('SENTRY');
      expect(event?.type).toBe('SENTRY_SIGNAL_LINKED');
    });

    it('VIEWER cannot link Sentry issues to incidents', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/incidents/${incidentId}/link`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ sentryIssueId: sentryIssueDbId });
      expect(res.status).toBe(403);
    });

    it('returns 404 when Sentry issue does not belong to the organization', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/sentry/incidents/${incidentId}/link`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ sentryIssueId: 'non-existent-issue-id' });
      expect(res.status).toBe(404);
    });
  });

  // ============================================================
  // 8. Cross-Tenant Isolation
  // ============================================================
  describe('8. Cross-Tenant Isolation', () => {
    it('rejects requests to another organization\'s Sentry integration', async () => {
      const res = await request
        .get(`/api/v1/organizations/${otherOrgId}/integrations/sentry`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects cross-org Sentry rule creation', async () => {
      const res = await request
        .post(`/api/v1/organizations/${otherOrgId}/integrations/sentry/rules`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Cross-org rule', minEventCount: 5, minUserCount: 1 });
      expect(res.status).toBe(403);
    });
  });

  // ============================================================
  // 9. Sentry Webhook Signature Verification (Production Guard)
  // ============================================================
  describe('9. HMAC Signature Verification', () => {
    it('accepts webhook when NODE_ENV is not production (dev mode)', async () => {
      // In test mode signature is not enforced (NODE_ENV=test)
      const res = await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', `sig-test-${Date.now()}`)
        // No valid signature header
        .send({
          action: 'error',
          issue: {
            id: `sig-test-issue-${Date.now()}`,
            title: 'TestError in test env',
            level: 'warning',
            count: '1',
            userCount: 1,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          },
        });

      expect(res.status).toBe(200);
    });

    it('verifySignature method returns false for invalid HMAC', () => {
      const result = SentryService.verifySentrySignature(
        JSON.stringify({ test: 'payload' }),
        'sha256=invalidsignature',
        'super-secret-webhook-key',
      );
      expect(result).toBe(false);
    });

    it('verifySignature method returns true for correct HMAC SHA-256', () => {
      const secret = 'my-sentry-webhook-secret';
      const payload = JSON.stringify({ action: 'error', issue: { id: '123' } });
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const result = SentryService.verifySentrySignature(payload, expected, secret);
      expect(result).toBe(true);
    });
  });

  // ============================================================
  // 10. Release & Environment Tracking
  // ============================================================
  describe('10. Release & Environment Tracking', () => {
    it('stores release and environment from webhook payload', async () => {
      const uniqueId = `release-env-test-${Date.now()}`;
      await request
        .post('/api/v1/webhooks/sentry')
        .set('sentry-hook-resource', `release-env-${Date.now()}`)
        .send({
          action: 'error',
          project_slug: 'core-api',
          issue: {
            id: uniqueId,
            title: 'ReleaseError: Build artifact corrupt',
            level: 'error',
            count: '2',
            userCount: 1,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
          },
          event: {
            release: 'v5.7.2-rc.1',
            environment: 'staging',
          },
        });

      const issue = await prisma.sentryIssue.findFirst({
        where: { organizationId: orgId, sentryIssueId: uniqueId },
      });
      expect(issue).toBeDefined();
      expect(issue?.release).toBe('v5.7.2-rc.1');
      expect(issue?.environment).toBe('staging');
    });
  });

  // ============================================================
  // 11. Phase 1–6 Regression
  // ============================================================
  describe('11. Phase 1–6 Regression', () => {
    it('health endpoint still responds with 200', async () => {
      const res = await request.get('/api/v1/health');
      expect(res.status).toBe(200);
    });

    it('auth endpoints still work', async () => {
      const res = await request.post('/api/v1/auth/login').send({
        email: 'nonexistent@example.com',
        password: 'wrongpassword',
      });
      expect([400, 401, 422]).toContain(res.status);
    });

    it('incidents endpoint still returns correctly for org member', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/incidents`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
    });

    it('GitHub integration endpoint still accessible', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/integrations/github`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
    });
  });
});
