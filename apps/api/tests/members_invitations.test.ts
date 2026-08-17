import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { signAccessToken } from '../src/utils/jwt';
import { prisma } from '../src/lib/prisma';
import { OrgRole } from '@incidenthub/shared';
import type { ApiSuccess, ApiError } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Member & Invitation Endpoints', () => {
  let orgId = '';
  let ownerUser: { id: string; email: string };
  let adminUser: { id: string; email: string };
  let viewerUser: { id: string; email: string };

  let ownerToken = '';
  let adminToken = '';
  let viewerToken = '';

  let invitationToken = '';
  let invitationId = '';
  let adminMemberId = '';

  beforeAll(async () => {
    // Create Org
    const org = await prisma.organization.create({
      data: { name: 'Member Test Org', slug: `member-org-${Date.now()}` },
    });
    orgId = org.id;

    // Owner
    ownerUser = await prisma.user.create({
      data: { email: `owner-${Date.now()}@test.com`, name: 'Owner' },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: ownerUser.id, role: OrgRole.OWNER },
    });
    ownerToken = signAccessToken(ownerUser.id, ownerUser.email);

    // Admin
    adminUser = await prisma.user.create({
      data: { email: `admin-${Date.now()}@test.com`, name: 'Admin' },
    });
    const adminMem = await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: adminUser.id, role: OrgRole.ADMIN },
    });
    adminMemberId = adminMem.id;
    adminToken = signAccessToken(adminUser.id, adminUser.email);

    // Viewer
    viewerUser = await prisma.user.create({
      data: { email: `viewer-${Date.now()}@test.com`, name: 'Viewer' },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: viewerUser.id, role: OrgRole.VIEWER },
    });
    viewerToken = signAccessToken(viewerUser.id, viewerUser.email);
  });

  it('1. GET /members — lists organization members', async () => {
    const res = await request
      .get(`/api/v1/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId);

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<Array<{ id: string; role: string }>>;
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(3);
  });

  it('2. POST /invitations — ADMIN CANNOT invite an OWNER (Role Escalation Guard 403)', async () => {
    const res = await request
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-organization-id', orgId)
      .send({ email: 'new-owner@test.com', role: 'OWNER' });

    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('3. POST /invitations — OWNER can invite a new RESPONDER', async () => {
    const inviteEmail = `invited-${Date.now()}@test.com`;
    const res = await request
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ email: inviteEmail, role: 'RESPONDER' });

    expect(res.status).toBe(201);
    const body = res.body as ApiSuccess<{ invitation: { id: string }; inviteUrl?: string; invitationToken?: string }>;
    expect(body.success).toBe(true);
    expect(body.data.invitationToken).toBeUndefined(); // Raw secret token field MUST NOT be exposed in response
    expect(body.data.inviteUrl).toBeDefined(); // Dev invite link URL provided

    invitationId = body.data.invitation.id;
    const inviteUrlStr = body.data.inviteUrl || '';
    const urlObj = new URL(inviteUrlStr);
    invitationToken = urlObj.searchParams.get('token') || '';
    expect(invitationToken).not.toBe('');

    // Verify token is stored as SHA-256 hash in DB, NOT plaintext
    const dbInv = await prisma.invitation.findUnique({ where: { id: invitationId } });
    expect(dbInv?.tokenHash).not.toBe(invitationToken);
    expect(dbInv?.tokenHash).toHaveLength(64); // SHA-256 hex string
  });

  it('3b. GET /invitations/:id/dev-url — retrieves development invitation URL safely', async () => {
    const res = await request
      .get(`/api/v1/organizations/${orgId}/invitations/${invitationId}/dev-url`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId);

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ inviteUrl: string }>;
    expect(body.success).toBe(true);
    expect(body.data.inviteUrl).toContain('/accept-invitation?token=');
    const urlObj = new URL(body.data.inviteUrl);
    invitationToken = urlObj.searchParams.get('token') || '';
    expect(invitationToken).not.toBe('');
  });

  it('4. POST /invitations/:token/accept — accepts invitation token', async () => {
    const dbInv = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (dbInv) {
      await prisma.user.create({
        data: { email: dbInv.email, name: 'Invited User' },
      });
    }

    const res = await request
      .post(`/api/v1/invitations/${invitationToken}/accept`)
      .send({});

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ success: boolean; requiresRegistration: boolean }>;
    expect(body.success).toBe(true);
    expect(body.data.requiresRegistration).toBe(false);
  });

  it('5. POST /invitations/:token/accept — cannot reuse accepted token', async () => {
    const res = await request
      .post(`/api/v1/invitations/${invitationToken}/accept`)
      .send({});

    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('6. PATCH /members/:id — sole OWNER cannot be downgraded (400)', async () => {
    const ownerMember = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId: ownerUser.id },
    });

    const res = await request
      .patch(`/api/v1/organizations/${orgId}/members/${ownerMember?.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('x-organization-id', orgId)
      .send({ role: 'RESPONDER' });

    expect(res.status).toBe(400);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('7. DELETE /members/:id — VIEWER cannot remove members (403)', async () => {
    const res = await request
      .delete(`/api/v1/organizations/${orgId}/members/${adminMemberId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('x-organization-id', orgId);

    expect(res.status).toBe(403);
    const body = res.body as ApiError;
    expect(body.error.code).toBe('FORBIDDEN');
  });
});
