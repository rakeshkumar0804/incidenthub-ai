import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import type { Request, Response } from 'express';
import supertest from 'supertest';
import { prisma } from '../src/lib/prisma';
import { authenticate, requireAuth, requireOrgMember } from '../src/middleware/auth';
import { requirePermission, ROLE_PERMISSIONS } from '../src/middleware/rbac';
import { signAccessToken } from '../src/utils/jwt';
import { errorHandler } from '../src/middleware/errorHandler';
import { OrgRole } from '@incidenthub/shared';
import type { ApiError } from '@incidenthub/shared';

describe('RBAC & Multi-Tenant Authorization Tests', () => {
  let orgIdA = '';
  let orgIdB = '';

  let ownerToken = '';
  let responderToken = '';
  let viewerToken = '';
  let outsiderToken = '';

  const testApp = express();
  testApp.use(express.json());
  testApp.use((req, res, next) => {
    void authenticate(req, res, next);
  });
  testApp.use(requireAuth);

  // Dummy protected route for incident deletion (requires incidents:delete)
  testApp.delete(
    '/test/orgs/:orgId/incidents/:id',
    (req, res, next) => {
      void requireOrgMember(req, res, next);
    },
    requirePermission('incidents:delete'),
    (_req: Request, res: Response) => {
      res.status(200).json({ success: true, data: { message: 'Incident deleted' } });
    },
  );

  // Dummy protected route for incident creation (requires incidents:create)
  testApp.post(
    '/test/orgs/:orgId/incidents',
    (req, res, next) => {
      void requireOrgMember(req, res, next);
    },
    requirePermission('incidents:create'),
    (_req: Request, res: Response) => {
      res.status(201).json({ success: true, data: { message: 'Incident created' } });
    },
  );

  // Dummy protected route for incident reading (requires incidents:read)
  testApp.get(
    '/test/orgs/:orgId/incidents',
    (req, res, next) => {
      void requireOrgMember(req, res, next);
    },
    requirePermission('incidents:read'),
    (_req: Request, res: Response) => {
      res.status(200).json({ success: true, data: { incidents: [] } });
    },
  );

  testApp.use(errorHandler);
  const testRequest = supertest(testApp);

  beforeAll(async () => {
    // Create Organization A
    const orgA = await prisma.organization.create({
      data: { name: 'Org A', slug: `org-a-${Date.now()}` },
    });
    orgIdA = orgA.id;

    // Create Organization B
    const orgB = await prisma.organization.create({
      data: { name: 'Org B', slug: `org-b-${Date.now()}` },
    });
    orgIdB = orgB.id;

    // Create Owner User in Org A
    const user1 = await prisma.user.create({
      data: { email: `owner-${Date.now()}@test.com`, name: 'Owner User' },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgIdA, userId: user1.id, role: OrgRole.OWNER },
    });
    ownerToken = signAccessToken(user1.id, user1.email);

    // Create Responder User in Org A
    const user2 = await prisma.user.create({
      data: { email: `responder-${Date.now()}@test.com`, name: 'Responder User' },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgIdA, userId: user2.id, role: OrgRole.RESPONDER },
    });
    responderToken = signAccessToken(user2.id, user2.email);

    // Create Viewer User in Org A
    const user3 = await prisma.user.create({
      data: { email: `viewer-${Date.now()}@test.com`, name: 'Viewer User' },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgIdA, userId: user3.id, role: OrgRole.VIEWER },
    });
    viewerToken = signAccessToken(user3.id, user3.email);

    // Create Outsider User (Only in Org B)
    const user4 = await prisma.user.create({
      data: { email: `outsider-${Date.now()}@test.com`, name: 'Outsider User' },
    });
    await prisma.organizationMember.create({
      data: { organizationId: orgIdB, userId: user4.id, role: OrgRole.OWNER },
    });
    outsiderToken = signAccessToken(user4.id, user4.email);
  });

  describe('Role-Based Access Control Matrix Integrity', () => {
    it('OWNER has all permissions including deletion and member management', () => {
      expect(ROLE_PERMISSIONS.OWNER).toContain('incidents:delete');
      expect(ROLE_PERMISSIONS.OWNER).toContain('members:manage');
    });

    it('RESPONDER has incidents:create, update, comment, assign, but NOT incidents:delete or members:manage', () => {
      expect(ROLE_PERMISSIONS.RESPONDER).toContain('incidents:create');
      expect(ROLE_PERMISSIONS.RESPONDER).toContain('incidents:update');
      expect(ROLE_PERMISSIONS.RESPONDER).not.toContain('incidents:delete');
      expect(ROLE_PERMISSIONS.RESPONDER).not.toContain('members:manage');
    });

    it('VIEWER has only read permissions', () => {
      expect(ROLE_PERMISSIONS.VIEWER).toContain('incidents:read');
      expect(ROLE_PERMISSIONS.VIEWER).not.toContain('incidents:create');
      expect(ROLE_PERMISSIONS.VIEWER).not.toContain('incidents:update');
      expect(ROLE_PERMISSIONS.VIEWER).not.toContain('incidents:delete');
    });
  });

  describe('Server-Side Middleware Permission & Tenant Isolation Verification', () => {
    it('1. OWNER can delete incidents in Org A', async () => {
      const res = await testRequest
        .delete(`/test/orgs/${orgIdA}/incidents/inc-1`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(res.status).toBe(200);
    });

    it('2. RESPONDER can create incidents in Org A', async () => {
      const res = await testRequest
        .post(`/test/orgs/${orgIdA}/incidents`)
        .set('Authorization', `Bearer ${responderToken}`)
        .send({ title: 'New SEV-2' });
      expect(res.status).toBe(201);
    });

    it('3. RESPONDER CANNOT delete incidents in Org A (403 Forbidden)', async () => {
      const res = await testRequest
        .delete(`/test/orgs/${orgIdA}/incidents/inc-1`)
        .set('Authorization', `Bearer ${responderToken}`);
      expect(res.status).toBe(403);
      const body = res.body as ApiError;
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('4. VIEWER can read incidents in Org A', async () => {
      const res = await testRequest
        .get(`/test/orgs/${orgIdA}/incidents`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
    });

    it('5. VIEWER CANNOT create incidents in Org A (403 Forbidden)', async () => {
      const res = await testRequest
        .post(`/test/orgs/${orgIdA}/incidents`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Unauthorized Incident' });
      expect(res.status).toBe(403);
      const body = res.body as ApiError;
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('6. Outsider (member of Org B) CANNOT access Org A resources (Cross-Tenant Rejection 403)', async () => {
      const res = await testRequest
        .get(`/test/orgs/${orgIdA}/incidents`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
      const body = res.body as ApiError;
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('Access denied');
    });
  });
});
