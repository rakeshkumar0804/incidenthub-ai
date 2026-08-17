import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { signAccessToken } from '../src/utils/jwt';
import { IncidentSeverity, IncidentStatus, IncidentEnvironment, OrgRole } from '@incidenthub/shared';
import type {
  ApiSuccess,
  ApiError,
  IncidentDto,
  IncidentTimelineEventDto,
  ProjectDto,
  ServiceDto,
  PaginatedResponseData,
} from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Incident Management API Endpoints (/api/v1/incidents)', () => {
  let orgAId: string;
  let orgBId: string;

  let ownerAToken: string;
  let responderAToken: string;
  let viewerAToken: string;
  let userBToken: string;

  let userAId: string;
  let responderAId: string;
  let viewerAId: string;

  let projectAId: string;
  let serviceAId: string;
  let projectBId: string;

  let createdIncidentId: string;

  beforeAll(async () => {
    const timestamp = Date.now();

    // 1. Create Org A, User A (Owner)
    const orgA = await prisma.organization.create({
      data: { name: `Inc Org A ${timestamp}`, slug: `inc-org-a-${timestamp}` },
    });
    orgAId = orgA.id;

    const userA = await prisma.user.create({
      data: { name: 'Owner Alice', email: `alice.${timestamp}@test.com` },
    });
    userAId = userA.id;

    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: userAId, role: OrgRole.OWNER },
    });
    ownerAToken = signAccessToken(userAId, userA.email);

    // Create Project A & Service A under Org A
    const projARes = await request
      .post(`/api/v1/organizations/${orgAId}/projects`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        name: 'Payment System',
        description: 'Payment processing platform',
      });
    const projABody = projARes.body as ApiSuccess<ProjectDto>;
    projectAId = projABody.data.id;

    const servARes = await request
      .post(`/api/v1/projects/${projectAId}/services`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({
        name: 'Payment API',
        repositoryUrl: 'https://github.com/org-a/payment-api',
      });
    const servABody = servARes.body as ApiSuccess<ServiceDto>;
    serviceAId = servABody.data.id;

    // 2. Create Org B, User B (Owner)
    const orgB = await prisma.organization.create({
      data: { name: `Inc Org B ${timestamp}`, slug: `inc-org-b-${timestamp}` },
    });
    orgBId = orgB.id;

    const userB = await prisma.user.create({
      data: { name: 'Owner Bob', email: `bob.${timestamp}@test.com` },
    });

    await prisma.organizationMember.create({
      data: { organizationId: orgBId, userId: userB.id, role: OrgRole.OWNER },
    });
    userBToken = signAccessToken(userB.id, userB.email);

    const projBRes = await request
      .post(`/api/v1/organizations/${orgBId}/projects`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({
        name: 'Auth System B',
        description: 'Auth system for Org B',
      });
    const projBBody = projBRes.body as ApiSuccess<ProjectDto>;
    projectBId = projBBody.data.id;

    // 3. Create Responder A & Viewer A in Org A
    const userResp = await prisma.user.create({
      data: { name: 'Responder Rob', email: `rob.${timestamp}@test.com` },
    });
    responderAId = userResp.id;
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: responderAId, role: OrgRole.RESPONDER },
    });
    responderAToken = signAccessToken(responderAId, userResp.email);

    const userView = await prisma.user.create({
      data: { name: 'Viewer Vicky', email: `vicky.${timestamp}@test.com` },
    });
    viewerAId = userView.id;
    await prisma.organizationMember.create({
      data: { organizationId: orgAId, userId: viewerAId, role: OrgRole.VIEWER },
    });
    viewerAToken = signAccessToken(viewerAId, userView.email);
  });

  describe('1. Incident Creation & Validation', () => {
    it('creates a valid incident and generates sequential identifier INC-0001', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          title: 'Database connection pool exhausted',
          description: 'High traffic surge caused Postgres pool overflow',
          projectId: projectAId,
          serviceId: serviceAId,
          severity: IncidentSeverity.SEV2,
          environment: IncidentEnvironment.PRODUCTION,
          assigneeId: responderAId,
        });

      expect(res.status).toBe(201);
      const body = res.body as ApiSuccess<IncidentDto>;
      expect(body.success).toBe(true);
      expect(body.data.number).toBe(1);
      expect(body.data.incidentNumber).toBe('INC-0001');
      expect(body.data.title).toBe('Database connection pool exhausted');
      expect(body.data.status).toBe(IncidentStatus.OPEN);
      expect(body.data.severity).toBe(IncidentSeverity.SEV2);
      expect(body.data.environment).toBe(IncidentEnvironment.PRODUCTION);
      expect(body.data.assignedToId).toBe(responderAId);

      createdIncidentId = body.data.id;
    });

    it('generates sequential numbers safely (INC-0002 for second incident)', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          title: 'High latency on Payment API',
          projectId: projectAId,
          severity: IncidentSeverity.SEV3,
        });

      expect(res.status).toBe(201);
      const body = res.body as ApiSuccess<IncidentDto>;
      expect(body.data.number).toBe(2);
      expect(body.data.incidentNumber).toBe('INC-0002');
    });

    it('handles concurrent incident creation without producing duplicate numbers', async () => {
      const promises = [1, 2, 3].map((i) =>
        request
          .post(`/api/v1/organizations/${orgAId}/incidents`)
          .set('Authorization', `Bearer ${ownerAToken}`)
          .send({
            title: `Concurrent Incident ${i}`,
            projectId: projectAId,
            severity: IncidentSeverity.SEV4,
          }),
      );

      const results = await Promise.all(promises);
      const numbers = results.map((res) => (res.body as ApiSuccess<IncidentDto>).data.number);

      expect(new Set(numbers).size).toBe(3);
    });

    it('rejects incident creation if project belongs to another organization', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          title: 'Malicious Cross-Org Project Incident',
          projectId: projectBId, // Belongs to Org B
          severity: IncidentSeverity.SEV1,
        });

      expect(res.status).toBe(400);
      const body = res.body as ApiError;
      expect(body.success).toBe(false);
      expect(body.error.message).toContain('Selected project does not belong to this organization');
    });

    it('rejects incident creation if assignee is not a member of the organization', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({
          title: 'Invalid Assignee Incident',
          projectId: projectAId,
          assigneeId: 'non-existent-user-id',
        });

      expect(res.status).toBe(400);
      const body = res.body as ApiError;
      expect(body.success).toBe(false);
    });
  });

  describe('2. Lifecycle State Machine & Timestamps', () => {
    it('transitions OPEN -> INVESTIGATING and sets acknowledgedAt timestamp', async () => {
      const res = await request
        .patch(`/api/v1/incidents/${createdIncidentId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.INVESTIGATING });

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentDto>;
      expect(body.data.status).toBe(IncidentStatus.INVESTIGATING);
      expect(body.data.acknowledgedAt).not.toBeNull();
    });

    it('transitions INVESTIGATING -> MITIGATING', async () => {
      const res = await request
        .patch(`/api/v1/incidents/${createdIncidentId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.MITIGATING });

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentDto>;
      expect(body.data.status).toBe(IncidentStatus.MITIGATING);
    });

    it('rejects invalid state transition RESOLVED -> MITIGATING (400 Bad Request)', async () => {
      // First resolve it
      await request
        .patch(`/api/v1/incidents/${createdIncidentId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.RESOLVED });

      // Attempt invalid transition RESOLVED -> MITIGATING
      const res = await request
        .patch(`/api/v1/incidents/${createdIncidentId}/status`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({ status: IncidentStatus.MITIGATING });

      expect(res.status).toBe(400);
      const body = res.body as ApiError;
      expect(body.success).toBe(false);
      expect(body.error.message).toContain('Invalid status transition');
    });
  });

  describe('3. Severity & Assignment Updates', () => {
    it('allows updating severity and logs SEVERITY_CHANGED timeline event', async () => {
      const res = await request
        .patch(`/api/v1/incidents/${createdIncidentId}/severity`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ severity: IncidentSeverity.SEV1 });

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentDto>;
      expect(body.data.severity).toBe(IncidentSeverity.SEV1);
    });

    it('allows reassigning and unassigning incident', async () => {
      // Reassign to Owner Alice
      const res1 = await request
        .patch(`/api/v1/incidents/${createdIncidentId}/assignee`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ assigneeId: userAId });

      expect(res1.status).toBe(200);
      const body1 = res1.body as ApiSuccess<IncidentDto>;
      expect(body1.data.assignedToId).toBe(userAId);

      // Unassign
      const res2 = await request
        .patch(`/api/v1/incidents/${createdIncidentId}/assignee`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ assigneeId: null });

      expect(res2.status).toBe(200);
      const body2 = res2.body as ApiSuccess<IncidentDto>;
      expect(body2.data.assignedToId).toBeNull();
    });
  });

  describe('4. Timeline Events Retrieval', () => {
    it('returns chronological audit timeline events for incident', async () => {
      const res = await request
        .get(`/api/v1/incidents/${createdIncidentId}/timeline`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentTimelineEventDto[]>;
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(4);

      const eventTypes = body.data.map((e) => e.type);
      expect(eventTypes).toContain('INCIDENT_CREATED');
      expect(eventTypes).toContain('STATUS_CHANGED');
      expect(eventTypes).toContain('SEVERITY_CHANGED');
      expect(eventTypes).toContain('ASSIGNEE_CHANGED');
    });
  });

  describe('5. RBAC Enforcement', () => {
    it('allows RESPONDER to create, update status, and assign incidents', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents`)
        .set('Authorization', `Bearer ${responderAToken}`)
        .send({
          title: 'Responder Incident',
          projectId: projectAId,
          severity: IncidentSeverity.SEV4,
        });

      expect(res.status).toBe(201);
    });

    it('REJECTS VIEWER attempts to create or modify incidents (403 Forbidden)', async () => {
      // 1. Create attempt by VIEWER
      const createRes = await request
        .post(`/api/v1/organizations/${orgAId}/incidents`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({
          title: 'Viewer Unauthorized Incident',
          projectId: projectAId,
        });
      expect(createRes.status).toBe(403);

      // 2. Status update attempt by VIEWER
      const updateRes = await request
        .patch(`/api/v1/incidents/${createdIncidentId}/status`)
        .set('Authorization', `Bearer ${viewerAToken}`)
        .send({ status: IncidentStatus.OPEN });
      expect(updateRes.status).toBe(403);
    });

    it('allows VIEWER to read incidents and timelines', async () => {
      const res = await request
        .get(`/api/v1/incidents/${createdIncidentId}`)
        .set('Authorization', `Bearer ${viewerAToken}`);

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentDto>;
      expect(body.data.id).toBe(createdIncidentId);
    });
  });

  describe('6. Cross-Tenant Isolation Enforcement', () => {
    it('REJECTS user from Org B trying to read Org A incident (403 Forbidden)', async () => {
      const res = await request
        .get(`/api/v1/incidents/${createdIncidentId}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(403);
      const body = res.body as ApiError;
      expect(body.success).toBe(false);
    });

    it('REJECTS user from Org B trying to update Org A incident status (403 Forbidden)', async () => {
      const res = await request
        .patch(`/api/v1/incidents/${createdIncidentId}/status`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({ status: IncidentStatus.OPEN });

      expect(res.status).toBe(403);
    });

    it('REJECTS user from Org B trying to access Org A timeline (403 Forbidden)', async () => {
      const res = await request
        .get(`/api/v1/incidents/${createdIncidentId}/timeline`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('7. Search, Filtering, Pagination & Dashboard Metrics', () => {
    it('supports searching by incident number (INC-0001)', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents?search=INC-0001`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentDto[]>;
      expect(body.data.length).toBe(1);
      expect(body.data[0]?.incidentNumber).toBe('INC-0001');
    });

    it('supports searching by title text', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents?search=pool`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentDto[]>;
      expect(body.data.length).toBe(1);
    });

    it('supports pagination metadata (page, pageSize, totalItems, totalPages)', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents?page=1&pageSize=1`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<IncidentDto[]> & { pagination: PaginatedResponseData<IncidentDto>['pagination'] };
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(1);
      expect(body.pagination.totalItems).toBeGreaterThanOrEqual(2);
      expect(body.pagination.totalPages).toBeGreaterThanOrEqual(2);
    });

    it('returns dashboard incident metrics for organization', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/incidents/metrics`)
        .set('Authorization', `Bearer ${ownerAToken}`);

      expect(res.status).toBe(200);
      const body = res.body as ApiSuccess<{
        openCount: number;
        criticalCount: number;
        investigatingCount: number;
        resolvedThisMonthCount: number;
      }>;
      expect(body.data.openCount).toBeDefined();
      expect(body.data.criticalCount).toBeDefined();
      expect(body.data.investigatingCount).toBeDefined();
      expect(body.data.resolvedThisMonthCount).toBeDefined();
    });
  });
});
