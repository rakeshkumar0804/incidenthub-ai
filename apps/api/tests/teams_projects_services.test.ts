import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { signAccessToken } from '../src/utils/jwt';
import { prisma } from '../src/lib/prisma';
import { OrgRole } from '@incidenthub/shared';
import type { ApiSuccess, ApiError, TeamDto, ProjectDto, ServiceDto } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Teams, Projects & Services API Endpoints', () => {
  let orgAId = '';
  let orgBId = '';
  let userAToken = '';
  let userBToken = '';
  let teamId = '';
  let projectId = '';
  let serviceId = '';

  beforeAll(async () => {
    // Org A
    const orgA = await prisma.organization.create({
      data: { name: 'Org A TPS', slug: `org-a-tps-${Date.now()}` },
    });
    orgAId = orgA.id;

    const userA = await prisma.user.create({
      data: { email: `tps-user-a-${Date.now()}@test.com`, name: 'User A' },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: userA.id, role: OrgRole.OWNER },
    });
    userAToken = signAccessToken(userA.id, userA.email);

    // Org B
    const orgB = await prisma.organization.create({
      data: { name: 'Org B TPS', slug: `org-b-tps-${Date.now()}` },
    });
    orgBId = orgB.id;

    const userB = await prisma.user.create({
      data: { email: `tps-user-b-${Date.now()}@test.com`, name: 'User B' },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgBId, userId: userB.id, role: OrgRole.OWNER },
    });
    userBToken = signAccessToken(userB.id, userB.email);
  });

  it('1. POST /teams — creates team in Org A', async () => {
    const res = await request
      .post(`/api/v1/organizations/${orgAId}/teams`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-organization-id', orgAId)
      .send({ name: 'Backend Engineers', description: 'Core backend team' });

    expect(res.status).toBe(201);
    const body = res.body as ApiSuccess<TeamDto>;
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Backend Engineers');
    teamId = body.data.id;
  });

  it('2. POST /projects — creates project in Org A with optional teamId', async () => {
    const res = await request
      .post(`/api/v1/organizations/${orgAId}/projects`)
      .set('Authorization', `Bearer ${userAToken}`)
      .set('x-organization-id', orgAId)
      .send({
        name: 'Payment API',
        description: 'Processes credit card transactions',
        status: 'ACTIVE',
        teamId,
      });

    expect(res.status).toBe(201);
    const body = res.body as ApiSuccess<ProjectDto>;
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Payment API');
    expect(body.data.status).toBe('ACTIVE');
    expect(body.data.teamId).toBe(teamId);
    projectId = body.data.id;
  });

  it('3. POST /projects/:projectId/services — creates service under project', async () => {
    const res = await request
      .post(`/api/v1/projects/${projectId}/services`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: 'payment-processor',
        description: 'Stripe webhook worker',
      });

    expect(res.status).toBe(201);
    const body = res.body as ApiSuccess<ServiceDto>;
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('payment-processor');
    serviceId = body.data.id;
  });

  it('4. GET /projects/:projectId — User B from Org B CANNOT access Org A project (403)', async () => {
    const res = await request
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('5. GET /teams/:teamId — User B from Org B CANNOT access Org A team (403)', async () => {
    const res = await request
      .get(`/api/v1/teams/${teamId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('6. GET /services/:serviceId — User B from Org B CANNOT access Org A service (403)', async () => {
    const res = await request
      .get(`/api/v1/services/${serviceId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('7. PATCH /projects/:projectId — updates project status to PAUSED', async () => {
    const res = await request
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ status: 'PAUSED' });

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<ProjectDto>;
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('PAUSED');
  });
});
