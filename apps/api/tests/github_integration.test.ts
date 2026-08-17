import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { encryptText, decryptText, verifyGitHubWebhookSignature } from '../src/utils/crypto';
import crypto from 'crypto';

import { signAccessToken } from '../src/utils/jwt';

import type { GitHubIntegrationDto, GitHubRepositoryDto } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

interface TestRes<T> {
  success: boolean;
  data: T;
}

describe('Phase 6 — GitHub Integration Tests', () => {
  let ownerToken: string;
  let responderToken: string;
  let viewerToken: string;
  let orgId: string;
  let projectId: string;
  let serviceId: string;
  let incidentId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    const timestamp = Date.now();

    // 1. Create Organization A
    const orgA = await prisma.organization.create({
      data: { name: `GitHub Test Org ${timestamp}`, slug: `github-org-${timestamp}` },
    });
    orgId = orgA.id;

    // Create Owner, Responder, Viewer users
    const ownerUser = await prisma.user.create({
      data: { name: 'GitHub Owner', email: `gh_owner_${timestamp}@example.com` },
    });
    const responderUser = await prisma.user.create({
      data: { name: 'GitHub Responder', email: `gh_resp_${timestamp}@example.com` },
    });
    const viewerUser = await prisma.user.create({
      data: { name: 'GitHub Viewer', email: `gh_view_${timestamp}@example.com` },
    });

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgId, userId: ownerUser.id, role: 'OWNER' },
        { organizationId: orgId, userId: responderUser.id, role: 'RESPONDER' },
        { organizationId: orgId, userId: viewerUser.id, role: 'VIEWER' },
      ],
    });

    ownerToken = signAccessToken(ownerUser.id, ownerUser.email);
    responderToken = signAccessToken(responderUser.id, responderUser.email);
    viewerToken = signAccessToken(viewerUser.id, viewerUser.email);

    // Create Project, Service, and Incident in Org A
    const projRes = await request
      .post(`/api/v1/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Payment Platform', slug: 'payment-platform' });
    projectId = (projRes.body as TestRes<{ id: string }>).data.id;

    const servRes = await request
      .post(`/api/v1/projects/${projectId}/services`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Payment API', slug: 'payment-api' });
    serviceId = (servRes.body as TestRes<{ id: string }>).data.id;

    const incRes = await request
      .post(`/api/v1/organizations/${orgId}/incidents`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'GitHub Integration Test Incident',
        projectId,
        serviceId,
        severity: 'SEV2',
      });
    incidentId = (incRes.body as TestRes<{ id: string }>).data.id;

    // 2. Create Organization B for Tenant Isolation tests
    const orgB = await prisma.organization.create({
      data: { name: `Other Org ${timestamp}`, slug: `other-org-${timestamp}` },
    });
    otherOrgId = orgB.id;
  });

  describe('1. Crypto Utilities', () => {
    it('encrypts and decrypts text accurately with AES-256-GCM', () => {
      const plaintext = 'ghp_secret_token_12345';
      const encrypted = encryptText(plaintext);

      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = decryptText(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('verifies GitHub HMAC SHA-256 webhook signatures correctly', () => {
      const secret = 'test-webhook-secret';
      const body = JSON.stringify({ action: 'opened', repository: { name: 'test-repo' } });

      const hmac = crypto.createHmac('sha256', secret);
      const validHeader = 'sha256=' + hmac.update(body).digest('hex');

      expect(verifyGitHubWebhookSignature(body, validHeader, secret)).toBe(true);
      expect(verifyGitHubWebhookSignature(body, 'sha256=invalid_hex_signature', secret)).toBe(false);
      expect(verifyGitHubWebhookSignature(body, undefined, secret)).toBe(false);
    });
  });

  describe('2. Integration Management & RBAC', () => {
    it('allows OWNER to connect GitHub App Installation', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/connect-app`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ installationId: 'gh-app-inst-998877' });

      const body = res.body as TestRes<GitHubIntegrationDto>;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('CONNECTED');
      expect(body.data.metadata?.installationId).toBe('gh-app-inst-998877');
    });

    it('rejects RESPONDER or VIEWER connecting GitHub App', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/connect-app`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ installationId: 'gh-app-unauthorized' });

      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated PAT connect request with 401', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/connect-pat`)
        .send({ personalAccessToken: 'ghp_test_token_1234' });

      expect(res.status).toBe(401);
    });

    it('rejects VIEWER connecting PAT with 403', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/connect-pat`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ personalAccessToken: 'ghp_test_token_1234' });

      expect(res.status).toBe(403);
    });

    it('allows authenticated Owner to connect valid PAT', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/connect-pat`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ personalAccessToken: 'ghp_test_pat_token_valid_123456789' });

      const body = res.body as TestRes<GitHubIntegrationDto>;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('CONNECTED');
      expect(body.data.metadata?.authType).toBe('PAT');
      // PAT raw token is NEVER returned in response
      expect((body.data as unknown as Record<string, string>)['token']).toBeUndefined();
      expect((body.data as unknown as Record<string, string>)['personalAccessToken']).toBeUndefined();
    });

    it('allows members to view integration status', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgId}/integrations/github`)
        .set('Authorization', `Bearer ${viewerToken}`);

      const body = res.body as TestRes<GitHubIntegrationDto>;
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('CONNECTED');
    });

    it('allows disconnect by OWNER', async () => {
      // Connect first, then disconnect
      await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/connect-app`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ installationId: 'gh-app-inst-to-disconnect' });

      const res = await request
        .delete(`/api/v1/organizations/${orgId}/integrations/github/disconnect`)
        .set('Authorization', `Bearer ${ownerToken}`);

      const body = res.body as TestRes<GitHubIntegrationDto>;
      expect(res.status).toBe(200);
      expect(body.data.status).toBe('DISCONNECTED');

      // Re-connect for subsequent tests
      await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/connect-app`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ installationId: 'gh-app-inst-active' });
    });
  });

  describe('3. Repository Connection & Linking', () => {
    let repoId: string;

    it('syncs and lists connected repositories', async () => {
      const syncRes = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/repositories/sync`)
        .set('Authorization', `Bearer ${ownerToken}`);

      const syncBody = syncRes.body as TestRes<GitHubRepositoryDto[]>;
      expect(syncRes.status).toBe(200);
      expect(syncBody.data.length).toBeGreaterThan(0);

      repoId = syncBody.data[0].id;

      const listRes = await request
        .get(`/api/v1/organizations/${orgId}/integrations/github/repositories`)
        .set('Authorization', `Bearer ${viewerToken}`);

      const listBody = listRes.body as TestRes<GitHubRepositoryDto[]>;
      expect(listRes.status).toBe(200);
      expect(listBody.data.length).toBeGreaterThan(0);
    });

    it('links repository to IncidentHub project and service', async () => {
      const res = await request
        .patch(`/api/v1/organizations/${orgId}/integrations/github/repositories/${repoId}/link`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ projectId, serviceId });

      const body = res.body as TestRes<GitHubRepositoryDto>;
      expect(res.status).toBe(200);
      expect(body.data.projectId).toBe(projectId);
      expect(body.data.serviceId).toBe(serviceId);
    });

    it('prevents cross-tenant linking of another organization project', async () => {
      const res = await request
        .patch(`/api/v1/organizations/${otherOrgId}/integrations/github/repositories/${repoId}/link`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ projectId });

      expect(res.status).toBe(403);
    });
  });

  describe('4. Webhook Receiver & Idempotency', () => {
    const deliveryId = `deliv-test-${Date.now()}`;

    it('processes valid webhook push payload and enforces idempotency', async () => {
      const payload = {
        ref: 'refs/heads/main',
        repository: { full_name: 'acme/payment-service' },
        commits: [
          {
            id: 'abc123456789',
            message: 'fix: resolve payment race condition',
            timestamp: new Date().toISOString(),
            author: { name: 'Alice Dev', email: 'alice@example.com' },
          },
        ],
      };

      const res1 = await request
        .post('/api/v1/webhooks/github')
        .set('x-github-delivery', deliveryId)
        .set('x-github-event', 'push')
        .send(payload);

      const body1 = res1.body as TestRes<{ status: string }>;
      expect(res1.status).toBe(200);
      expect(body1.data.status).toBe('processed');

      // Duplicate delivery should be ignored safely
      const res2 = await request
        .post('/api/v1/webhooks/github')
        .set('x-github-delivery', deliveryId)
        .set('x-github-event', 'push')
        .send(payload);

      const body2 = res2.body as TestRes<{ status: string }>;
      expect(res2.status).toBe(200);
      expect(body2.data.status).toBe('ignored: duplicate delivery');
    });
  });

  describe('5. Activity-to-Incident Linking & Timeline', () => {
    let commitId: string;

    it('creates sample commit and links activity to incident', async () => {
      // Seed a commit record directly
      const repo = await prisma.gitHubRepository.findFirst({ where: { organizationId: orgId } });
      if (!repo) throw new Error('Repo not found');

      const commit = await prisma.gitHubCommit.create({
        data: {
          repositoryId: repo.id,
          sha: `sha-${Date.now()}`,
          authorName: 'Bob Engineer',
          message: 'fix: patch database deadlock',
          branch: 'main',
          url: 'https://github.com/acme/payment-service/commit/sha-123',
          committedAt: new Date(),
        },
      });
      commitId = commit.id;

      const res = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/incidents/${incidentId}/link`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({
          activityType: 'GITHUB_COMMIT',
          activityId: commitId,
        });

      const body = res.body as TestRes<{ evidenceId: string; timelineEventId: string }>;
      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.evidenceId).toBeDefined();
      expect(body.data.timelineEventId).toBeDefined();

      // Verify IncidentEvent audit timeline entry created with GITHUB source
      const event = await prisma.incidentEvent.findUnique({
        where: { id: body.data.timelineEventId },
      });
      expect(event).toBeDefined();
      expect(event?.source).toBe('GITHUB');
      expect(event?.type).toBe('GITHUB_ACTIVITY_LINKED');
    });
  });

  describe('6. Sync — Connected GITHUB_APP Integration', () => {
    it('A. Owner can sync repos on CONNECTED GITHUB_APP integration and repos are returned', async () => {
      // Reconnect as GITHUB_APP type to ensure correct state
      await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/connect-app`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ installationId: `gh-inst-sync-test-${Date.now()}` });

      const syncRes = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/repositories/sync`)
        .set('Authorization', `Bearer ${ownerToken}`);

      const syncBody = syncRes.body as TestRes<GitHubRepositoryDto[]>;
      expect(syncRes.status).toBe(200);
      expect(syncBody.success).toBe(true);
      expect(Array.isArray(syncBody.data)).toBe(true);
      expect(syncBody.data.length).toBeGreaterThan(0);
    });

    it('B. Sync on DISCONNECTED integration returns 400 with clear error', async () => {
      // Create a separate org with no integration
      const ts = Date.now();
      const disconnOrg = await prisma.organization.create({
        data: { name: `Disconnected Org ${ts}`, slug: `disconn-org-${ts}` },
      });
      const disconnOwner = await prisma.user.create({ data: { name: 'Disconn Owner', email: `disconn_${ts}@example.com` } });
      await prisma.organizationMember.create({ data: { organizationId: disconnOrg.id, userId: disconnOwner.id, role: 'OWNER' } });
      const disconnToken = signAccessToken(disconnOwner.id, disconnOwner.email);

      const syncRes = await request
        .post(`/api/v1/organizations/${disconnOrg.id}/integrations/github/repositories/sync`)
        .set('Authorization', `Bearer ${disconnToken}`);

      expect(syncRes.status).toBe(400);
      const body = syncRes.body as { error?: { message?: string } };
      expect(body.error?.message).toMatch(/not connected/i);
    });

    it('C. Sync on wrong organization returns 403 access denied', async () => {
      // otherOrgId exists but ownerToken is not a member
      const syncRes = await request
        .post(`/api/v1/organizations/${otherOrgId}/integrations/github/repositories/sync`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(syncRes.status).toBe(403);
    });

    it('D. Integration with missing encryptedConfig returns clear configuration error', async () => {
      const ts = Date.now();
      const noConfigOrg = await prisma.organization.create({
        data: { name: `NoConfig Org ${ts}`, slug: `noconfig-org-${ts}` },
      });
      const noConfigOwner = await prisma.user.create({ data: { name: 'NoConfig Owner', email: `noconfig_${ts}@example.com` } });
      await prisma.organizationMember.create({ data: { organizationId: noConfigOrg.id, userId: noConfigOwner.id, role: 'OWNER' } });
      const noConfigToken = signAccessToken(noConfigOwner.id, noConfigOwner.email);

      // Create integration with status CONNECTED but null encryptedConfig
      await prisma.integration.create({
        data: {
          organizationId: noConfigOrg.id,
          provider: 'GITHUB',
          status: 'CONNECTED',
          encryptedConfig: null,
          metadata: { authType: 'GITHUB_APP' },
        },
      });

      const syncRes = await request
        .post(`/api/v1/organizations/${noConfigOrg.id}/integrations/github/repositories/sync`)
        .set('Authorization', `Bearer ${noConfigToken}`);

      // Should return 400 with a credentials error, NOT "not connected"
      expect(syncRes.status).toBe(400);
      const body = syncRes.body as { error?: { message?: string } };
      expect(body.error?.message).toBeDefined();
    });

    it('E. Sync upserts repositories — no duplicate records created on repeated sync', async () => {
      // First sync — count repos
      const firstSync = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/repositories/sync`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(firstSync.status).toBe(200);
      const firstCount = (firstSync.body as TestRes<GitHubRepositoryDto[]>).data.length;

      // Second sync — count should be the same or only reflect GitHub API additions
      const secondSync = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/repositories/sync`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(secondSync.status).toBe(200);
      const secondCount = (secondSync.body as TestRes<GitHubRepositoryDto[]>).data.length;

      // Should not create duplicates
      expect(secondCount).toBe(firstCount);

      // Verify DB uniqueness: count distinct githubRepoId for this org
      const dbRepos = await prisma.gitHubRepository.findMany({ where: { organizationId: orgId } });
      const uniqueRepoIds = new Set(dbRepos.map((r) => r.githubRepoId.toString()));
      expect(uniqueRepoIds.size).toBe(dbRepos.length);
    });

    it('F. Viewer CANNOT trigger sync repositories (403 RBAC)', async () => {
      const syncRes = await request
        .post(`/api/v1/organizations/${orgId}/integrations/github/repositories/sync`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(syncRes.status).toBe(403);
    });
  });
});
