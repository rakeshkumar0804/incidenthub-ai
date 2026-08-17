import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { signAccessToken } from '../src/utils/jwt';
import { prisma } from '../src/lib/prisma';
import { OrgRole } from '@incidenthub/shared';
import type { ApiSuccess, ApiError, OrganizationDto } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Organization API Endpoints (/api/v1/organizations)', () => {
  let userAId = '';
  let userBId = '';
  let tokenA = '';
  let tokenB = '';
  let orgAId = '';
  let orgASlug = '';
  let orgBId = '';

  beforeAll(async () => {
    // Create User A
    const userA = await prisma.user.create({
      data: { email: `org-owner-${Date.now()}@example.com`, name: 'Org Owner A' },
    });
    userAId = userA.id;
    tokenA = signAccessToken(userA.id, userA.email);

    // Create User B
    const userB = await prisma.user.create({
      data: { email: `org-outsider-${Date.now()}@example.com`, name: 'Outsider B' },
    });
    userBId = userB.id;
    tokenB = signAccessToken(userB.id, userB.email);

    // Create Org B for User B
    const orgB = await prisma.organization.create({
      data: { name: 'Org B', slug: `org-b-${Date.now()}` },
    });
    orgBId = orgB.id;
    await prisma.organizationMember.create({
      data: { organizationId: orgBId, userId: userBId, role: OrgRole.OWNER },
    });
  });

  it('1. POST /api/v1/organizations — creates org and sets user as OWNER', async () => {
    expect(userAId).toBeDefined();
    const res = await request
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Acme Corp' });

    expect(res.status).toBe(201);
    const body = res.body as ApiSuccess<{ organization: OrganizationDto; role: string }>;
    expect(body.success).toBe(true);
    expect(body.data.organization.name).toBe('Acme Corp');
    expect(body.data.role).toBe('OWNER');

    orgAId = body.data.organization.id;
    orgASlug = body.data.organization.slug;
  });

  it('2. GET /api/v1/organizations — lists user’s organizations', async () => {
    const res = await request
      .get('/api/v1/organizations')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<Array<{ id: string; name: string }>>;
    expect(body.success).toBe(true);
    expect(body.data.some((o) => o.id === orgAId)).toBe(true);
  });

  it('3. GET /api/v1/organizations/:id — returns org details with counts', async () => {
    const res = await request
      .get(`/api/v1/organizations/${orgAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('x-organization-id', orgAId);

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ id: string; memberCount: number }>;
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(orgAId);
    expect(body.data.memberCount).toBe(1);
  });

  it('4. GET /api/v1/organizations/:id — rejects cross-tenant access from non-member (403)', async () => {
    const res = await request
      .get(`/api/v1/organizations/${orgAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .set('x-organization-id', orgAId);

    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('5. PATCH /api/v1/organizations/:id — updates name & logo', async () => {
    const res = await request
      .patch(`/api/v1/organizations/${orgAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('x-organization-id', orgAId)
      .send({ name: 'Acme Corp Updated' });

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ name: string }>;
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Acme Corp Updated');
  });

  it('6. DELETE /api/v1/organizations/:id — fails if slug confirmation mismatches', async () => {
    const res = await request
      .delete(`/api/v1/organizations/${orgAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('x-organization-id', orgAId)
      .send({ confirmSlug: 'wrong-slug' });

    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('7. DELETE /api/v1/organizations/:id — succeeds with valid slug confirmation', async () => {
    const res = await request
      .delete(`/api/v1/organizations/${orgAId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('x-organization-id', orgAId)
      .send({ confirmSlug: orgASlug });

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ message: string }>;
    expect(body.success).toBe(true);

    const deletedOrg = await prisma.organization.findUnique({ where: { id: orgAId } });
    expect(deletedOrg).toBeNull();
  });
});
