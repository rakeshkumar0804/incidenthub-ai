import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { signAccessToken } from '../src/utils/jwt';
import { hashPassword } from '../src/utils/crypto';
import { OrgRole } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Phase 1 — Trust Boundary Closure Regression Suite', () => {
  let orgAId = '';
  let orgBId = '';
  let ownerAUser: { id: string; email: string };
  let adminAUser: { id: string; email: string };
  let responderAUser: { id: string; email: string };
  let viewerAUser: { id: string; email: string };
  let memberBUser: { id: string; email: string };

  let ownerAToken = '';
  let adminAToken = '';
  let responderAToken = '';
  let viewerAToken = '';
  let memberBToken = '';

  let ownerAMemberId = '';

  let projectAId = '';
  let serviceAId = '';
  let teamAId = '';

  const testSecretGithub = process.env['GITHUB_WEBHOOK_SECRET'] || 'test-github-webhook-secret-phase1-audit';
  const testSecretSentry = process.env['SENTRY_WEBHOOK_SECRET'] || 'test-sentry-webhook-secret-phase1-audit';
  const testSecretSlack = process.env['SLACK_SIGNING_SECRET'] || 'test-slack-signing-secret-phase1-audit';
  const testSecretJira = process.env['JIRA_WEBHOOK_SECRET'] || 'test-jira-webhook-secret-phase1-audit';

  beforeAll(async () => {
    const ts = Date.now();
    const pwd = await hashPassword('SecurePass123!');

    // Create Organization A
    const orgA = await prisma.organization.create({
      data: {
        name: `Org Trust A ${ts}`,
        slug: `org-trust-a-${ts}`,
      },
    });
    orgAId = orgA.id;

    // Create Organization B (Tenant Isolation test)
    const orgB = await prisma.organization.create({
      data: {
        name: `Org Trust B ${ts}`,
        slug: `org-trust-b-${ts}`,
      },
    });
    orgBId = orgB.id;

    // Users for Org A
    ownerAUser = await prisma.user.create({
      data: { email: `owner_a_${ts}@test.com`, name: 'Owner A', passwordHash: pwd, emailVerified: true },
    });
    adminAUser = await prisma.user.create({
      data: { email: `admin_a_${ts}@test.com`, name: 'Admin A', passwordHash: pwd, emailVerified: true },
    });
    responderAUser = await prisma.user.create({
      data: { email: `responder_a_${ts}@test.com`, name: 'Responder A', passwordHash: pwd, emailVerified: true },
    });
    viewerAUser = await prisma.user.create({
      data: { email: `viewer_a_${ts}@test.com`, name: 'Viewer A', passwordHash: pwd, emailVerified: true },
    });

    // User for Org B
    memberBUser = await prisma.user.create({
      data: { email: `member_b_${ts}@test.com`, name: 'Member B', passwordHash: pwd, emailVerified: true },
    });

    // Org A Memberships
    const mOwner = await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: ownerAUser.id, role: OrgRole.OWNER },
    });
    ownerAMemberId = mOwner.id;

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
      data: { organizationId: orgBId, userId: memberBUser.id, role: OrgRole.RESPONDER },
    });

    // JWT Access Tokens
    ownerAToken = signAccessToken(ownerAUser.id, ownerAUser.email);
    adminAToken = signAccessToken(adminAUser.id, adminAUser.email);
    responderAToken = signAccessToken(responderAUser.id, responderAUser.email);
    viewerAToken = signAccessToken(viewerAUser.id, viewerAUser.email);
    memberBToken = signAccessToken(memberBUser.id, memberBUser.email);

    // Project & Service in Org A
    const proj = await prisma.project.create({
      data: {
        organizationId: orgAId,
        name: 'Core API',
        slug: `core-api-${ts}`,
      },
    });
    projectAId = proj.id;

    const srv = await prisma.service.create({
      data: {
        projectId: projectAId,
        name: 'Auth Service',
        slug: `auth-srv-${ts}`,
      },
    });
    serviceAId = srv.id;

    // Team in Org A
    const tm = await prisma.team.create({
      data: {
        organizationId: orgAId,
        name: `Backend Team ${ts}`,
      },
    });
    teamAId = tm.id;

    // Integrations & Repositories for Org A webhook tests
    const ghInteg = await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: 'GITHUB',
        status: 'CONNECTED',
      },
    });

    await prisma.gitHubRepository.createMany({
      data: [
        {
          organizationId: orgAId,
          integrationId: ghInteg.id,
          githubRepoId: BigInt(991001 + (ts % 10000)),
          name: 'valid-repo',
          fullName: 'org/valid-repo',
          owner: 'org',
          url: 'https://github.com/org/valid-repo',
        },
        {
          organizationId: orgAId,
          integrationId: ghInteg.id,
          githubRepoId: BigInt(992002 + (ts % 10000)),
          name: 'replay-repo',
          fullName: 'org/replay-repo',
          owner: 'org',
          url: 'https://github.com/org/replay-repo',
        },
      ],
    });

    await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: 'SENTRY',
        status: 'CONNECTED',
        metadata: { sentryOrgSlug: 'sentry-org-trust-a' },
      },
    });

    const jiraInteg = await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: 'JIRA',
        status: 'CONNECTED',
        metadata: { siteUrl: 'https://jira.test' },
      },
    });

    await prisma.externalReference.create({
      data: {
        organizationId: orgAId,
        integrationId: jiraInteg.id,
        provider: 'JIRA',
        entityType: 'ACTION_ITEM',
        entityId: 'test-action-item-id',
        externalResourceType: 'JIRA_ISSUE',
        externalId: 'ENG-999',
      },
    });
  });

  // ===========================================================================
  // 1. All 4 removed endpoints return 404
  // ===========================================================================
  it('1. All 4 removed dangerous HTTP endpoints return 404', async () => {
    const res1 = await request.post('/api/v1/auth/dev-restore-owner').send({});
    expect(res1.status).toBe(404);

    const res2 = await request.post('/api/v1/auth/dev-reset-viewer').send({});
    expect(res2.status).toBe(404);

    const res3 = await request.post('/api/v1/auth/seed-demo').send({});
    expect(res3.status).toBe(404);

    const res4 = await request.post('/api/v1/auth/clean-demo-orgs').send({});
    expect(res4.status).toBe(404);
  });

  // ===========================================================================
  // 2. Registration creates personal org, user is OWNER, zero Acme membership
  // ===========================================================================
  it('2. Registration attaches user only to personal org as OWNER with no Acme membership', async () => {
    const regEmail = `isolated_reg_${Date.now()}@test.com`;
    const res = await request.post('/api/v1/auth/register').send({
      email: regEmail,
      password: 'SecurePassword123!',
      confirmPassword: 'SecurePassword123!',
      name: 'Isolated User',
      organizationName: 'Isolated Workspace',
    });

    expect(res.status).toBe(201);
    const regBody = res.body as { success: boolean; data: { user: { id: string } } };
    expect(regBody.success).toBe(true);

    const registeredUserId = regBody.data.user.id;
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: registeredUserId },
      include: { organization: true },
    });

    expect(memberships.length).toBe(1);
    const primaryMember = memberships[0];
    expect(primaryMember?.role).toBe(OrgRole.OWNER);
    expect(primaryMember?.organization.slug).not.toBe('acme-engineering');
  });

  // ===========================================================================
  // 3. OWNER & ADMIN can perform every project/team/service mutation
  // ===========================================================================
  it('3. OWNER and ADMIN can perform all project, service, and team mutations', async () => {
    // 3a. OWNER mutations
    const resOwnerProj = await request
      .post(`/api/v1/organizations/${orgAId}/projects`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'Owner Project', slug: `owner-proj-${Date.now()}` });
    expect(resOwnerProj.status).toBe(201);
    const ownerProjId = (resOwnerProj.body as { data: { id: string } }).data.id;

    const resOwnerSrv = await request
      .post(`/api/v1/projects/${ownerProjId}/services`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'Owner Service', slug: `owner-srv-${Date.now()}` });
    expect(resOwnerSrv.status).toBe(201);
    const ownerSrvId = (resOwnerSrv.body as { data: { id: string } }).data.id;

    const resOwnerTeam = await request
      .post(`/api/v1/organizations/${orgAId}/teams`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: `Owner Team ${Date.now()}` });
    expect(resOwnerTeam.status).toBe(201);
    const ownerTeamId = (resOwnerTeam.body as { data: { id: string } }).data.id;

    // Updates by OWNER
    const resPatchProjOwner = await request
      .patch(`/api/v1/projects/${ownerProjId}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'Owner Proj Updated' });
    expect(resPatchProjOwner.status).toBe(200);

    const resPatchSrvOwner = await request
      .patch(`/api/v1/services/${ownerSrvId}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'Owner Srv Updated' });
    expect(resPatchSrvOwner.status).toBe(200);

    const resPatchTeamOwner = await request
      .patch(`/api/v1/teams/${ownerTeamId}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'Owner Team Updated' });
    expect(resPatchTeamOwner.status).toBe(200);

    // 3b. ADMIN mutations
    const resAdminProj = await request
      .post(`/api/v1/organizations/${orgAId}/projects`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ name: 'Admin Project', slug: `admin-proj-${Date.now()}` });
    expect(resAdminProj.status).toBe(201);
    const adminProjId = (resAdminProj.body as { data: { id: string } }).data.id;

    const resAdminSrv = await request
      .post(`/api/v1/projects/${adminProjId}/services`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ name: 'Admin Service', slug: `admin-srv-${Date.now()}` });
    expect(resAdminSrv.status).toBe(201);
    const adminSrvId = (resAdminSrv.body as { data: { id: string } }).data.id;

    const resAdminTeam = await request
      .post(`/api/v1/organizations/${orgAId}/teams`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ name: `Admin Team ${Date.now()}` });
    expect(resAdminTeam.status).toBe(201);
    const adminTeamId = (resAdminTeam.body as { data: { id: string } }).data.id;

    // Team member management by ADMIN
    const resAddMember = await request
      .post(`/api/v1/teams/${adminTeamId}/members`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ userId: responderAUser.id });
    expect([200, 201]).toContain(resAddMember.status);

    const resRemoveMember = await request
      .delete(`/api/v1/teams/${adminTeamId}/members/${responderAUser.id}`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(resRemoveMember.status).toBe(200);

    // Deletions by ADMIN
    const resDelSrvAdmin = await request
      .delete(`/api/v1/services/${adminSrvId}`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(resDelSrvAdmin.status).toBe(200);

    const resDelProjAdmin = await request
      .delete(`/api/v1/projects/${adminProjId}`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(resDelProjAdmin.status).toBe(200);

    const resDelTeamAdmin = await request
      .delete(`/api/v1/teams/${adminTeamId}`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(resDelTeamAdmin.status).toBe(200);
  });

  // ===========================================================================
  // 4. VIEWER can read projects, teams, services
  // ===========================================================================
  it('4. VIEWER can read projects, teams, and services within their organization', async () => {
    const resProj = await request
      .get(`/api/v1/projects/${projectAId}`)
      .set('Authorization', `Bearer ${viewerAToken}`);
    expect(resProj.status).toBe(200);
    const projBody = resProj.body as { data: { id: string } };
    expect(projBody.data.id).toBe(projectAId);

    const resServices = await request
      .get(`/api/v1/projects/${projectAId}/services`)
      .set('Authorization', `Bearer ${viewerAToken}`);
    expect(resServices.status).toBe(200);

    const resSrv = await request
      .get(`/api/v1/services/${serviceAId}`)
      .set('Authorization', `Bearer ${viewerAToken}`);
    expect(resSrv.status).toBe(200);
    const srvBody = resSrv.body as { data: { id: string } };
    expect(srvBody.data.id).toBe(serviceAId);

    const resTeam = await request
      .get(`/api/v1/teams/${teamAId}`)
      .set('Authorization', `Bearer ${viewerAToken}`);
    expect(resTeam.status).toBe(200);
    const teamBody = resTeam.body as { data: { id: string } };
    expect(teamBody.data.id).toBe(teamAId);
  });

  // ===========================================================================
  // 5. VIEWER gets 403 on project/team/service mutations
  // ===========================================================================
  it('5. VIEWER gets 403 on project, service, and team mutations', async () => {
    // Project mutations
    const resPostProj = await request
      .post(`/api/v1/organizations/${orgAId}/projects`)
      .set('Authorization', `Bearer ${viewerAToken}`)
      .send({ name: 'Viewer Hacked Project', slug: 'vhack-proj' });
    expect(resPostProj.status).toBe(403);

    const resPatchProj = await request
      .patch(`/api/v1/projects/${projectAId}`)
      .set('Authorization', `Bearer ${viewerAToken}`)
      .send({ name: 'Hacked Project' });
    expect(resPatchProj.status).toBe(403);

    const resDeleteProj = await request
      .delete(`/api/v1/projects/${projectAId}`)
      .set('Authorization', `Bearer ${viewerAToken}`);
    expect(resDeleteProj.status).toBe(403);

    // Service mutations
    const resPostSrv = await request
      .post(`/api/v1/projects/${projectAId}/services`)
      .set('Authorization', `Bearer ${viewerAToken}`)
      .send({ name: 'Hacked Service' });
    expect(resPostSrv.status).toBe(403);

    const resPatchSrv = await request
      .patch(`/api/v1/services/${serviceAId}`)
      .set('Authorization', `Bearer ${viewerAToken}`)
      .send({ name: 'Renamed Service' });
    expect(resPatchSrv.status).toBe(403);

    const resDeleteSrv = await request
      .delete(`/api/v1/services/${serviceAId}`)
      .set('Authorization', `Bearer ${viewerAToken}`);
    expect(resDeleteSrv.status).toBe(403);

    // Team mutations
    const resPostTeam = await request
      .post(`/api/v1/organizations/${orgAId}/teams`)
      .set('Authorization', `Bearer ${viewerAToken}`)
      .send({ name: 'Viewer Team' });
    expect(resPostTeam.status).toBe(403);

    const resPatchTeam = await request
      .patch(`/api/v1/teams/${teamAId}`)
      .set('Authorization', `Bearer ${viewerAToken}`)
      .send({ name: 'Renamed Team' });
    expect(resPatchTeam.status).toBe(403);

    const resDeleteTeam = await request
      .delete(`/api/v1/teams/${teamAId}`)
      .set('Authorization', `Bearer ${viewerAToken}`);
    expect(resDeleteTeam.status).toBe(403);

    const resAddMember = await request
      .post(`/api/v1/teams/${teamAId}/members`)
      .set('Authorization', `Bearer ${viewerAToken}`)
      .send({ userId: viewerAUser.id });
    expect(resAddMember.status).toBe(403);
  });

  // ===========================================================================
  // 6. RESPONDER can read, but gets 403 on management mutations
  // ===========================================================================
  it('6. RESPONDER can read projects/teams/services but gets 403 on management mutations', async () => {
    // Read operations succeed
    const resReadProj = await request
      .get(`/api/v1/projects/${projectAId}`)
      .set('Authorization', `Bearer ${responderAToken}`);
    expect(resReadProj.status).toBe(200);

    const resReadSrv = await request
      .get(`/api/v1/services/${serviceAId}`)
      .set('Authorization', `Bearer ${responderAToken}`);
    expect(resReadSrv.status).toBe(200);

    const resReadTeam = await request
      .get(`/api/v1/teams/${teamAId}`)
      .set('Authorization', `Bearer ${responderAToken}`);
    expect(resReadTeam.status).toBe(200);

    // Management mutations fail (403)
    const resCreateProj = await request
      .post(`/api/v1/organizations/${orgAId}/projects`)
      .set('Authorization', `Bearer ${responderAToken}`)
      .send({ name: 'Responder Project', slug: 'resp-proj' });
    expect(resCreateProj.status).toBe(403);

    const resPatchProj = await request
      .patch(`/api/v1/projects/${projectAId}`)
      .set('Authorization', `Bearer ${responderAToken}`)
      .send({ name: 'Resp Update' });
    expect(resPatchProj.status).toBe(403);

    const resDeleteProj = await request
      .delete(`/api/v1/projects/${projectAId}`)
      .set('Authorization', `Bearer ${responderAToken}`);
    expect(resDeleteProj.status).toBe(403);

    const resCreateSrv = await request
      .post(`/api/v1/projects/${projectAId}/services`)
      .set('Authorization', `Bearer ${responderAToken}`)
      .send({ name: 'Resp Srv' });
    expect(resCreateSrv.status).toBe(403);

    const resPatchSrv = await request
      .patch(`/api/v1/services/${serviceAId}`)
      .set('Authorization', `Bearer ${responderAToken}`)
      .send({ name: 'Resp Srv Update' });
    expect(resPatchSrv.status).toBe(403);

    const resDeleteSrv = await request
      .delete(`/api/v1/services/${serviceAId}`)
      .set('Authorization', `Bearer ${responderAToken}`);
    expect(resDeleteSrv.status).toBe(403);

    const resCreateTeam = await request
      .post(`/api/v1/organizations/${orgAId}/teams`)
      .set('Authorization', `Bearer ${responderAToken}`)
      .send({ name: 'Resp Team' });
    expect(resCreateTeam.status).toBe(403);

    const resPatchTeam = await request
      .patch(`/api/v1/teams/${teamAId}`)
      .set('Authorization', `Bearer ${responderAToken}`)
      .send({ name: 'Resp Team Update' });
    expect(resPatchTeam.status).toBe(403);

    const resDeleteTeam = await request
      .delete(`/api/v1/teams/${teamAId}`)
      .set('Authorization', `Bearer ${responderAToken}`);
    expect(resDeleteTeam.status).toBe(403);
  });

  // ===========================================================================
  // 7. Cross-tenant IDs rejected with 403
  // ===========================================================================
  it('7. Cross-tenant IDs rejected with 403 when user belongs to another organization', async () => {
    // User from Org B attempts to access Org A project
    const resCrossProj = await request
      .get(`/api/v1/projects/${projectAId}`)
      .set('Authorization', `Bearer ${memberBToken}`);
    expect(resCrossProj.status).toBe(403);

    // User from Org B attempts to access Org A service
    const resCrossSrv = await request
      .get(`/api/v1/services/${serviceAId}`)
      .set('Authorization', `Bearer ${memberBToken}`);
    expect(resCrossSrv.status).toBe(403);

    // User from Org B attempts to access Org A team
    const resCrossTeam = await request
      .get(`/api/v1/teams/${teamAId}`)
      .set('Authorization', `Bearer ${memberBToken}`);
    expect(resCrossTeam.status).toBe(403);
  });

  // ===========================================================================
  // 8. ADMIN cannot demote or remove OWNER (403)
  // ===========================================================================
  it('8. ADMIN cannot demote or remove an OWNER (returns 403)', async () => {
    // ADMIN attempts to demote OWNER
    const resDemote = await request
      .patch(`/api/v1/organizations/${orgAId}/members/${ownerAMemberId}`)
      .set('Authorization', `Bearer ${adminAToken}`)
      .send({ role: 'ADMIN' });
    expect(resDemote.status).toBe(403);

    // ADMIN attempts to remove OWNER
    const resRemove = await request
      .delete(`/api/v1/organizations/${orgAId}/members/${ownerAMemberId}`)
      .set('Authorization', `Bearer ${adminAToken}`);
    expect(resRemove.status).toBe(403);
  });

  // ===========================================================================
  // 9. Sole OWNER cannot be downgraded or removed (400)
  // ===========================================================================
  it('9. Sole OWNER cannot be downgraded or removed (returns 400)', async () => {
    // Sole OWNER attempts to self-demote to ADMIN
    const resDemote = await request
      .patch(`/api/v1/organizations/${orgAId}/members/${ownerAMemberId}`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ role: 'ADMIN' });
    expect(resDemote.status).toBe(400);

    // Sole OWNER attempts to remove themselves
    const resRemove = await request
      .delete(`/api/v1/organizations/${orgAId}/members/${ownerAMemberId}`)
      .set('Authorization', `Bearer ${ownerAToken}`);
    expect(resRemove.status).toBe(400);
  });

  // ===========================================================================
  // 10. Tokens absent in production-mode responses
  // ===========================================================================
  it('10. Tokens absent from responses when NODE_ENV is production', async () => {
    const origEnv = process.env['NODE_ENV'];
    try {
      process.env['NODE_ENV'] = 'production';
      const prodEmail = `prod_test_${Date.now()}@example.com`;

      // 10a. Registration in prod mode
      const resReg = await request.post('/api/v1/auth/register').send({
        email: prodEmail,
        password: 'SecurePhase1Pass!',
        confirmPassword: 'SecurePhase1Pass!',
        name: 'Prod User',
        organizationName: 'Prod Org',
      });
      expect(resReg.status).toBe(201);
      const regData = resReg.body as { data: { verificationToken?: string } };
      expect(regData.data.verificationToken).toBeUndefined();

      // 10b. Forgot password in prod mode
      const resForgot = await request.post('/api/v1/auth/forgot-password').send({
        email: prodEmail,
      });
      expect(resForgot.status).toBe(200);
      const forgotData = resForgot.body as { data: { resetToken?: string } };
      expect(forgotData.data.resetToken).toBeUndefined();

      // 10c. Resend verification in prod mode
      const resResend = await request.post('/api/v1/auth/resend-verification').send({
        email: prodEmail,
      });
      expect(resResend.status).toBe(200);
      const resendData = resResend.body as { data: { verificationToken?: string } };
      expect(resendData.data.verificationToken).toBeUndefined();
    } finally {
      process.env['NODE_ENV'] = origEnv;
    }
  });

  // ===========================================================================
  // 11. Webhooks reject missing and invalid signatures in all environments
  // ===========================================================================
  it('11. Webhooks reject missing and invalid signatures across all providers', async () => {
    // 11a. GitHub webhook without signature -> 403
    const resGhNoSig = await request
      .post('/api/v1/webhooks/github')
      .send({ repository: { full_name: 'test/repo' } });
    expect(resGhNoSig.status).toBe(403);

    // 11b. GitHub webhook with invalid signature -> 403
    const resGhBadSig = await request
      .post('/api/v1/webhooks/github')
      .set('x-hub-signature-256', 'sha256=invalid1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')
      .send({ repository: { full_name: 'test/repo' } });
    expect(resGhBadSig.status).toBe(403);

    // 11c. Sentry webhook without signature -> 403
    const resSentryNoSig = await request
      .post('/api/v1/webhooks/sentry')
      .send({ action: 'created', issue: { id: 123 } });
    expect(resSentryNoSig.status).toBe(403);

    // 11d. Sentry webhook with invalid signature -> 403
    const resSentryBadSig = await request
      .post('/api/v1/webhooks/sentry')
      .set('sentry-hook-signature', 'sha256=invalid_sentry_sig_hex')
      .send({ action: 'created', issue: { id: 123 } });
    expect(resSentryBadSig.status).toBe(403);

    // 11e. Slack webhook without signature -> 401
    const resSlackNoSig = await request
      .post('/api/v1/webhooks/slack')
      .send({ type: 'url_verification' });
    expect(resSlackNoSig.status).toBe(401);

    // 11f. Slack webhook with stale timestamp (> 300s) -> 401
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 400);
    const slackPayload = JSON.stringify({ type: 'url_verification' });
    const staleSlackSig = `v0=${crypto.createHmac('sha256', testSecretSlack).update(`v0:${staleTimestamp}:${slackPayload}`).digest('hex')}`;
    const resSlackStale = await request
      .post('/api/v1/webhooks/slack')
      .set('x-slack-request-timestamp', staleTimestamp)
      .set('x-slack-signature', staleSlackSig)
      .send({ type: 'url_verification' });
    expect(resSlackStale.status).toBe(401);

    // 11g. Jira webhook without secret -> 403
    const resJiraNoSecret = await request
      .post('/api/v1/webhooks/jira')
      .send({ webhookEvent: 'jira:issue_updated', issue: { key: 'ENG-123' } });
    expect(resJiraNoSecret.status).toBe(403);

    // 11h. Jira webhook with invalid secret -> 403
    const resJiraBadSecret = await request
      .post('/api/v1/webhooks/jira')
      .set('x-atlassian-webhook-secret', 'wrong-jira-secret-key')
      .send({ webhookEvent: 'jira:issue_updated', issue: { key: 'ENG-123' } });
    expect(resJiraBadSecret.status).toBe(403);
  });

  // ===========================================================================
  // 12. Valid signed webhooks processed
  // ===========================================================================
  it('12. Valid signed webhooks for GitHub, Sentry, Slack, Jira processed successfully', async () => {
    // 12a. GitHub valid signature
    const ghBody = {
      repository: { full_name: 'org/valid-repo' },
      zen: 'Responsive is better than fast.',
    };
    const ghRaw = JSON.stringify(ghBody);
    const ghSig = `sha256=${crypto.createHmac('sha256', testSecretGithub).update(ghRaw).digest('hex')}`;

    const resGh = await request
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', ghSig)
      .set('x-github-delivery', `delivery-${Date.now()}`)
      .set('x-github-event', 'ping')
      .send(ghBody);

    expect(resGh.status).toBe(200);
    expect((resGh.body as { data: { status: string } }).data.status).toBe('processed');

    // 12b. Sentry valid signature
    const sentryBody = {
      action: 'created',
      organization_slug: 'sentry-org-trust-a',
      issue: { id: `sentry-issue-${Date.now()}`, title: 'Test Sentry' },
    };
    const sentryRaw = JSON.stringify(sentryBody);
    const sentrySig = crypto.createHmac('sha256', testSecretSentry).update(sentryRaw).digest('hex');

    const resSentry = await request
      .post('/api/v1/webhooks/sentry')
      .set('Content-Type', 'application/json')
      .set('sentry-hook-resource', `sentry-deliv-${Date.now()}`)
      .set('sentry-hook-signature', sentrySig)
      .send(sentryBody);

    expect(resSentry.status).toBe(200);

    // 12c. Slack valid signature & fresh timestamp
    const slackTs = String(Math.floor(Date.now() / 1000));
    const slackBody = { type: 'event_callback', event: { type: 'app_home_opened' } };
    const slackRaw = JSON.stringify(slackBody);
    const slackSig = `v0=${crypto.createHmac('sha256', testSecretSlack).update(`v0:${slackTs}:${slackRaw}`).digest('hex')}`;

    const resSlack = await request
      .post('/api/v1/webhooks/slack')
      .set('Content-Type', 'application/json')
      .set('x-slack-request-timestamp', slackTs)
      .set('x-slack-signature', slackSig)
      .send(slackBody);

    expect(resSlack.status).toBe(200);

    // 12d. Jira valid secret
    const jiraBody = { webhookEvent: 'jira:issue_updated', issue: { key: 'ENG-999' } };
    const resJira = await request
      .post('/api/v1/webhooks/jira')
      .set('Content-Type', 'application/json')
      .set('x-atlassian-webhook-secret', testSecretJira)
      .send(jiraBody);

    expect(resJira.status).toBe(200);
  });

  // ===========================================================================
  // 13. Webhook replay/idempotency preserved
  // ===========================================================================
  it('13. Webhook replay with duplicate deliveryId is ignored idempotently', async () => {
    const deliveryId = `replay-delivery-${Date.now()}`;
    const body = {
      repository: { full_name: 'org/replay-repo' },
      action: 'opened',
    };
    const rawPayload = JSON.stringify(body);
    const signature = `sha256=${crypto.createHmac('sha256', testSecretGithub).update(rawPayload).digest('hex')}`;

    // First delivery
    const res1 = await request
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .set('x-github-delivery', deliveryId)
      .set('x-github-event', 'issues')
      .send(body);
    expect(res1.status).toBe(200);
    const res1Body = res1.body as { data: { status: string } };
    expect(res1Body.data.status).toBe('processed');

    // Replay identical delivery
    const res2 = await request
      .post('/api/v1/webhooks/github')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .set('x-github-delivery', deliveryId)
      .set('x-github-event', 'issues')
      .send(body);
    expect(res2.status).toBe(200);
    const res2Body = res2.body as { data: { status: string } };
    expect(res2Body.data.status).toBe('duplicate');
  });

  // ===========================================================================
  // 14. CORS rejects attacker .vercel.app and unapproved origins, accepts CLIENT_URL
  // ===========================================================================
  it('14. CORS rejects arbitrary .vercel.app and unapproved origins, accepts CLIENT_URL', async () => {
    // 14a. Attacker on .vercel.app should be rejected (no Access-Control-Allow-Origin header)
    const resAttacker = await request
      .get('/api/v1/health')
      .set('Origin', 'https://attacker-app.vercel.app');
    expect(resAttacker.headers['access-control-allow-origin']).toBeUndefined();

    // 14b. Evil unapproved domain should be rejected
    const resEvil = await request
      .get('/api/v1/health')
      .set('Origin', 'https://evil.com');
    expect(resEvil.headers['access-control-allow-origin']).toBeUndefined();

    // 14c. Approved CLIENT_URL should be accepted
    const resApproved = await request
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');
    expect(resApproved.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
