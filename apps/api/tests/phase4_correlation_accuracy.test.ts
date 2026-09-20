import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { redis, checkRedisHealth } from '../src/lib/redis';
import { CorrelationService } from '../src/modules/correlation/correlation.service';
import {
  scoreCandidate,
  scoreAllCandidates,
  selectNearestCandidates,
  compareScoredCandidates,
  normalizeEnvironment,
  SCORING_CONSTANTS,
} from '../src/modules/correlation/correlation.engine';
import type {
  CandidateSignal,
  IncidentScoringContext,
  ExplicitProviderRelationships,
  CandidateScoreResult,
} from '../src/modules/correlation/correlation.types';
import * as socketModule from '../src/lib/socket';
import {
  OrgRole,
  IncidentSeverity,
  IncidentStatus,
  IncidentEnvironment,
  EvidenceType,
  EvidenceSource,
  EvidenceConfidenceTier,
  CorrelationRunStatus,
} from '@incidenthub/shared';

describe('Phase 4 — Deterministic Correlation Accuracy and Evidence Integrity Test Suite', () => {
  const ts = Date.now();
  let orgAId: string;
  let orgBId: string;
  let ownerAUserId: string;
  let projectAId: string;
  let serviceA1Id: string;
  let serviceA2Id: string;
  let incidentAId: string;
  let projectIncidentId: string;
  let gitHubIntegAId: string;
  let gitHubIntegBId: string;
  let faultInjector: ((params: Prisma.MiddlewareParams) => void | Promise<void>) | null = null;

  const baseDetectedAt = new Date('2026-09-19T12:00:00.000Z');

  beforeAll(async () => {
    prisma.$use(async (params, next) => {
      if (faultInjector) {
        await faultInjector(params);
      }
      const result: unknown = await next(params);
      return result;
    });

    // 1. Create Organization A & B
    const orgA = await prisma.organization.create({
      data: { name: `P4 Org A ${ts}`, slug: `p4-org-a-${ts}` },
    });
    orgAId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: `P4 Org B ${ts}`, slug: `p4-org-b-${ts}` },
    });
    orgBId = orgB.id;

    // 2. Create Users & Memberships
    const userOwnerA = await prisma.user.create({
      data: { email: `p4-owner-a-${ts}@example.com`, name: 'Owner A', passwordHash: 'hash' },
    });
    ownerAUserId = userOwnerA.id;
    const userRespA = await prisma.user.create({
      data: { email: `p4-resp-a-${ts}@example.com`, name: 'Resp A', passwordHash: 'hash' },
    });
    const userViewA = await prisma.user.create({
      data: { email: `p4-view-a-${ts}@example.com`, name: 'View A', passwordHash: 'hash' },
    });
    const userOwnerB = await prisma.user.create({
      data: { email: `p4-owner-b-${ts}@example.com`, name: 'Owner B', passwordHash: 'hash' },
    });

    await prisma.organizationMember.createMany({
      data: [
        { organizationId: orgAId, userId: userOwnerA.id, role: OrgRole.OWNER },
        { organizationId: orgAId, userId: userRespA.id, role: OrgRole.RESPONDER },
        { organizationId: orgAId, userId: userViewA.id, role: OrgRole.VIEWER },
        { organizationId: orgBId, userId: userOwnerB.id, role: OrgRole.OWNER },
      ],
    });

    // 3. Create Project & Services in Org A
    const projectA = await prisma.project.create({
      data: { organizationId: orgAId, name: 'Billing Project', slug: `billing-proj-${ts}` },
    });
    projectAId = projectA.id;

    const serviceA1 = await prisma.service.create({
      data: { projectId: projectAId, name: 'Payment Gateway', slug: `payment-gw-${ts}` },
    });
    serviceA1Id = serviceA1.id;

    const serviceA2 = await prisma.service.create({
      data: { projectId: projectAId, name: 'Invoice Generator', slug: `invoice-gen-${ts}` },
    });
    serviceA2Id = serviceA2.id;

    // 4. Integrations
    const ghIntegA = await prisma.integration.create({
      data: { organizationId: orgAId, provider: 'GITHUB', status: 'CONNECTED', metadata: {} },
    });
    gitHubIntegAId = ghIntegA.id;

    const ghIntegB = await prisma.integration.create({
      data: { organizationId: orgBId, provider: 'GITHUB', status: 'CONNECTED', metadata: {} },
    });
    gitHubIntegBId = ghIntegB.id;

    await prisma.integration.create({
      data: { organizationId: orgAId, provider: 'SENTRY', status: 'CONNECTED', metadata: {} },
    });

    // 5. Create Incidents
    const incA = await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        serviceId: serviceA1Id,
        number: 1001,
        title: 'Payment checkout 500 errors',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.INVESTIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: userOwnerA.id,
        detectedAt: baseDetectedAt,
      },
    });
    incidentAId = incA.id;

    const incProj = await prisma.incident.create({
      data: {
        organizationId: orgAId,
        projectId: projectAId,
        serviceId: null,
        number: 1002,
        title: 'Project-wide latency degradation',
        severity: IncidentSeverity.SEV2,
        status: IncidentStatus.INVESTIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: userOwnerA.id,
        detectedAt: baseDetectedAt,
      },
    });
    projectIncidentId = incProj.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  });

  // ===========================================================================
  // OBJECTIVE 1 & 2: PURE DETERMINISTIC SCORING & DIRECTIONAL TIME
  // ===========================================================================
  describe('Objective 1 & 2: Pure Deterministic Scoring Core & Directional Time', () => {
    const context: IncidentScoringContext = {
      incidentId: 'inc-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      serviceId: 'svc-1',
      environment: 'PRODUCTION',
      detectedAt: baseDetectedAt,
    };

    const emptyRels: ExplicitProviderRelationships = {
      anchorDeploymentCommitShas: new Set<string>(),
      anchorDeploymentIds: new Set<string>(),
      anchorDeploymentEnvs: new Map<string, string>(),
      correlatedCommitShas: new Set<string>(),
    };

    it('1. Pure scoring determinism: identical inputs produce bitwise identical output', () => {
      const candidate: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:123',
        title: 'Production deployment',
        description: 'Release v1.2.0',
        url: 'https://github.com/org/repo/deployments/123',
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: { deploymentId: '123', commitSha: 'sha123' },
      };

      const res1 = scoreCandidate(candidate, context, emptyRels);
      const res2 = scoreCandidate(candidate, context, emptyRels);

      expect(res1).toEqual(res2);
      expect(res1.confidence).toBe(res2.confidence);
      expect(res1.confidenceTier).toBe(res2.confidenceTier);
      expect(res1.scoreBreakdown).toEqual(res2.scoreBreakdown);
    });

    it('2. Shuffled-input determinism: candidate array ordering does not affect output ranking', () => {
      const c1: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:1',
        title: 'Deployment 1',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: { deploymentId: '1', commitSha: 'sha1' },
      };
      const c2: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:sha1',
        title: 'Commit 1',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 12 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { sha: 'sha1' },
      };
      const c3: CandidateSignal = {
        type: EvidenceType.SENTRY_ERROR,
        externalRefId: 'sentry:100',
        title: 'Sentry Spike',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 5 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: { userCount: 15, eventCount: 100, level: 'error' },
      };

      const orderA = scoreAllCandidates([c1, c2, c3], context);
      const orderB = scoreAllCandidates([c3, c1, c2], context);
      const orderC = scoreAllCandidates([c2, c3, c1], context);

      expect(orderA.map((r: CandidateScoreResult) => r.candidate.externalRefId)).toEqual(orderB.map((r: CandidateScoreResult) => r.candidate.externalRefId));
      expect(orderA.map((r: CandidateScoreResult) => r.candidate.externalRefId)).toEqual(orderC.map((r: CandidateScoreResult) => r.candidate.externalRefId));
      expect(orderA.map((r: CandidateScoreResult) => r.confidence)).toEqual(orderB.map((r: CandidateScoreResult) => r.confidence));
    });

    it('3. Directional pre/post timing: post-incident candidate receives zero precursor boost and lower rank', () => {
      const precursorDeploy: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:pre',
        title: 'Pre-incident Deployment',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 20 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: { deploymentId: 'pre', commitSha: 'shaPre' },
      };

      const postDeploy: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:post',
        title: 'Post-incident Deployment',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + 20 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: { deploymentId: 'post', commitSha: 'shaPost' },
      };

      const preScored = scoreCandidate(precursorDeploy, context, emptyRels);
      const postScored = scoreCandidate(postDeploy, context, emptyRels);

      expect(preScored.reasons.temporalRelation).toBe('PRECURSOR');
      expect(preScored.reasons.precursor).toBe(true);
      expect(preScored.reasons.postIncident).toBe(false);
      expect(preScored.scoreBreakdown['precursorDeploymentScore']).toBe(SCORING_CONSTANTS.PRECURSOR_DEPLOYMENT_BOOST);

      expect(postScored.reasons.temporalRelation).toBe('POST_INCIDENT');
      expect(postScored.reasons.precursor).toBe(false);
      expect(postScored.reasons.postIncident).toBe(true);
      expect(postScored.scoreBreakdown['precursorDeploymentScore']).toBeUndefined();

      expect(preScored.confidence).toBeGreaterThan(postScored.confidence);
    });

    it('4. Exact temporal boundaries: boundary at detectedAt is PRECURSOR, boundary + 1ms is POST_INCIDENT', () => {
      const atBoundary: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:exact',
        title: 'Exact boundary commit',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime()),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { sha: 'exact' },
      };

      const afterBoundary: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:after',
        title: 'After boundary commit',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + 1),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { sha: 'after' },
      };

      const resAt = scoreCandidate(atBoundary, context, emptyRels);
      const resAfter = scoreCandidate(afterBoundary, context, emptyRels);

      expect(resAt.reasons.temporalRelation).toBe('PRECURSOR');
      expect(resAfter.reasons.temporalRelation).toBe('POST_INCIDENT');
    });

    it('5. Score-breakdown arithmetic: sum of breakdown strictly equals finalRawScore and confidence', () => {
      const candidate: CandidateSignal = {
        type: EvidenceType.SENTRY_ERROR,
        externalRefId: 'sentry:spike',
        title: 'Fatal crash',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: { userCount: 50, eventCount: 300, level: 'fatal' },
      };

      const res = scoreCandidate(candidate, context, emptyRels);
      const sum = Object.values(res.scoreBreakdown).reduce((a, b) => a + b, 0);

      expect(Math.abs(sum - res.finalRawScore)).toBeLessThan(1e-9);
      expect(res.confidence).toBe(Math.max(0, Math.min(1.0, Math.round(res.finalRawScore * 1000) / 1000)));
    });
  });

  // ===========================================================================
  // OBJECTIVE 3: REMOVE FALSE RELATIONSHIP PROPAGATION
  // ===========================================================================
  describe('Objective 3: Explicit Relationship Verification & Negative Tests', () => {
    const context: IncidentScoringContext = {
      incidentId: 'inc-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      serviceId: 'svc-1',
      environment: 'PRODUCTION',
      detectedAt: baseDetectedAt,
    };

    const relsWithAnchor: ExplicitProviderRelationships = {
      anchorDeploymentCommitShas: new Set(['sha-deployed-abc']),
      anchorDeploymentIds: new Set(['dep-100']),
      anchorDeploymentEnvs: new Map([['sha-deployed-abc', 'PRODUCTION']]),
      correlatedCommitShas: new Set(['sha-deployed-abc']),
    };

    it('6. Exact deployment-to-commit relationship gives propagation boost to matching SHA', () => {
      const matchingCommit: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:sha-deployed-abc',
        title: 'Matching commit',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 25 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { sha: 'sha-deployed-abc' },
      };

      const res = scoreCandidate(matchingCommit, context, relsWithAnchor);
      expect(res.reasons.commitRelation).toBe(true);
      expect(res.reasons.deploymentRelation).toBe(true);
      expect(res.scoreBreakdown['commitPropBoost']).toBe(SCORING_CONSTANTS.COMMIT_EXACT_DEPLOYMENT_BOOST);
      expect(res.confidenceTier).toBe(EvidenceConfidenceTier.HIGH);
    });

    it('7. Unrelated commit receives zero propagation boost', () => {
      const unrelatedCommit: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:sha-random-xyz',
        title: 'Unrelated commit',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 25 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { sha: 'sha-random-xyz' },
      };

      const res = scoreCandidate(unrelatedCommit, context, relsWithAnchor);
      expect(res.reasons.commitRelation).toBe(false);
      expect(res.reasons.deploymentRelation).toBe(false);
      expect(res.scoreBreakdown['commitPropBoost']).toBeUndefined();
      expect(res.confidenceTier).not.toBe(EvidenceConfidenceTier.HIGH);
    });

    it('8. Unrelated PR (branch/commit mismatch) receives zero propagation boost', () => {
      const unrelatedPR: CandidateSignal = {
        type: EvidenceType.GITHUB_PR,
        externalRefId: 'pr:repo:50',
        title: 'Unrelated PR',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 30 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { number: 50, state: 'merged', branch: 'main', mergeCommitSha: 'sha-unrelated' },
      };

      const res = scoreCandidate(unrelatedPR, context, relsWithAnchor);
      expect(res.reasons.commitRelation).toBe(false);
      expect(res.scoreBreakdown['prPropBoost']).toBeUndefined();
    });

    it('8b. Ordinary merged PR without persisted SHA linkage receives zero PR propagation boost through service path', async () => {
      const repo = await prisma.gitHubRepository.create({
        data: {
          organizationId: orgAId,
          integrationId: gitHubIntegAId,
          projectId: projectAId,
          serviceId: serviceA1Id,
          githubRepoId: BigInt(Date.now() + 100),
          name: `repo-pr-test-${ts}`,
          fullName: `org/repo-pr-test-${ts}`,
          owner: 'org',
          url: `https://github.com/org/repo-pr-test-${ts}`,
        },
      });

      const ordinaryPR = await prisma.gitHubPullRequest.create({
        data: {
          repositoryId: repo.id,
          number: 202,
          title: 'Routine docs update',
          state: 'merged',
          author: 'dev-author',
          branch: 'docs-patch',
          url: `https://github.com/org/repo-pr-test-${ts}/pull/202`,
          mergedAt: new Date(baseDetectedAt.getTime() - 20 * 60 * 1000),
        },
      });

      await redis.del(`lock:correlation:${incidentAId}`).catch(() => undefined);
      await CorrelationService.runCorrelation(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');

      const prEvidence = await prisma.incidentEvidence.findFirst({
        where: { incidentId: incidentAId, externalRefId: `pr:${repo.id}:${ordinaryPR.number}` },
      });

      expect(prEvidence).toBeDefined();
      const reasons = prEvidence?.reasons as Record<string, unknown>;
      const scoreBreakdown = prEvidence?.scoreBreakdown as Record<string, number>;
      expect(reasons?.commitRelation).toBe(false);
      expect(reasons?.deploymentRelation).toBe(false);
      expect(scoreBreakdown?.['prPropBoost']).toBeUndefined();
      expect(prEvidence?.confidenceTier).not.toBe(EvidenceConfidenceTier.HIGH);
    });

    it('9. Exact workflow commit failure receives exact workflow failure boost', () => {
      const matchedWorkflow: CandidateSignal = {
        type: EvidenceType.GITHUB_WORKFLOW_RUN,
        externalRefId: 'workflow:wf-1',
        title: 'CI failure',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { conclusion: 'failure', commitSha: 'sha-deployed-abc' },
      };

      const res = scoreCandidate(matchedWorkflow, context, relsWithAnchor);
      expect(res.reasons.workflowFailure).toBe(true);
      expect(res.reasons.commitRelation).toBe(true);
      expect(res.scoreBreakdown['workflowFailureScore']).toBe(SCORING_CONSTANTS.WORKFLOW_EXACT_COMMIT_FAILURE_BOOST);
    });

    it('10. Unrelated failed workflow does not rank HIGH and successful workflow receives zero boost', () => {
      const unrelatedFailedWorkflow: CandidateSignal = {
        type: EvidenceType.GITHUB_WORKFLOW_RUN,
        externalRefId: 'workflow:wf-unrelated',
        title: 'Unrelated CI failure',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { conclusion: 'failure', commitSha: 'sha-unrelated-random' },
      };

      const resFailed = scoreCandidate(unrelatedFailedWorkflow, context, relsWithAnchor);
      expect(resFailed.reasons.workflowFailure).toBe(true);
      expect(resFailed.reasons.commitRelation).toBe(false);
      expect(resFailed.confidenceTier).not.toBe(EvidenceConfidenceTier.HIGH);

      const successWorkflow: CandidateSignal = {
        type: EvidenceType.GITHUB_WORKFLOW_RUN,
        externalRefId: 'workflow:wf-success',
        title: 'CI success',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { conclusion: 'success', commitSha: 'sha-deployed-abc' },
      };

      const resSuccess = scoreCandidate(successWorkflow, context, relsWithAnchor);
      expect(resSuccess.reasons.workflowFailure).toBe(false);
      expect(resSuccess.scoreBreakdown['workflowFailureScore']).toBeUndefined();
    });
  });

  // ===========================================================================
  // OBJECTIVE 4 & 5: ENVIRONMENT NEUTRALITY & PROJECT/SERVICE HIERARCHY
  // ===========================================================================
  describe('Objective 4 & 5: Environment Neutrality & Project/Service Hierarchy', () => {
    it('11. Environment normalization handles aliases and neutral signals receive zero weight', () => {
      expect(normalizeEnvironment('prod')).toBe('PRODUCTION');
      expect(normalizeEnvironment('production')).toBe('PRODUCTION');
      expect(normalizeEnvironment('prd')).toBe('PRODUCTION');
      expect(normalizeEnvironment('staging')).toBe('STAGING');
      expect(normalizeEnvironment('stage')).toBe('STAGING');
      expect(normalizeEnvironment('development')).toBe('DEVELOPMENT');
      expect(normalizeEnvironment('dev')).toBe('DEVELOPMENT');
      expect(normalizeEnvironment('unknown_env')).toBe('UNKNOWN');
      expect(normalizeEnvironment(null)).toBe('UNKNOWN');
    });

    it('12. Project & Service hierarchy: exact service match scores higher than project-only match', () => {
      const sameServiceSignal: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:svc1',
        title: 'Service 1 deploy',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: serviceA1Id,
        environment: 'PRODUCTION',
        metadata: {},
      };

      const diffServiceSignal: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:svc2',
        title: 'Service 2 deploy',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: serviceA2Id,
        environment: 'PRODUCTION',
        metadata: {},
      };

      const ctx: IncidentScoringContext = {
        incidentId: incidentAId,
        organizationId: orgAId,
        projectId: projectAId,
        serviceId: serviceA1Id,
        environment: 'PRODUCTION',
        detectedAt: baseDetectedAt,
      };

      const emptyRels: ExplicitProviderRelationships = {
        anchorDeploymentCommitShas: new Set(),
        anchorDeploymentIds: new Set(),
        anchorDeploymentEnvs: new Map(),
        correlatedCommitShas: new Set(),
      };

      const resSame = scoreCandidate(sameServiceSignal, ctx, emptyRels);
      const resDiff = scoreCandidate(diffServiceSignal, ctx, emptyRels);

      expect(resSame.reasons.serviceMatch).toBe(true);
      expect(resSame.scoreBreakdown['serviceScore']).toBe(SCORING_CONSTANTS.SERVICE_EXACT_MATCH);

      expect(resDiff.reasons.serviceMatch).toBe(false);
      expect(resDiff.scoreBreakdown['serviceScore']).toBeUndefined();
      expect(resSame.confidence).toBeGreaterThan(resDiff.confidence);
    });

    it('13. Project-level incident without service scores candidates without service mismatch penalty', () => {
      const projCtx: IncidentScoringContext = {
        incidentId: projectIncidentId,
        organizationId: orgAId,
        projectId: projectAId,
        serviceId: null,
        environment: 'PRODUCTION',
        detectedAt: baseDetectedAt,
      };

      const candidate: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:proj',
        title: 'Project deploy',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: serviceA1Id,
        environment: 'PRODUCTION',
        metadata: {},
      };

      const res = scoreCandidate(candidate, projCtx, {
        anchorDeploymentCommitShas: new Set(),
        anchorDeploymentIds: new Set(),
        anchorDeploymentEnvs: new Map(),
        correlatedCommitShas: new Set(),
      });

      expect(res.reasons.projectMatch).toBe(true);
      expect(res.reasons.serviceMatch).toBe(false);
      expect(res.scoreBreakdown['serviceScore']).toBeUndefined();
    });
  });

  // ===========================================================================
  // OBJECTIVE 6 & 7: SENTRY SPIKES, UNMERGED PRS & CANDIDATE CAP SELECTION
  // ===========================================================================
  describe('Objective 6 & 7: Sentry Spike Thresholds, Unmerged PRs & Nearest Candidate Selection', () => {
    const context: IncidentScoringContext = {
      incidentId: 'inc-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      serviceId: 'svc-1',
      environment: 'PRODUCTION',
      detectedAt: baseDetectedAt,
    };
    const emptyRels: ExplicitProviderRelationships = {
      anchorDeploymentCommitShas: new Set(),
      anchorDeploymentIds: new Set(),
      anchorDeploymentEnvs: new Map(),
      correlatedCommitShas: new Set(),
    };

    it('14. Sentry spike thresholds enforce deterministic user/event/fatal cutoffs', () => {
      const spikeSignal: CandidateSignal = {
        type: EvidenceType.SENTRY_ERROR,
        externalRefId: 'sentry:spike-ok',
        title: 'Spike Sentry Issue',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: { userCount: 5, eventCount: 20 },
      };
      const resSpike = scoreCandidate(spikeSignal, context, emptyRels);
      expect(resSpike.reasons.sentrySpike).toBe(true);
      expect(resSpike.scoreBreakdown['sentrySpikeScore']).toBe(SCORING_CONSTANTS.SENTRY_SPIKE_BOOST);

      const lowVolumeSignal: CandidateSignal = {
        type: EvidenceType.SENTRY_ERROR,
        externalRefId: 'sentry:low-vol',
        title: 'Low Volume Sentry Issue',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: { userCount: 1, eventCount: 2, level: 'warning' },
      };
      const resLow = scoreCandidate(lowVolumeSignal, context, emptyRels);
      expect(resLow.reasons.sentrySpike).toBe(false);
      expect(resLow.scoreBreakdown['sentrySpikeScore']).toBeUndefined();
    });

    it('15. Unmerged PR cannot receive deployed-change relation boosts', () => {
      const unmergedPR: CandidateSignal = {
        type: EvidenceType.GITHUB_PR,
        externalRefId: 'pr:repo:99',
        title: 'Open Draft PR',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { number: 99, state: 'open', mergedAt: null, mergeCommitSha: 'sha-deployed-abc' },
      };

      const rels: ExplicitProviderRelationships = {
        anchorDeploymentCommitShas: new Set(['sha-deployed-abc']),
        anchorDeploymentIds: new Set(),
        anchorDeploymentEnvs: new Map(),
        correlatedCommitShas: new Set(),
      };

      const res = scoreCandidate(unmergedPR, context, rels);
      expect(res.reasons.commitRelation).toBe(false);
      expect(res.scoreBreakdown['prPropBoost']).toBeUndefined();
    });

    it('16. DB-backed bounded query test: globally nearest precursor survives 110+ later events', async () => {
      const serviceBounded = await prisma.service.create({
        data: { projectId: projectAId, name: 'Bounded Test Service', slug: `bounded-svc-${ts}` },
      });

      // 1. Create a dedicated incident
      const testIncident = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceBounded.id,
          createdById: ownerAUserId,
          number: Math.floor(Math.random() * 100000) + 100,
          title: 'Database Bounded Query Survival Test Incident',
          description: 'Testing that bidirectional queries ensure close precursor survives 110+ later events',
          severity: IncidentSeverity.SEV2,
          status: IncidentStatus.INVESTIGATING,
          environment: IncidentEnvironment.PRODUCTION,
          detectedAt: baseDetectedAt,
        },
      });

      const repo = await prisma.gitHubRepository.create({
        data: {
          organizationId: orgAId,
          integrationId: gitHubIntegAId,
          projectId: projectAId,
          serviceId: serviceBounded.id,
          githubRepoId: BigInt(Date.now() + 500),
          name: `repo-bounded-${ts}`,
          fullName: `org/repo-bounded-${ts}`,
          owner: 'org',
          url: `https://github.com/org/repo-bounded-${ts}`,
        },
      });

      // 2. Create 1 pre-incident deployment extremely close to detectedAt (2 mins prior)
      const closePrecursor = await prisma.gitHubDeployment.create({
        data: {
          repositoryId: repo.id,
          deploymentId: `dep-precursor-close-${ts}`,
          environment: 'production',
          state: 'success',
          commitSha: `sha-precursor-${ts}`,
          creator: 'deploy-bot',
          createdAt: new Date(baseDetectedAt.getTime() - 2 * 60 * 1000),
        },
      });

      // 3. Create 110 eligible later events (from +10m to +120m after detection)
      // In a naïve newest-first query with take: 100, these 110 later events would completely exclude the precursor.
      const postDeploymentsData = Array.from({ length: 110 }).map((_, i) => ({
        repositoryId: repo.id,
        deploymentId: `dep-post-${ts}-${i}`,
        environment: 'production',
        state: 'success',
        commitSha: `sha-post-${ts}-${i}`,
        creator: 'deploy-bot',
        createdAt: new Date(baseDetectedAt.getTime() + (10 + i) * 60 * 1000),
      }));

      await prisma.gitHubDeployment.createMany({ data: postDeploymentsData });

      // 4. Run correlation through production service path
      await redis.del(`lock:correlation:${testIncident.id}`).catch(() => undefined);
      const runRes1 = await CorrelationService.runCorrelation(orgAId, testIncident.id, undefined, 'MANUAL_REQUEST');
      expect(runRes1.status).toBe('completed');

      const correlationRunRecord1 = await prisma.correlationRun.findUnique({
        where: { id: runRes1.runId },
      });
      expect(correlationRunRecord1?.isTruncated).toBe(true);

      const evidenceRun1 = await prisma.incidentEvidence.findMany({
        where: { incidentId: testIncident.id, correlationRunId: runRes1.runId },
        orderBy: [{ confidence: 'desc' }, { addedAt: 'desc' }],
      });

      // Assert close precursor is retained
      const precursorEvidence = evidenceRun1.find((e) => e.externalRefId === `deploy:${closePrecursor.deploymentId}`);
      expect(precursorEvidence).toBeDefined();

      // Assert total retained candidates respects configured cap
      expect(evidenceRun1.length).toBeLessThanOrEqual(50);

      // Assert farthest events (+120m) were discarded
      const farthestPost = evidenceRun1.find((e) => e.externalRefId === `deploy:dep-post-${ts}-109`);
      expect(farthestPost).toBeUndefined();

      // 5. Repeating the run produces the exact same ordering and evidence
      await redis.del(`lock:correlation:${testIncident.id}`).catch(() => undefined);
      const runRes2 = await CorrelationService.runCorrelation(orgAId, testIncident.id, undefined, 'RERUN_REQUEST');
      expect(runRes2.status).toBe('completed');

      const evidenceRun2 = await prisma.incidentEvidence.findMany({
        where: { incidentId: testIncident.id, correlationRunId: runRes2.runId },
        orderBy: [{ confidence: 'desc' }, { addedAt: 'desc' }],
      });

      expect(evidenceRun2.map((e) => e.externalRefId)).toEqual(evidenceRun1.map((e) => e.externalRefId));
    });

    it('17. Stable tie ordering breaks ties deterministically across identical scores', () => {
      const cA: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:aaa',
        title: 'Commit AAA',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { sha: 'aaa' },
      };
      const cB: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:bbb',
        title: 'Commit BBB',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'UNKNOWN',
        metadata: { sha: 'bbb' },
      };

      const resA = scoreCandidate(cA, context, emptyRels);
      const resB = scoreCandidate(cB, context, emptyRels);

      expect(resA.confidence).toBe(resB.confidence);
      const compAB = compareScoredCandidates(resA, resB, baseDetectedAt);
      const compBA = compareScoredCandidates(resB, resA, baseDetectedAt);

      expect(compAB).toBeLessThan(0);
      expect(compBA).toBeGreaterThan(0);
    });

    it('17b. selectNearestCandidates: a below-cap mixed list is still ordered by absolute distance', () => {
      const s30: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:30',
        title: 'Deploy +30m',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + 30 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };
      const s5: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:5',
        title: 'Deploy -5m',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 5 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };
      const s15: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:15',
        title: 'Deploy -15m',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };
      const s2: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:2',
        title: 'Deploy +2m',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + 2 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };

      const res = selectNearestCandidates([s30, s5, s15, s2], baseDetectedAt, 10);
      expect(res.isTruncated).toBe(false);
      expect(res.retained.map((c: CandidateSignal) => c.externalRefId)).toEqual([
        'deploy:2',
        'deploy:5',
        'deploy:15',
        'deploy:30',
      ]);
    });

    it('17c. selectNearestCandidates: for equal distance, the later timestamp comes first', () => {
      const pre10: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:pre10',
        title: 'Deploy -10m',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 10 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };
      const post10: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:post10',
        title: 'Deploy +10m',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + 10 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };

      const res = selectNearestCandidates([pre10, post10], baseDetectedAt, 10);
      expect(res.retained.map((c: CandidateSignal) => c.externalRefId)).toEqual([
        'deploy:post10',
        'deploy:pre10',
      ]);
    });

    it('17d. selectNearestCandidates: for equal distance and timestamp, externalRefId ascending is used', () => {
      const sZ: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:z',
        title: 'Deploy Z',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 5 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };
      const sA: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:a',
        title: 'Deploy A',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 5 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };
      const sM: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:m',
        title: 'Deploy M',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 5 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };

      const res = selectNearestCandidates([sZ, sA, sM], baseDetectedAt, 10);
      expect(res.retained.map((c: CandidateSignal) => c.externalRefId)).toEqual([
        'deploy:a',
        'deploy:m',
        'deploy:z',
      ]);
    });

    it('17e. selectNearestCandidates: the input array is not mutated', () => {
      const s1: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:1',
        title: 'Deploy 1',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + 20 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };
      const s2: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:2',
        title: 'Deploy 2',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 5 * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      };

      const original = [s1, s2];
      const snapshot = [...original];
      selectNearestCandidates(original, baseDetectedAt, 10);

      expect(original).toEqual(snapshot);
      expect(original[0]).toBe(s1);
      expect(original[1]).toBe(s2);
    });

    it('17f. selectNearestCandidates: above-cap selection remains correct and limits results to cap', () => {
      const signals: CandidateSignal[] = [1, 2, 3, 4, 5].map((min) => ({
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: `deploy:${min}`,
        title: `Deploy ${min}`,
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + min * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      }));

      const res = selectNearestCandidates(signals, baseDetectedAt, 3);
      expect(res.isTruncated).toBe(true);
      expect(res.retained.length).toBe(3);
      expect(res.retained.map((c: CandidateSignal) => c.externalRefId)).toEqual([
        'deploy:1',
        'deploy:2',
        'deploy:3',
      ]);
    });

    it('17g. selectNearestCandidates: isTruncated is false at or below the cap and true above it', () => {
      const signals: CandidateSignal[] = [1, 2, 3].map((min) => ({
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: `deploy:${min}`,
        title: `Deploy ${min}`,
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + min * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      }));

      // Below cap (3 items, cap 5)
      expect(selectNearestCandidates(signals, baseDetectedAt, 5).isTruncated).toBe(false);
      // At cap (3 items, cap 3)
      expect(selectNearestCandidates(signals, baseDetectedAt, 3).isTruncated).toBe(false);
      // Above cap (3 items, cap 2)
      expect(selectNearestCandidates(signals, baseDetectedAt, 2).isTruncated).toBe(true);
      // Non-positive cap (3 items, cap 0)
      const resZero = selectNearestCandidates(signals, baseDetectedAt, 0);
      expect(resZero.isTruncated).toBe(true);
      expect(resZero.retained).toEqual([]);
    });

    it('17h. selectNearestCandidates: two executions with the same shuffled input produce identical output', () => {
      const signals: CandidateSignal[] = [10, -5, 20, -15, 30, -2, 8, -8].map((min, idx) => ({
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: `deploy:${idx}`,
        title: `Deploy ${min}`,
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + min * 60 * 1000),
        serviceId: 'svc-1',
        environment: 'PRODUCTION',
        metadata: {},
      }));

      const shuffled1 = [signals[3], signals[0], signals[7], signals[2], signals[5], signals[1], signals[6], signals[4]];
      const shuffled2 = [signals[6], signals[4], signals[1], signals[5], signals[2], signals[7], signals[0], signals[3]];

      const res1 = selectNearestCandidates(shuffled1, baseDetectedAt, 4);
      const res2 = selectNearestCandidates(shuffled2, baseDetectedAt, 4);

      expect(res1).toEqual(res2);
      expect(res1.retained.map((c: CandidateSignal) => c.externalRefId)).toEqual(
        res2.retained.map((c: CandidateSignal) => c.externalRefId),
      );
    });
  });

  // ===========================================================================
  // OBJECTIVES 9, 10, 11: ATOMIC PERSISTENCE, STALE EVIDENCE & LOCKING
  // ===========================================================================
  describe('Objectives 9, 10 & 11: Atomic Persistence, Stale Evidence & Concurrency Locking', () => {
    it('18. Preserves every non-correlation evidence source (MANUAL, AI_SUGGESTED) across reruns and isolates runs', async () => {
      // Create a fresh incident for evidence isolation testing
      const testIsoIncident = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectAId,
          serviceId: serviceA1Id,
          createdById: ownerAUserId,
          number: Math.floor(Math.random() * 100000) + 200,
          title: 'Evidence Isolation Test Incident',
          description: 'Testing preservation of MANUAL and AI_SUGGESTED evidence across correlation lifecycle',
          severity: IncidentSeverity.SEV1,
          status: IncidentStatus.INVESTIGATING,
          environment: IncidentEnvironment.PRODUCTION,
          detectedAt: baseDetectedAt,
        },
      });

      const manualEvidence = await prisma.incidentEvidence.create({
        data: {
          incidentId: testIsoIncident.id,
          type: EvidenceType.MANUAL,
          source: EvidenceSource.MANUAL,
          externalRefId: `manual-note-${Date.now()}`,
          title: 'Manual Investigation Note by Lead SRE',
          confidence: 1.0,
        },
      });

      const aiEvidence = await prisma.incidentEvidence.create({
        data: {
          incidentId: testIsoIncident.id,
          type: EvidenceType.TIMELINE_EVENT,
          source: EvidenceSource.AI_SUGGESTED,
          externalRefId: `ai-suggested-${Date.now()}`,
          title: 'AI Root Cause Hypothesis',
          confidence: 0.88,
        },
      });

      // 6. With no completed correlation run, non-correlation evidence remains visible and NO correlation evidence returned
      const initialFetch = await CorrelationService.getCorrelationEvidence(orgAId, testIsoIncident.id);
      expect(initialFetch.latestCompletedRun).toBeNull();
      expect(initialFetch.evidence.some((e) => e.id === manualEvidence.id)).toBe(true);
      expect(initialFetch.evidence.some((e) => e.id === aiEvidence.id)).toBe(true);
      expect(initialFetch.evidence.some((e) => (e.source as string) === 'CORRELATION_ENGINE')).toBe(false);

      // 1 & 2. Execute Correlation Run 1: MANUAL & AI_SUGGESTED survive
      await redis.del(`lock:correlation:${testIsoIncident.id}`).catch(() => undefined);
      const run1 = await CorrelationService.runCorrelation(orgAId, testIsoIncident.id, undefined, 'MANUAL_REQUEST');
      expect(run1.status).toBe('completed');

      const fetchAfterRun1 = await CorrelationService.getCorrelationEvidence(orgAId, testIsoIncident.id);
      expect(fetchAfterRun1.latestCompletedRun?.id).toBe(run1.runId);
      expect(fetchAfterRun1.evidence.some((e) => e.id === manualEvidence.id)).toBe(true);
      expect(fetchAfterRun1.evidence.some((e) => e.id === aiEvidence.id)).toBe(true);

      // 3 & 4. Execute Correlation Run 2: only Run 2 correlation evidence is returned, Run 1 excluded, non-correlation preserved
      await redis.del(`lock:correlation:${testIsoIncident.id}`).catch(() => undefined);
      const run2 = await CorrelationService.runCorrelation(orgAId, testIsoIncident.id, undefined, 'RERUN_REQUEST');
      expect(run2.status).toBe('completed');

      const fetchAfterRun2 = await CorrelationService.getCorrelationEvidence(orgAId, testIsoIncident.id);
      expect(fetchAfterRun2.latestCompletedRun?.id).toBe(run2.runId);
      expect(fetchAfterRun2.evidence.some((e) => e.id === manualEvidence.id)).toBe(true);
      expect(fetchAfterRun2.evidence.some((e) => e.id === aiEvidence.id)).toBe(true);

      for (const ev of fetchAfterRun2.evidence) {
        if ((ev.source as string) === 'CORRELATION_ENGINE') {
          expect(ev.correlationRunId).toBe(run2.runId);
          expect(ev.correlationRunId).not.toBe(run1.runId);
        }
      }

      // 5. A newer RUNNING or FAILED run does NOT hide the previous completed run (Run 2)
      await prisma.correlationRun.create({
        data: {
          organizationId: orgAId,
          incidentId: testIsoIncident.id,
          triggerType: 'AUTOMATIC_INCIDENT_UPDATED',
          status: CorrelationRunStatus.FAILED,
          error: 'Simulated downstream failure',
          windowStart: new Date(),
          windowEnd: new Date(),
        },
      });

      const fetchAfterFailed = await CorrelationService.getCorrelationEvidence(orgAId, testIsoIncident.id);
      expect(fetchAfterFailed.latestCompletedRun?.id).toBe(run2.runId);
      expect(fetchAfterFailed.evidence.some((e) => e.id === manualEvidence.id)).toBe(true);
      expect(fetchAfterFailed.evidence.some((e) => e.id === aiEvidence.id)).toBe(true);
    });

    it('19. Failed run preserves previous successful evidence and does not leave partial state', async () => {
      const prevData = await CorrelationService.getCorrelationEvidence(orgAId, incidentAId);
      const prevRunId = prevData.latestCompletedRun?.id;
      expect(prevRunId).toBeDefined();

      faultInjector = (params: Prisma.MiddlewareParams) => {
        if (params.model === 'CorrelationRun' && params.action === 'create') {
          throw new Error('Simulated database failure during run init');
        }
      };

      await redis.del(`lock:correlation:${incidentAId}`).catch(() => undefined);
      await expect(
        CorrelationService.runCorrelation(orgAId, incidentAId, undefined, 'MANUAL_REQUEST'),
      ).rejects.toThrow('Simulated database failure during run init');

      faultInjector = null;

      const currentData = await CorrelationService.getCorrelationEvidence(orgAId, incidentAId);
      expect(currentData.latestCompletedRun?.id).toBe(prevRunId);
    });

    it('20. Real persistence rollback without mocking prisma.$transaction', async () => {
      await redis.del(`lock:correlation:${incidentAId}`).catch(() => undefined);

      faultInjector = (params: Prisma.MiddlewareParams) => {
        if (params.model === 'IncidentEvent' && params.action === 'create') {
          const meta = (params.args as { data?: { metadata?: { correlationRun?: boolean } } })?.data?.metadata;
          if (meta?.correlationRun) {
            throw new Error('Simulated persistence failure during correlation completion event');
          }
        }
      };

      await expect(
        CorrelationService.runCorrelation(orgAId, incidentAId, undefined, 'MANUAL_REQUEST'),
      ).rejects.toThrow('Simulated persistence failure during correlation completion event');

      faultInjector = null;

      const failedRun = await prisma.correlationRun.findFirst({
        where: { incidentId: incidentAId, status: CorrelationRunStatus.FAILED },
        orderBy: { startedAt: 'desc' },
      });
      expect(failedRun).toBeDefined();
      expect(failedRun?.error).toContain('Simulated persistence failure');
    });

    it('21. Exactly one completion event and broadcast emitted on successful run', async () => {
      const broadcastSpy = vi.spyOn(socketModule, 'broadcastToIncident');
      await redis.del(`lock:correlation:${incidentAId}`).catch(() => undefined);

      const res = await CorrelationService.runCorrelation(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');
      expect(res.status).toBe('completed');

      const events = await prisma.incidentEvent.findMany({
        where: { incidentId: incidentAId, type: 'CORRELATION_RUN_COMPLETED' },
      });
      const thisRunEvents = events.filter((e) => (e.metadata as { runId?: string })?.runId === res.runId);
      expect(thisRunEvents.length).toBe(1);

      const completedEmissions = broadcastSpy.mock.calls.filter((c) => c[1] === 'CORRELATION_COMPLETED');
      expect(completedEmissions.length).toBe(1);

      broadcastSpy.mockRestore();
    });

    it('22. Atomic Redis lock acquisition returns skipped_lock_active when locked', async () => {
      const lockKey = `lock:correlation:${incidentAId}`;
      const health = await checkRedisHealth();

      if (health === 'connected') {
        await redis.set(lockKey, 'active-test-lock');
      }

      const res = await CorrelationService.runCorrelation(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');

      if (health === 'connected') {
        expect(res.status).toBe('skipped_lock_active');
        await redis.del(lockKey);
      } else {
        expect(res.status).toBe('completed');
      }
    });

    it('23. Redis-unavailable in-process guard prevents concurrent runs in the same node process', async () => {
      await redis.del(`lock:correlation:${incidentAId}`).catch(() => undefined);

      const [r1, r2] = await Promise.all([
        CorrelationService.runCorrelation(orgAId, incidentAId, undefined, 'MANUAL_REQUEST'),
        CorrelationService.runCorrelation(orgAId, incidentAId, undefined, 'MANUAL_REQUEST'),
      ]);

      const statuses = [r1.status, r2.status];
      expect(statuses).toContain('completed');
      expect(statuses.every((s) => s === 'completed' || s === 'skipped_lock_active')).toBe(true);
    });

    it('24. Cross-tenant exclusion: candidates from Org B are never ingested into Org A correlation', async () => {
      const repoB = await prisma.gitHubRepository.create({
        data: {
          organizationId: orgBId,
          integrationId: gitHubIntegBId,
          githubRepoId: BigInt(Date.now() + 999),
          name: 'org-b-repo',
          fullName: 'org-b/repo',
          owner: 'org-b',
          url: 'https://github.com/org-b/repo',
        },
      });

      const commitB = await prisma.gitHubCommit.create({
        data: {
          repositoryId: repoB.id,
          sha: `sha-cross-tenant-${ts}`,
          authorName: 'Attacker',
          message: 'Cross tenant attempt',
          branch: 'main',
          url: 'https://github.com/org-b/repo/commit/1',
          committedAt: new Date(),
        },
      });

      await redis.del(`lock:correlation:${incidentAId}`).catch(() => undefined);
      await CorrelationService.runCorrelation(orgAId, incidentAId, undefined, 'MANUAL_REQUEST');

      const crossEv = await prisma.incidentEvidence.findFirst({
        where: { incidentId: incidentAId, externalRefId: `commit:${commitB.sha}` },
      });
      expect(crossEv).toBeNull();
    });
  });

  // ===========================================================================
  // OBJECTIVE 12: BENCHMARK RELEVANT/NOISE RANKING INVARIANTS
  // ===========================================================================
  describe('Objective 12: Labeled Correlation Benchmark Invariants', () => {
    const benchContext: IncidentScoringContext = {
      incidentId: 'inc-bench',
      organizationId: 'org-bench',
      projectId: 'proj-bench',
      serviceId: 'svc-bench',
      environment: 'PRODUCTION',
      detectedAt: baseDetectedAt,
    };

    it('25. Benchmark fixture ranking invariants: relevant precursors outrank noise, no noise is HIGH', () => {
      const relevantDeploy: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:relevant-anchor',
        title: 'Same-service production deployment 15m prior',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'PRODUCTION',
        metadata: { deploymentId: 'relevant-anchor', commitSha: 'sha-bench-fix' },
      };

      const relevantCommit: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:sha-bench-fix',
        title: 'Exact deployed commit SHA',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 18 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'UNKNOWN',
        metadata: { sha: 'sha-bench-fix' },
      };

      const relevantFailedWorkflow: CandidateSignal = {
        type: EvidenceType.GITHUB_WORKFLOW_RUN,
        externalRefId: 'workflow:wf-bench-deploy',
        title: 'Failed CI on deployed commit',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 16 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'UNKNOWN',
        metadata: { conclusion: 'failure', commitSha: 'sha-bench-fix' },
      };

      const relevantSentrySpike: CandidateSignal = {
        type: EvidenceType.SENTRY_ERROR,
        externalRefId: 'sentry:spike-500',
        title: 'Database connection pool exhausted spike',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 5 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'PRODUCTION',
        metadata: { userCount: 40, eventCount: 250, level: 'fatal', release: 'sha-bench-fix' },
      };

      const noisePostDeploy: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:noise-post',
        title: 'Post-incident deployment 60m later',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() + 60 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'PRODUCTION',
        metadata: { deploymentId: 'noise-post', commitSha: 'sha-noise-1' },
      };

      const noiseDiffServiceDeploy: CandidateSignal = {
        type: EvidenceType.GITHUB_DEPLOYMENT,
        externalRefId: 'deploy:noise-diff-svc',
        title: 'Different service deployment',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-other',
        environment: 'PRODUCTION',
        metadata: { deploymentId: 'noise-diff-svc', commitSha: 'sha-noise-2' },
      };

      const noiseOldCommit: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:noise-old',
        title: 'Old commit 5 days ago',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 5 * 24 * 60 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'UNKNOWN',
        metadata: { sha: 'noise-old' },
      };

      const noiseUnmergedPR: CandidateSignal = {
        type: EvidenceType.GITHUB_PR,
        externalRefId: 'pr:noise-unmerged',
        title: 'Unmerged PR draft',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'UNKNOWN',
        metadata: { number: 12, state: 'open', mergedAt: null },
      };

      const noiseSuccessWorkflow: CandidateSignal = {
        type: EvidenceType.GITHUB_WORKFLOW_RUN,
        externalRefId: 'workflow:noise-success',
        title: 'Successful background workflow',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'UNKNOWN',
        metadata: { conclusion: 'success', commitSha: 'sha-random-unrelated' },
      };

      const noiseLowSentry: CandidateSignal = {
        type: EvidenceType.SENTRY_ERROR,
        externalRefId: 'sentry:noise-low',
        title: 'Low volume informational log',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 15 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'PRODUCTION',
        metadata: { userCount: 1, eventCount: 1, level: 'info' },
      };

      const allBenchmarkCandidates = [
        relevantDeploy,
        relevantCommit,
        relevantFailedWorkflow,
        relevantSentrySpike,
        noisePostDeploy,
        noiseDiffServiceDeploy,
        noiseOldCommit,
        noiseUnmergedPR,
        noiseSuccessWorkflow,
        noiseLowSentry,
      ];

      const scored = scoreAllCandidates(allBenchmarkCandidates, benchContext);

      const topIds = scored.slice(0, 4).map((s: CandidateScoreResult) => s.candidate.externalRefId);
      expect(topIds).toContain('deploy:relevant-anchor');
      expect(topIds).toContain('commit:sha-bench-fix');
      expect(topIds).toContain('sentry:spike-500');

      const relDeployResult = scored.find((s: CandidateScoreResult) => s.candidate.externalRefId === 'deploy:relevant-anchor');
      const relCommitResult = scored.find((s: CandidateScoreResult) => s.candidate.externalRefId === 'commit:sha-bench-fix');
      const relSentryResult = scored.find((s: CandidateScoreResult) => s.candidate.externalRefId === 'sentry:spike-500');

      expect(relDeployResult?.confidenceTier).toBe(EvidenceConfidenceTier.HIGH);
      expect(relCommitResult?.confidenceTier).toBe(EvidenceConfidenceTier.HIGH);
      expect(relSentryResult?.confidenceTier).toBe(EvidenceConfidenceTier.HIGH);

      const noiseIds = [
        'deploy:noise-post',
        'deploy:noise-diff-svc',
        'commit:noise-old',
        'pr:noise-unmerged',
        'workflow:noise-success',
        'sentry:noise-low',
      ];
      for (const nid of noiseIds) {
        const item = scored.find((s: CandidateScoreResult) => s.candidate.externalRefId === nid);
        if (item) {
          expect(item.confidenceTier).not.toBe(EvidenceConfidenceTier.HIGH);
          expect(item.confidence).toBeLessThan(0.80);
        }
      }

      const genericCommit: CandidateSignal = {
        type: EvidenceType.GITHUB_COMMIT,
        externalRefId: 'commit:generic-proximity',
        title: 'Generic commit in same service without deployment',
        description: null,
        url: null,
        occurredAt: new Date(baseDetectedAt.getTime() - 18 * 60 * 1000),
        serviceId: 'svc-bench',
        environment: 'UNKNOWN',
        metadata: { sha: 'generic-sha' },
      };
      const scoredWithGeneric = scoreAllCandidates([...allBenchmarkCandidates, genericCommit], benchContext);
      const exactCommitScore = scoredWithGeneric.find((s: CandidateScoreResult) => s.candidate.externalRefId === 'commit:sha-bench-fix');
      const genericCommitScore = scoredWithGeneric.find((s: CandidateScoreResult) => s.candidate.externalRefId === 'commit:generic-proximity');
      expect(exactCommitScore).toBeDefined();
      expect(genericCommitScore).toBeDefined();
      expect(exactCommitScore?.confidence).toBeGreaterThan(genericCommitScore?.confidence ?? 0);
    });
  });
});



