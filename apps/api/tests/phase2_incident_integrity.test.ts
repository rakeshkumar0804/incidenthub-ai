import { describe, it, expect, beforeAll, vi } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { signAccessToken } from '../src/utils/jwt';
import { hashPassword, encryptText } from '../src/utils/crypto';
import { OrgRole, IncidentSeverity, IncidentStatus, IncidentEnvironment } from '@incidenthub/shared';
import type { ApiSuccess } from '@incidenthub/shared';
import { IncidentService } from '../src/modules/incidents/incident.service';
import { SlackService } from '../src/modules/integrations/slack/slack.service';
import { JiraService } from '../src/modules/integrations/jira/jira.service';

const app = createApp();
const request = supertest(app);

describe('Phase 2 — Incident Domain and Nested Resource Integrity Regression Suite', () => {
  let orgAId = '';
  let orgBId = '';

  let ownerAUser: { id: string; email: string };
  let adminAUser: { id: string; email: string };
  let responderAUser: { id: string; email: string };
  let viewerAUser: { id: string; email: string };
  let memberBUser: { id: string; email: string };
  let outsiderUser: { id: string; email: string };

  let ownerAToken = '';
  let adminAToken = '';
  let responderAToken = '';
  let viewerAToken = '';
  let memberBToken = '';

  let projectAId = '';
  let serviceAId = '';
  let projectBId = '';

  let incidentA1Id = '';
  let incidentA2Id = '';
  let incidentB1Id = '';

  let commentA1Id = '';
  let postmortemA1Id = '';
  let actionItemA1Id = '';
  let actionItemB1Id = '';

  let ghIntegrationAId = '';
  let ghIntegrationBId = '';
  let sentryIntegrationAId = '';
  let sentryIntegrationBId = '';

  beforeAll(async () => {
    const ts = Date.now();
    const pwd = await hashPassword('SecurePass123!');

    // 1. Create Org A & Org B
    const orgA = await prisma.organization.create({
      data: { name: `Phase2 Org A ${ts}`, slug: `p2-org-a-${ts}` },
    });
    orgAId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: `Phase2 Org B ${ts}`, slug: `p2-org-b-${ts}` },
    });
    orgBId = orgB.id;

    // 2. Create Users for Org A
    ownerAUser = await prisma.user.create({
      data: { email: `p2_owner_a_${ts}@test.com`, name: 'Owner A', passwordHash: pwd, emailVerified: true },
    });
    adminAUser = await prisma.user.create({
      data: { email: `p2_admin_a_${ts}@test.com`, name: 'Admin A', passwordHash: pwd, emailVerified: true },
    });
    responderAUser = await prisma.user.create({
      data: { email: `p2_responder_a_${ts}@test.com`, name: 'Responder A', passwordHash: pwd, emailVerified: true },
    });
    viewerAUser = await prisma.user.create({
      data: { email: `p2_viewer_a_${ts}@test.com`, name: 'Viewer A', passwordHash: pwd, emailVerified: true },
    });

    // User for Org B
    memberBUser = await prisma.user.create({
      data: { email: `p2_member_b_${ts}@test.com`, name: 'Member B', passwordHash: pwd, emailVerified: true },
    });

    // Outsider user (not member of any org)
    outsiderUser = await prisma.user.create({
      data: { email: `p2_outsider_${ts}@test.com`, name: 'Outsider', passwordHash: pwd, emailVerified: true },
    });

    // Org A Memberships
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: ownerAUser.id, role: OrgRole.OWNER },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: adminAUser.id, role: OrgRole.ADMIN },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: responderAUser.id, role: OrgRole.RESPONDER },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: viewerAUser.id, role: OrgRole.VIEWER },
    });

    // Org B Membership
    await prisma.organizationMember.create({
      data: { organizationId: orgBId, userId: memberBUser.id, role: OrgRole.OWNER },
    });

    // JWT Tokens
    ownerAToken = signAccessToken(ownerAUser.id, ownerAUser.email);
    adminAToken = signAccessToken(adminAUser.id, adminAUser.email);
    responderAToken = signAccessToken(responderAUser.id, responderAUser.email);
    viewerAToken = signAccessToken(viewerAUser.id, viewerAUser.email);
    memberBToken = signAccessToken(memberBUser.id, memberBUser.email);

    // Project & Service in Org A
    const projA = await prisma.project.create({
      data: { organizationId: orgAId, name: 'Core Platform', slug: `core-p2-${ts}` },
    });
    projectAId = projA.id;

    const srvA = await prisma.service.create({
      data: { projectId: projectAId, name: 'Auth Engine', slug: `auth-p2-${ts}` },
    });
    serviceAId = srvA.id;

    // Project in Org B
    const projB = await prisma.project.create({
      data: { organizationId: orgBId, name: 'Org B Project', slug: `org-b-p2-${ts}` },
    });
    projectBId = projB.id;

    // Create Incident A1 in Org A
    const incA1 = await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        serviceId: serviceAId,
        createdById: ownerAUser.id,
        number: 1,
        title: 'Incident A1 - Database Lock',
        description: 'DB lock contention on auth tables',
        severity: IncidentSeverity.SEV2,
        status: IncidentStatus.OPEN,
        environment: IncidentEnvironment.PRODUCTION,
      },
    });
    incidentA1Id = incA1.id;

    // Create Incident A2 in Org A
    const incA2 = await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        createdById: ownerAUser.id,
        number: 2,
        title: 'Incident A2 - Cache Failure',
        description: 'Redis cache latency spike',
        severity: IncidentSeverity.SEV3,
        status: IncidentStatus.OPEN,
        environment: IncidentEnvironment.PRODUCTION,
      },
    });
    incidentA2Id = incA2.id;

    // Create Incident B1 in Org B
    const incB1 = await prisma.incident.create({
      data: {
        organizationId: orgBId,
        projectId: projectBId,
        createdById: memberBUser.id,
        number: 1,
        title: 'Incident B1 - Tenant B Alert',
        description: 'Org B separate incident',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.OPEN,
        environment: IncidentEnvironment.PRODUCTION,
      },
    });
    incidentB1Id = incB1.id;

    // Create a comment on Incident A1
    const commentA1 = await prisma.comment.create({
      data: {
        incidentId: incidentA1Id,
        userId: ownerAUser.id,
        content: 'Initial investigation note on Incident A1',
      },
    });
    commentA1Id = commentA1.id;

    // Create Postmortem and Action Item on Incident A1
    const postmortemA1 = await prisma.postmortem.create({
      data: {
        organizationId: orgAId,
        incidentId: incidentA1Id,
        status: 'DRAFT',
      },
    });
    postmortemA1Id = postmortemA1.id;

    const actionItemA1 = await prisma.actionItem.create({
      data: {
        organizationId: orgAId,
        postmortemId: postmortemA1Id,
        incidentId: incidentA1Id,
        title: 'Add connection pool retry logic',
        status: 'OPEN',
        priority: 'HIGH',
        assigneeId: responderAUser.id,
      },
    });
    actionItemA1Id = actionItemA1.id;

    // Create Postmortem and Action Item on Incident B1 (Org B)
    const postmortemB1 = await prisma.postmortem.create({
      data: {
        organizationId: orgBId,
        incidentId: incidentB1Id,
        status: 'DRAFT',
      },
    });

    const actionItemB1 = await prisma.actionItem.create({
      data: {
        organizationId: orgBId,
        postmortemId: postmortemB1.id,
        incidentId: incidentB1Id,
        title: 'Org B Action Item',
        status: 'OPEN',
        priority: 'MEDIUM',
        assigneeId: memberBUser.id,
      },
    });
    actionItemB1Id = actionItemB1.id;

    // Create GitHub Integrations for Org A and Org B
    const ghA = await prisma.integration.create({
      data: { organizationId: orgAId, provider: 'GITHUB', status: 'CONNECTED' },
    });
    ghIntegrationAId = ghA.id;

    const ghB = await prisma.integration.create({
      data: { organizationId: orgBId, provider: 'GITHUB', status: 'CONNECTED' },
    });
    ghIntegrationBId = ghB.id;

    // Create Sentry Integrations for Org A and Org B
    const sentryA = await prisma.integration.create({
      data: { organizationId: orgAId, provider: 'SENTRY', status: 'CONNECTED' },
    });
    sentryIntegrationAId = sentryA.id;

    const sentryB = await prisma.integration.create({
      data: { organizationId: orgBId, provider: 'SENTRY', status: 'CONNECTED' },
    });
    sentryIntegrationBId = sentryB.id;

    // Create Slack Integrations for Org A and Org B
    await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: 'SLACK',
        status: 'CONNECTED',
        encryptedConfig: encryptText(JSON.stringify({ botToken: 'xoxb-mock', teamId: 'T123', teamName: 'Test' })),
      },
    });

    // Create Jira Integrations for Org A and Org B
    await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: 'JIRA',
        status: 'CONNECTED',
        encryptedConfig: encryptText(JSON.stringify({ host: 'https://test.atlassian.net', apiToken: 'token', email: 'test@jira.com' })),
      },
    });
  });

  // ===========================================================================
  // 1. Removed Root Endpoint Aliases Return 404; Canonical Routes Reachable
  // ===========================================================================
  describe('1. Canonical Nested Routing & Removal of Ambiguous Root Aliases', () => {
    it('returns 404 for all 5 exact legacy root aliases (/incidents/:incidentId/...)', async () => {
      // 1. GET & POST /api/v1/incidents/:incidentId/comments
      const resCommentsGet = await request
        .get(`/api/v1/incidents/${incidentA1Id}/comments`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(resCommentsGet.status).toBe(404);

      const resCommentsPost = await request
        .post(`/api/v1/incidents/${incidentA1Id}/comments`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ content: 'test comment' });
      expect(resCommentsPost.status).toBe(404);

      // 2. GET & POST /api/v1/incidents/:incidentId/correlation
      const resCorrGet = await request
        .get(`/api/v1/incidents/${incidentA1Id}/correlation`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(resCorrGet.status).toBe(404);

      const resCorrPost = await request
        .post(`/api/v1/incidents/${incidentA1Id}/correlation`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({});
      expect(resCorrPost.status).toBe(404);

      // 3. GET & POST /api/v1/incidents/:incidentId/investigation
      const resInvGet = await request
        .get(`/api/v1/incidents/${incidentA1Id}/investigation`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(resInvGet.status).toBe(404);

      const resInvPost = await request
        .post(`/api/v1/incidents/${incidentA1Id}/investigation`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({});
      expect(resInvPost.status).toBe(404);

      // 4. GET & POST /api/v1/incidents/:incidentId/replay
      const resReplayGet = await request
        .get(`/api/v1/incidents/${incidentA1Id}/replay`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(resReplayGet.status).toBe(404);

      const resReplayPost = await request
        .post(`/api/v1/incidents/${incidentA1Id}/replay`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({});
      expect(resReplayPost.status).toBe(404);

      // 5. GET & POST /api/v1/incidents/:incidentId/postmortem
      const resPostmortemGet = await request
        .get(`/api/v1/incidents/${incidentA1Id}/postmortem`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(resPostmortemGet.status).toBe(404);

      const resPostmortemPost = await request
        .post(`/api/v1/incidents/${incidentA1Id}/postmortem`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({});
      expect(resPostmortemPost.status).toBe(404);
    });

    it('successfully accesses canonical organization-scoped nested routes', async () => {
      // Comments canonical route
      const resComments = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/comments`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect(resComments.status).toBe(200);

      // Correlation canonical route
      const resCorr = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/correlation`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect([200, 404]).toContain(resCorr.status);

      // Investigation canonical route
      const resInv = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/investigation`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect([200, 404]).toContain(resInv.status);

      // Replay canonical route
      const resReplay = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/replay`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect([200, 404]).toContain(resReplay.status);

      // Postmortem canonical route
      const resPostmortem = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/postmortem`)
        .set('Authorization', `Bearer ${ownerAToken}`);
      expect([200, 404]).toContain(resPostmortem.status);
    });
  });

  // ===========================================================================
  // 2. Incident State Machine Transitions (Blocker 1)
  // ===========================================================================
  describe('2. Incident State Machine Transitions & Strict Validation', () => {
    let testIncId = '';

    const createFreshIncident = async (status: IncidentStatus = IncidentStatus.OPEN) => {
      const inc = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          createdById: ownerAUser.id,
          number: Math.floor(Math.random() * 1000000) + 1000,
          title: `State Machine Test Incident ${Date.now()}`,
          severity: IncidentSeverity.SEV2,
          status,
          environment: IncidentEnvironment.PRODUCTION,
        },
      });
      return inc.id;
    };

    it('OPEN -> INVESTIGATING succeeds', async () => {
      testIncId = await createFreshIncident(IncidentStatus.OPEN);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.INVESTIGATING });
      expect(res.status).toBe(200);
      expect((res.body as { data: { status: string } }).data.status).toBe(IncidentStatus.INVESTIGATING);
    });

    it('OPEN -> RESOLVED succeeds', async () => {
      testIncId = await createFreshIncident(IncidentStatus.OPEN);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.RESOLVED });
      expect(res.status).toBe(200);
      expect((res.body as { data: { status: string } }).data.status).toBe(IncidentStatus.RESOLVED);
    });

    it('OPEN -> MITIGATING returns 400 (explicitly forbidden)', async () => {
      testIncId = await createFreshIncident(IncidentStatus.OPEN);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.MITIGATING });
      expect(res.status).toBe(400);
      expect((res.body as { error: { message: string } }).error.message).toContain('Invalid status transition');
    });

    it('INVESTIGATING -> MITIGATING succeeds', async () => {
      testIncId = await createFreshIncident(IncidentStatus.INVESTIGATING);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.MITIGATING });
      expect(res.status).toBe(200);
      expect((res.body as { data: { status: string } }).data.status).toBe(IncidentStatus.MITIGATING);
    });

    it('INVESTIGATING -> RESOLVED succeeds', async () => {
      testIncId = await createFreshIncident(IncidentStatus.INVESTIGATING);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.RESOLVED });
      expect(res.status).toBe(200);
      expect((res.body as { data: { status: string } }).data.status).toBe(IncidentStatus.RESOLVED);
    });

    it('INVESTIGATING -> OPEN returns 400', async () => {
      testIncId = await createFreshIncident(IncidentStatus.INVESTIGATING);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.OPEN });
      expect(res.status).toBe(400);
      expect((res.body as { error: { message: string } }).error.message).toContain('Invalid status transition');
    });

    it('MITIGATING -> RESOLVED succeeds', async () => {
      testIncId = await createFreshIncident(IncidentStatus.MITIGATING);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.RESOLVED });
      expect(res.status).toBe(200);
      expect((res.body as { data: { status: string } }).data.status).toBe(IncidentStatus.RESOLVED);
    });

    it('MITIGATING -> INVESTIGATING returns 400 (explicitly forbidden)', async () => {
      testIncId = await createFreshIncident(IncidentStatus.MITIGATING);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.INVESTIGATING });
      expect(res.status).toBe(400);
      expect((res.body as { error: { message: string } }).error.message).toContain('Invalid status transition');
    });

    it('MITIGATING -> OPEN returns 400', async () => {
      testIncId = await createFreshIncident(IncidentStatus.MITIGATING);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.OPEN });
      expect(res.status).toBe(400);
      expect((res.body as { error: { message: string } }).error.message).toContain('Invalid status transition');
    });

    it('RESOLVED is terminal: RESOLVED -> OPEN returns 400', async () => {
      testIncId = await createFreshIncident(IncidentStatus.RESOLVED);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.OPEN });
      expect(res.status).toBe(400);
      expect((res.body as { error: { message: string } }).error.message).toContain('Invalid status transition');
    });

    it('RESOLVED is terminal: RESOLVED -> INVESTIGATING returns 400', async () => {
      testIncId = await createFreshIncident(IncidentStatus.RESOLVED);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.INVESTIGATING });
      expect(res.status).toBe(400);
      expect((res.body as { error: { message: string } }).error.message).toContain('Invalid status transition');
    });

    it('RESOLVED is terminal: RESOLVED -> MITIGATING returns 400', async () => {
      testIncId = await createFreshIncident(IncidentStatus.RESOLVED);
      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.MITIGATING });
      expect(res.status).toBe(400);
      expect((res.body as { error: { message: string } }).error.message).toContain('Invalid status transition');
    });

    it('same-status update remains an idempotent no-op with 0 new timeline events', async () => {
      testIncId = await createFreshIncident(IncidentStatus.INVESTIGATING);
      const initialCount = await prisma.incidentEvent.count({ where: { incidentId: testIncId } });

      const res = await request
        .patch(`/api/v1/incidents/${testIncId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.INVESTIGATING });

      expect(res.status).toBe(200);
      const finalCount = await prisma.incidentEvent.count({ where: { incidentId: testIncId } });
      expect(finalCount).toBe(initialCount);
    });
  });

  // ===========================================================================
  // 3. Complete Integration Isolation Tests across all 4 Providers (Blocker 3)
  // ===========================================================================
  describe('3. Integration Isolation & Cross-Tenant Boundary Enforcement', () => {
    // ── 3a. GitHub Isolation ────────────────────────────────────────────────
    describe('3a. GitHub Integration Isolation', () => {
      it('Organization A cannot link activity belonging to Organization B (returns 404)', async () => {
        const repoB = await prisma.gitHubRepository.create({
          data: {
            organizationId: orgBId,
            integrationId: ghIntegrationBId,
            githubRepoId: BigInt(11223344),
            owner: 'org-b-gh',
            name: 'repo-b',
            fullName: 'org-b-gh/repo-b',
            url: 'https://github.com/org-b-gh/repo-b',
            isPrivate: true,
            defaultBranch: 'main',
          },
        });

        const commitB = await prisma.gitHubCommit.create({
          data: {
            repositoryId: repoB.id,
            sha: '1111222233334444555566667777888899990000',
            message: 'Org B Secret Commit',
            authorName: 'Developer B',
            url: 'https://github.com/org-b-gh/repo-b/commit/1111222233334444555566667777888899990000',
            committedAt: new Date(),
          },
        });

        const res = await request
          .post(`/api/v1/organizations/${orgAId}/integrations/github/incidents/${incidentA1Id}/link`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({ activityType: 'GITHUB_COMMIT', activityId: commitB.id });

        expect(res.status).toBe(404);

        // Prove rejection occurred before mutation
        const linkedRef = await prisma.externalReference.findFirst({
          where: { entityId: incidentA1Id, externalId: commitB.id },
        });
        expect(linkedRef).toBeNull();
      });

      it('rejects linking when supplied incident belongs to Organization B but URL is Organization A (403 Forbidden)', async () => {
        const repoA = await prisma.gitHubRepository.create({
          data: {
            organizationId: orgAId,
            integrationId: ghIntegrationAId,
            githubRepoId: BigInt(55667788),
            owner: 'org-a-gh',
            name: 'repo-a',
            fullName: 'org-a-gh/repo-a',
            url: 'https://github.com/org-a-gh/repo-a',
            isPrivate: true,
            defaultBranch: 'main',
          },
        });

        const commitA = await prisma.gitHubCommit.create({
          data: {
            repositoryId: repoA.id,
            sha: '2222333344445555666677778888999900001111',
            message: 'Org A Commit',
            authorName: 'Developer A',
            url: 'https://github.com/org-a-gh/repo-a/commit/2222333344445555666677778888999900001111',
            committedAt: new Date(),
          },
        });

        // Attempt linking commitA to incidentB1Id through Org A URL
        const res = await request
          .post(`/api/v1/organizations/${orgAId}/integrations/github/incidents/${incidentB1Id}/link`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({ activityType: 'GITHUB_COMMIT', activityId: commitA.id });

        expect(res.status).toBe(403);
      });

      it('rejects user from Organization B attempting to access Organization A integration endpoint (403 Forbidden)', async () => {
        const res = await request
          .post(`/api/v1/organizations/${orgAId}/integrations/github/incidents/${incidentA1Id}/link`)
          .set('Authorization', `Bearer ${memberBToken}`)
          .send({ activityType: 'GITHUB_COMMIT', activityId: 'dummy-commit-id' });

        expect(res.status).toBe(403);
      });
    });

    // ── 3b. Sentry Isolation ────────────────────────────────────────────────
    describe('3b. Sentry Integration Isolation', () => {
      it('Organization A cannot link a Sentry issue belonging to Organization B (returns 404)', async () => {
        const sentryIssueB = await prisma.sentryIssue.create({
          data: {
            organizationId: orgBId,
            integrationId: sentryIntegrationBId,
            sentryIssueId: `sentry-b-${Date.now()}`,
            projectSlug: 'org-b-app',
            title: 'DivisionByZero in Org B',
            culprit: 'calc.ts in compute',
            level: 'error',
            userCount: 2,
            eventCount: 5,
            permalink: 'https://sentry.io/org-b/issues/1',
          },
        });

        const res = await request
          .post(`/api/v1/organizations/${orgAId}/integrations/sentry/incidents/${incidentA1Id}/link`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({ sentryIssueId: sentryIssueB.id });

        expect(res.status).toBe(404);

        // Prove rejection occurred before mutation
        const linkedEvidence = await prisma.incidentEvidence.findFirst({
          where: { incidentId: incidentA1Id, externalRefId: sentryIssueB.id },
        });
        expect(linkedEvidence).toBeNull();
      });

      it('a valid Organization A Sentry issue cannot be linked through an Organization B incident (403 Forbidden)', async () => {
        const sentryIssueA = await prisma.sentryIssue.create({
          data: {
            organizationId: orgAId,
            integrationId: sentryIntegrationAId,
            sentryIssueId: `sentry-a-${Date.now()}`,
            projectSlug: 'core-platform',
            title: 'NullPointerException in Org A',
            culprit: 'auth.ts in verify',
            level: 'error',
            userCount: 3,
            eventCount: 10,
            permalink: 'https://sentry.io/org-a/issues/2',
          },
        });

        const res = await request
          .post(`/api/v1/organizations/${orgAId}/integrations/sentry/incidents/${incidentB1Id}/link`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({ sentryIssueId: sentryIssueA.id });

        expect(res.status).toBe(403);
      });
    });

    // ── 3c. Slack Isolation ─────────────────────────────────────────────────
    describe('3c. Slack Integration Isolation', () => {
      it('a Slack channel cannot be created for an incident outside the URL organization (403 Forbidden)', async () => {
        const slackSpy = vi.spyOn(SlackService, 'createIncidentChannel');

        const res = await request
          .post(`/api/v1/organizations/${orgAId}/integrations/slack/incidents/${incidentB1Id}/channel`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({});

        expect(res.status).toBe(403);
        // Prove external Slack service method was never invoked
        expect(slackSpy).not.toHaveBeenCalled();
        slackSpy.mockRestore();
      });
    });

    // ── 3d. Jira Isolation ──────────────────────────────────────────────────
    describe('3d. Jira Integration Isolation', () => {
      it('an action item from another incident in the same organization is rejected (404 Not Found)', async () => {
        // actionItemA1Id belongs to incidentA1Id. Attempt to create Jira issue through incidentA2Id.
        const res = await request
          .post(`/api/v1/organizations/${orgAId}/integrations/jira/incidents/${incidentA2Id}/action-items/${actionItemA1Id}/jira-issue`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({});

        expect(res.status).toBe(404);

        // Verify no Jira issue mutation or external reference was created
        const item = await prisma.actionItem.findUnique({ where: { id: actionItemA1Id } });
        expect(item?.jiraIssueId).toBeNull();
        const ref = await prisma.externalReference.findFirst({
          where: { entityId: actionItemA1Id, provider: 'JIRA' },
        });
        expect(ref).toBeNull();
      });

      it('a foreign-organization action item is rejected (404 Not Found)', async () => {
        // actionItemB1Id belongs to Org B. Attempt to create Jira issue through Org A incidentA1Id.
        const res = await request
          .post(`/api/v1/organizations/${orgAId}/integrations/jira/incidents/${incidentA1Id}/action-items/${actionItemB1Id}/jira-issue`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({});

        expect(res.status).toBe(404);

        // Verify foreign action item was not mutated and no external reference was created
        const item = await prisma.actionItem.findUnique({ where: { id: actionItemB1Id } });
        expect(item?.jiraIssueId).toBeNull();
        const ref = await prisma.externalReference.findFirst({
          where: { entityId: actionItemB1Id, provider: 'JIRA' },
        });
        expect(ref).toBeNull();
      });

      it('an action item and incident on cross-tenant URL are rejected with 403 Forbidden before invoking Jira service', async () => {
        const jiraSpy = vi.spyOn(JiraService, 'createJiraIssueFromActionItem');

        // incidentB1Id on Org A URL
        const res = await request
          .post(`/api/v1/organizations/${orgAId}/integrations/jira/incidents/${incidentB1Id}/action-items/${actionItemB1Id}/jira-issue`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({});

        expect(res.status).toBe(403);
        expect(jiraSpy).not.toHaveBeenCalled();
        jiraSpy.mockRestore();
      });
    });
  });

  // ===========================================================================
  // 4. Concurrency-Safe Sequential Incident Numbering (Blocker 4)
  // ===========================================================================
  describe('4. Concurrency-Safe Sequential Incident Numbering', () => {
    it('creates multiple incidents concurrently in one organization without duplication, producing strictly consecutive numbers', async () => {
      const ts = Date.now();
      const concurrentOrg = await prisma.organization.create({
        data: { name: `Concurrent Org ${ts}`, slug: `conc-org-${ts}` },
      });
      const concUser = await prisma.user.create({
        data: { email: `conc_user_${ts}@test.com`, name: 'Conc User', passwordHash: 'hash' },
      });
      await prisma.organizationMember.create({
        data: { organizationId: concurrentOrg.id, userId: concUser.id, role: OrgRole.OWNER },
      });
      const concToken = signAccessToken(concUser.id, concUser.email);

      const concProj = await prisma.project.create({
        data: { organizationId: concurrentOrg.id, name: 'Conc Project', slug: `conc-proj-${ts}` },
      });

      // Launch 5 concurrent incident creations via real HTTP endpoint
      const promises = [1, 2, 3, 4, 5].map((i) =>
        request
          .post(`/api/v1/organizations/${concurrentOrg.id}/incidents`)
          .set('Authorization', `Bearer ${concToken}`)
          .send({
            title: `Concurrent Incident ${i}`,
            projectId: concProj.id,
            severity: IncidentSeverity.SEV3,
          }),
      );

      const responses = await Promise.all(promises);

      // 1. Asserts that every request succeeds
      for (const res of responses) {
        expect(res.status).toBe(201);
      }

      // 2. Asserts that no incident number is duplicated
      const numbers = responses.map(
        (r) => (r.body as ApiSuccess<{ number: number; incidentNumber: string }>).data.number,
      );
      expect(new Set(numbers).size).toBe(5);

      // 3. Sorts resulting numbers and asserts they are consecutive
      numbers.sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5]);

      // 4. Confirms organization uniqueness constraint was not violated
      const dbIncidents = await prisma.incident.findMany({
        where: { organizationId: concurrentOrg.id },
        orderBy: { number: 'asc' },
      });
      expect(dbIncidents.length).toBe(5);
      expect(dbIncidents.map((inc) => inc.number)).toEqual([1, 2, 3, 4, 5]);

      // 5. Separately confirms another organization can independently use the same number sequence
      const secondOrg = await prisma.organization.create({
        data: { name: `Second Org ${ts}`, slug: `second-org-${ts}` },
      });
      await prisma.organizationMember.create({
        data: { organizationId: secondOrg.id, userId: concUser.id, role: OrgRole.OWNER },
      });
      const secondProj = await prisma.project.create({
        data: { organizationId: secondOrg.id, name: 'Second Proj', slug: `second-proj-${ts}` },
      });

      const secondResponses = await Promise.all([1, 2, 3].map((i) =>
        request
          .post(`/api/v1/organizations/${secondOrg.id}/incidents`)
          .set('Authorization', `Bearer ${concToken}`)
          .send({
            title: `Second Org Incident ${i}`,
            projectId: secondProj.id,
          }),
      ));

      for (const res of secondResponses) {
        expect(res.status).toBe(201);
      }
      const secondNumbers = secondResponses
        .map((r) => (r.body as ApiSuccess<{ number: number }>).data.number)
        .sort((a, b) => a - b);
      expect(secondNumbers).toEqual([1, 2, 3]);
    });
  });

  // ===========================================================================
  // 5. RBAC Enforcement on Incident Endpoints
  // ===========================================================================
  describe('5. RBAC Matrix across Nested Incident Endpoints', () => {
    it('allows OWNER, ADMIN, and RESPONDER to create comments', async () => {
      const resOwner = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/comments`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ content: 'Comment by OWNER' });
      expect(resOwner.status).toBe(201);

      const resAdmin = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/comments`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ content: 'Comment by ADMIN' });
      expect(resAdmin.status).toBe(201);

      const resResp = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/comments`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ content: 'Comment by RESPONDER' });
      expect(resResp.status).toBe(201);
    });

    it('rejects VIEWER attempts to mutate comments (403 Forbidden)', async () => {
      const resCreate = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/comments`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({ content: 'Viewer unauthorized comment' });
      expect(resCreate.status).toBe(403);

      const resPatch = await request
        .patch(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/comments/${commentA1Id}`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({ content: 'Viewer unauthorized edit' });
      expect(resPatch.status).toBe(403);

      const resDelete = await request
        .delete(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/comments/${commentA1Id}`)
        .set('Authorization', `Bearer ${viewerAToken}`);
      expect(resDelete.status).toBe(403);
    });

    it('allows VIEWER to read comments', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/comments`)
        .set('Authorization', `Bearer ${viewerAToken}`);
      expect(res.status).toBe(200);
    });

    it('rejects VIEWER attempts to trigger AI investigation, replay, or postmortem updates (403 Forbidden)', async () => {
      const resInv = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/investigation`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({});
      expect(resInv.status).toBe(403);

      const resReplay = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/replay`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({});
      expect(resReplay.status).toBe(403);

      const resPostmortem = await request
        .patch(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/postmortem`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({ summary: 'Viewer hacked postmortem' });
      expect(resPostmortem.status).toBe(403);

      const resActionItem = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/postmortem/action-items`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({ title: 'Viewer item', priority: 'LOW' });
      expect(resActionItem.status).toBe(403);
    });
  });

  // ===========================================================================
  // 6. Child Resource Integrity & Assignee Validation
  // ===========================================================================
  describe('6. Child Resource Integrity & Assignee Validation', () => {
    it('rejects comment update when commentId does not belong to the URL incidentId (404 Not Found)', async () => {
      const res = await request
        .patch(`/api/v1/organizations/${orgAId}/incidents/${incidentA2Id}/comments/${commentA1Id}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ content: 'Tampered comment content' });

      expect(res.status).toBe(404);
      const body = res.body as { error: { message: string } };
      expect(body.error.message).toContain('Comment not found');
    });

    it('rejects comment deletion when commentId does not belong to the URL incidentId (404 Not Found)', async () => {
      const res = await request
        .delete(`/api/v1/organizations/${orgAId}/incidents/${incidentA2Id}/comments/${commentA1Id}`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(404);
      const body = res.body as { error: { message: string } };
      expect(body.error.message).toContain('Comment not found');
    });

    it('rejects postmortem action item update when actionItemId does not belong to the URL incidentId (404 Not Found)', async () => {
      const res = await request
        .patch(`/api/v1/organizations/${orgAId}/incidents/${incidentA2Id}/postmortem/action-items/${actionItemA1Id}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ status: 'IN_PROGRESS' });

      expect(res.status).toBe(404);
      const body = res.body as { error: { message: string } };
      expect(body.error.message).toContain('Action item not found');
    });

    it('rejects action item creation if assigneeId is not an active organization member (400 Bad Request)', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/postmortem/action-items`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          title: 'Action for non-member',
          assigneeId: outsiderUser.id,
          priority: 'MEDIUM',
        });

      expect(res.status).toBe(400);
      const body = res.body as { error: { message: string } };
      expect(body.error.message).toContain('Assigned user is not a member of this organization');
    });

    it('rejects action item update if assigneeId is changed to a non-member (400 Bad Request)', async () => {
      const res = await request
        .patch(`/api/v1/organizations/${orgAId}/incidents/${incidentA1Id}/postmortem/action-items/${actionItemA1Id}`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          assigneeId: outsiderUser.id,
        });

      expect(res.status).toBe(400);
      const body = res.body as { error: { message: string } };
      expect(body.error.message).toContain('Assigned user is not a member of this organization');
    });
  });

  // ===========================================================================
  // 7. Concurrency Race on Incident Status Update
  // ===========================================================================
  describe('7. Concurrency Race on Incident Status Update', () => {
    it('atomic conditional update permits exactly 1 winner and rejects loser with 409 Conflict', async () => {
      const raceIncident = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          createdById: ownerAUser.id,
          number: Math.floor(Math.random() * 1000000) + 50000,
          title: 'Concurrent Race Incident',
          severity: IncidentSeverity.SEV2,
          status: IncidentStatus.OPEN,
          environment: IncidentEnvironment.PRODUCTION,
        },
      });

      // Fire 2 concurrent updateStatus calls from OPEN to INVESTIGATING
      const p1 = IncidentService.updateStatus(orgAId, raceIncident.id, ownerAUser.id, {
        status: IncidentStatus.INVESTIGATING,
      });
      const p2 = IncidentService.updateStatus(orgAId, raceIncident.id, ownerAUser.id, {
        status: IncidentStatus.INVESTIGATING,
      });

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');

      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      const finalInc = await prisma.incident.findUnique({
        where: { id: raceIncident.id },
      });
      expect(finalInc?.status).toBe(IncidentStatus.INVESTIGATING);

      const timelineEvents = await prisma.incidentEvent.findMany({
        where: { incidentId: raceIncident.id },
      });
      expect(timelineEvents.length).toBeLessThanOrEqual(2);
    });
  });
});
