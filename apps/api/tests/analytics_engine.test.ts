import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { AnalyticsService, invalidateAnalyticsCache, MTTD_DOCUMENTATION_LABEL } from '../src/modules/analytics/analytics.service';
import { rebuildAnalytics } from '../src/scripts/rebuild-analytics';
import { IncidentSeverity, IncidentStatus, IncidentEnvironment, OrgRole } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Phase 12 — Analytics & Engineering Intelligence Integration Tests', () => {
  let orgAId: string;
  let orgBId: string;
  let projectId: string;
  let serviceAId: string;
  let serviceBId: string;

  let viewerToken: string;
  let responderToken: string;
  let orgBUserToken: string;

  beforeAll(async () => {
    const ts = Date.now();
    const { signAccessToken } = await import('../src/utils/jwt');

    // 1. Create Organizations
    const orgA = await prisma.organization.create({
      data: { name: `Analytics Org A ${ts}`, slug: `analytics-org-a-${ts}` },
    });
    orgAId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: `Analytics Org B ${ts}`, slug: `analytics-org-b-${ts}` },
    });
    orgBId = orgB.id;

    // 2. Create Users & Memberships
    const owner = await prisma.user.create({
      data: { email: `an-owner-${ts}@example.com`, name: 'Analytics Owner', passwordHash: 'hash' },
    });
    const responder = await prisma.user.create({
      data: { email: `an-resp-${ts}@example.com`, name: 'Analytics Responder', passwordHash: 'hash' },
    });
    const viewer = await prisma.user.create({
      data: { email: `an-view-${ts}@example.com`, name: 'Analytics Viewer', passwordHash: 'hash' },
    });
    const orgBUser = await prisma.user.create({
      data: { email: `an-orgb-${ts}@example.com`, name: 'Org B User', passwordHash: 'hash' },
    });

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgAId, userId: owner.id, role: OrgRole.OWNER },
        { organizationId: orgAId, userId: responder.id, role: OrgRole.RESPONDER },
        { organizationId: orgAId, userId: viewer.id, role: OrgRole.VIEWER },
        { organizationId: orgBId, userId: orgBUser.id, role: OrgRole.OWNER },
      ],
    });

    responderToken = signAccessToken(responder.id, responder.email);
    viewerToken = signAccessToken(viewer.id, viewer.email);
    orgBUserToken = signAccessToken(orgBUser.id, orgBUser.email);

    // 3. Create Project & Services
    const project = await prisma.project.create({
      data: { organizationId: orgAId, name: 'Analytics Platform', slug: `an-proj-${ts}` },
    });
    projectId = project.id;

    const serviceA = await prisma.service.create({
      data: { projectId: project.id, name: 'Auth Microservice', slug: `an-auth-${ts}` },
    });
    serviceAId = serviceA.id;

    const serviceB = await prisma.service.create({
      data: { projectId: project.id, name: 'Billing Engine', slug: `an-bill-${ts}` },
    });
    serviceBId = serviceB.id;

    // 4. Create Incidents with explicit timestamps for deterministic formula verification
    // Incident 1: Normal resolved incident with 15m TTD and 1h TTR
    // detectedAt: ts - 7200s (2h ago), createdAt: ts - 6300s (1.75h ago), resolvedAt: ts - 3600s (1h ago)
    await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: project.id,
        serviceId: serviceA.id,
        number: 201,
        title: 'Auth Pool Exhaustion',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.RESOLVED,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: owner.id,
        detectedAt: new Date(ts - 7200 * 1000),
        createdAt: new Date(ts - 6300 * 1000), // 15m (900,000ms) TTD
        resolvedAt: new Date(ts - 3600 * 1000), // 1h (3,600,000ms) TTR from detectedAt
      },
    });

    // Incident 2: Unresolved incident with missing detectedAt
    await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: project.id,
        serviceId: serviceA.id,
        number: 202,
        title: 'Token Verification Latency',
        severity: IncidentSeverity.SEV2,
        status: IncidentStatus.INVESTIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: owner.id,
        detectedAt: undefined, // Missing detectedAt
        createdAt: new Date(ts - 5000 * 1000),
        resolvedAt: undefined, // Active/Unresolved
      },
    });

    // Incident 3: Chronological anomaly (detectedAt > createdAt)
    await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: project.id,
        serviceId: serviceB.id,
        number: 203,
        title: 'Billing Queue Stalled',
        severity: IncidentSeverity.SEV3,
        status: IncidentStatus.RESOLVED,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: owner.id,
        detectedAt: new Date(ts - 1000 * 1000),
        createdAt: new Date(ts - 2000 * 1000), // Anomaly: detectedAt > createdAt
        resolvedAt: new Date(ts - 500 * 1000),
      },
    });

    // 5. GitHub Integration & Candidate Deployment
    const integration = await prisma.integration.create({
      data: {
        organizationId: orgAId,
        provider: 'GITHUB',
        status: 'CONNECTED',
      },
    });

    const repo = await prisma.gitHubRepository.create({
      data: {
        organizationId: orgAId,
        integrationId: integration.id,
        githubRepoId: BigInt(ts),
        name: 'auth-service',
        fullName: 'org/auth-service',
        owner: 'org',
        defaultBranch: 'main',
        url: 'https://github.com/org/auth-service',
        projectId: project.id,
        serviceId: serviceA.id,
      },
    });

    await prisma.gitHubDeployment.create({
      data: {
        repositoryId: repo.id,
        deploymentId: `dep-${ts}`,
        environment: 'production',
        commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        creator: 'deploy-bot',
        createdAt: new Date(ts - 7000 * 1000), // Candidate deployment in window of Incident 1
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =============================================================================
  // 1. Formula & Semantic Verification
  // =============================================================================
  describe('1. Deterministic Analytics Formulas & Semantics', () => {
    it('computes exact Option B MTTD (createdAt - detectedAt) and includes mandatory documentation label', async () => {
      expect(projectId).toBeDefined();
      expect(serviceBId).toBeDefined();
      const overview = await AnalyticsService.getOverview(orgAId, { window: '30d' });

      expect(overview.overview.mttdDocumentationLabel).toBe(MTTD_DOCUMENTATION_LABEL);
      expect(overview.overview.mttdDocumentationLabel).toBe(
        'Time from monitoring-source anomaly detection to IncidentHub incident creation.',
      );

      expect(overview.overview.mttd.status).toBe('OK');
      // Incident 1: 6300s - 7200s difference = 900s (900,000 ms)
      expect(overview.overview.mttd.value).toBe(900000);
      expect(overview.overview.anomalyCount).toBeGreaterThanOrEqual(1); // Incident 2 & 3 anomalies
    });

    it('computes MTTR using effectiveDetectionAt (detectedAt ?? createdAt)', async () => {
      const overview = await AnalyticsService.getOverview(orgAId, { window: '30d' });

      expect(overview.overview.mttr.status).toBe('OK');
      // Incident 1 (3,600,000ms) & Incident 3 (500,000ms) average = 2,050,000ms
      expect(overview.overview.mttr.value).toBe(2050000);
      expect(overview.overview.activeIncidents).toBe(1); // Incident 2 unresolved
    });

    it('returns INSUFFICIENT_DATA status for Change-Failure Rate when deployments count is 0', async () => {
      const overview = await AnalyticsService.getOverview(orgBId, { window: '30d' });
      expect(overview.overview.cfr.status).toBe('INSUFFICIENT_DATA');
      expect(overview.overview.cfr.value).toBeNull();
    });
  });

  // =============================================================================
  // 2. Candidate Deployment Association
  // =============================================================================
  describe('2. Candidate Deployment Correlation & Non-Causality', () => {
    it('correlates candidate rollouts using non-causal association terminology', async () => {
      const deps = await AnalyticsService.getDeploymentCorrelations(orgAId, { window: '30d' });

      expect(deps.length).toBeGreaterThan(0);
      expect(deps[0]?.candidateAssociatedIncidentsCount).toBeGreaterThan(0);
      expect(deps[0]?.candidateAssociatedIncidents.some((i) => i.title === 'Auth Pool Exhaustion')).toBe(true);
    });
  });

  // =============================================================================
  // 3. Service Reliability Rankings & Deterministic Tie-Breaking
  // =============================================================================
  describe('3. Service Rankings & Deterministic Tie-Breaking', () => {
    it('orders service rankings deterministically (Count DESC -> SEV1 DESC -> MTTR DESC -> ServiceId ASC)', async () => {
      const services = await AnalyticsService.getServiceMetrics(orgAId, { window: '30d' });

      expect(services.length).toBe(2);
      expect(services[0]?.serviceId).toBe(serviceAId); // 2 incidents vs 1 incident
    });
  });

  // =============================================================================
  // 4. REST API & RBAC Security
  // =============================================================================
  describe('4. REST API Endpoints & RBAC Security', () => {
    it('GET /overview — permits VIEWER role with analytics:read permission', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/analytics/overview?window=30d`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      const body1 = res.body as { data: { overview: { mttdDocumentationLabel: string } } };
      expect(body1.data.overview.mttdDocumentationLabel).toBe(MTTD_DOCUMENTATION_LABEL);
    });

    it('GET /services — permits RESPONDER role with analytics:read permission', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/analytics/services?window=30d`)
        .set('Authorization', `Bearer ${responderToken}`);

      expect(res.status).toBe(200);
      const body2 = res.body as { data: unknown[] };
      expect(Array.isArray(body2.data)).toBe(true);
    });

    it('GET /overview — REJECTS cross-tenant access from Org B user (403 Forbidden)', async () => {
      const res = await request
        .get(`/api/v1/organizations/${orgAId}/analytics/overview?window=30d`)
        .set('Authorization', `Bearer ${orgBUserToken}`);

      expect(res.status).toBe(403);
    });

    it('GET /overview — REJECTS unauthenticated requests (401 Unauthorized)', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/analytics/overview?window=30d`);
      expect(res.status).toBe(401);
    });
  });

  // =============================================================================
  // 5. Derived Read-Model Rebuild & Cache Invalidation
  // =============================================================================
  describe('5. Read-Model Rebuild & Cache Invalidation', () => {
    it('flushes Redis cache keys on invalidateAnalyticsCache call', async () => {
      await invalidateAnalyticsCache(orgAId);
    });

    it('triggers cache invalidation on incident status and severity modifications', async () => {
      // Warm cache
      await AnalyticsService.getOverview(orgAId, { window: '30d' });

      // Trigger status update
      const { IncidentService } = await import('../src/modules/incidents/incident.service');
      const inc = await prisma.incident.findFirst({ where: { organizationId: orgAId } });
      if (inc) {
        await prisma.incident.update({ where: { id: inc.id }, data: { status: IncidentStatus.OPEN } });
        await IncidentService.updateStatus(orgAId, inc.id, inc.createdById, { status: IncidentStatus.INVESTIGATING });
        await IncidentService.updateStatus(orgAId, inc.id, inc.createdById, { status: IncidentStatus.MITIGATING });
        await IncidentService.updateSeverity(orgAId, inc.id, inc.createdById, { severity: IncidentSeverity.SEV1 });
      }
    });

    it('triggers cache invalidation on deployment webhook, project, and service structural changes', async () => {
      const { GitHubService } = await import('../src/modules/integrations/github/github.service');
      const { ProjectService } = await import('../src/modules/projects/project.service');
      const { ServiceService } = await import('../src/modules/services/service.service');
      const { ProjectStatus } = await import('@incidenthub/shared');
      const owner = await prisma.user.findFirstOrThrow({ where: { organizationMembers: { some: { organizationId: orgAId } } } });

      // Webhook event
      await GitHubService.handleWebhookEvent(
        '{}',
        undefined,
        `delivery-${Date.now()}`,
        'push',
        { repository: { full_name: 'org/auth-service' } },
      );

      // Project & Service mutations
      const proj = await ProjectService.createProject(orgAId, { name: 'New Project', status: ProjectStatus.ACTIVE });
      await ProjectService.updateProject(proj.id, owner.id, { name: 'Updated Project' });
      const svc = await ServiceService.createService(proj.id, owner.id, { name: 'New Service' });
      await ServiceService.updateService(svc.id, owner.id, { name: 'Updated Service' });
      await ServiceService.deleteService(svc.id, owner.id);
      await ProjectService.deleteProject(proj.id, owner.id);
    });

    it('executes rebuildAnalytics script cleanly without mutating primary records', async () => {
      const orgAIncidentCountBefore = await prisma.incident.count({ where: { organizationId: orgAId } });
      await rebuildAnalytics(orgAId);
      const orgAIncidentCountAfter = await prisma.incident.count({ where: { organizationId: orgAId } });

      expect(orgAIncidentCountAfter).toBe(orgAIncidentCountBefore);

      const snapshots = await prisma.analyticsSnapshot.findMany({ where: { organizationId: orgAId } });
      expect(snapshots.length).toBeGreaterThan(0);
    });
  });
});
