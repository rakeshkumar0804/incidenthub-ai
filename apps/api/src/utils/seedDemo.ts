import {
  PrismaClient,
  OrgRole,
  IncidentSeverity,
  IncidentStatus,
  IncidentEnvironment,
  EventSource,
  EvidenceType,
  EvidenceSource,
  EvidenceConfidenceTier,
  CorrelationRunStatus,
  CorrelationTriggerType,
  InvestigationStatus,
  InvestigationTriggerType,
  InvestigationConfidenceTier,
  PostmortemStatus,
  ActionItemStatus,
  ActionItemPriority,
  ReplayRunStatus,
  ReplayTriggerType,
  ReplayCategory,
  IntegrationProvider,
  IntegrationStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

export async function runDemoSeeding(prisma: PrismaClient): Promise<{
  message: string;
  organizations: string[];
  incidentsCreated: number;
}> {
  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Demo Users
  const existingUsers = await prisma.user.findMany({ take: 10 });
  const primaryOwner = existingUsers.length > 0 ? existingUsers[0] : null;

  const demoAdmin = await prisma.user.upsert({
    where: { email: 'alex.chen@acme.dev' },
    update: {},
    create: {
      email: 'alex.chen@acme.dev',
      name: 'Alex Chen (Staff SRE)',
      emailVerified: true,
      passwordHash,
    },
  });

  const demoResponder = await prisma.user.upsert({
    where: { email: 'elena.rostova@acme.dev' },
    update: {},
    create: {
      email: 'elena.rostova@acme.dev',
      name: 'Elena Rostova (Lead Backend)',
      emailVerified: true,
      passwordHash,
    },
  });

  const demoViewer = await prisma.user.upsert({
    where: { email: 'marcus.vance@acme.dev' },
    update: {},
    create: {
      email: 'marcus.vance@acme.dev',
      name: 'Marcus Vance (VP of Eng)',
      emailVerified: true,
      passwordHash,
    },
  });

  // 2. Identify all target organizations to seed
  // Always seed Acme Engineering AND any existing organizations in the database
  const acmeOrg = await prisma.organization.upsert({
    where: { slug: 'acme-engineering' },
    update: {
      name: 'Acme Engineering',
      logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128&q=80',
    },
    create: {
      name: 'Acme Engineering',
      slug: 'acme-engineering',
      logoUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128&q=80',
    },
  });

  const allOrgs = await prisma.organization.findMany();
  const targetOrgs = allOrgs.length > 0 ? allOrgs : [acmeOrg];

  let totalIncidentsCreated = 0;

  for (const org of targetOrgs) {
    // Add demo users + existing users as members of this org
    const allUsersToLink = [
      ...(primaryOwner ? [{ id: primaryOwner.id, role: OrgRole.OWNER }] : []),
      { id: demoAdmin.id, role: OrgRole.ADMIN },
      { id: demoResponder.id, role: OrgRole.RESPONDER },
      { id: demoViewer.id, role: OrgRole.VIEWER },
      ...existingUsers.map((u) => ({ id: u.id, role: OrgRole.OWNER })),
    ];

    for (const u of allUsersToLink) {
      await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: org.id,
            userId: u.id,
          },
        },
        update: {},
        create: {
          organizationId: org.id,
          userId: u.id,
          role: u.role,
        },
      });
    }

    // Teams
    const sreTeam = await prisma.team.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'SRE & Platform Infrastructure' } },
      update: {},
      create: {
        organizationId: org.id,
        name: 'SRE & Platform Infrastructure',
        description: 'Site Reliability Engineering, Observability & Cloud Platforms',
      },
    });

    const backendTeam = await prisma.team.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'Core Backend & Payments' } },
      update: {},
      create: {
        organizationId: org.id,
        name: 'Core Backend & Payments',
        description: 'Payment orchestration, customer billing & financial ledger',
      },
    });

    // Team Members
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: sreTeam.id, userId: demoAdmin.id } },
      update: {},
      create: { teamId: sreTeam.id, userId: demoAdmin.id },
    });
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: backendTeam.id, userId: demoResponder.id } },
      update: {},
      create: { teamId: backendTeam.id, userId: demoResponder.id },
    });

    // Projects
    const paymentProject = await prisma.project.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: 'payment-checkout' } },
      update: {},
      create: {
        organizationId: org.id,
        teamId: backendTeam.id,
        name: 'Payment & Checkout Platform',
        slug: 'payment-checkout',
        description: 'Customer checkout flows, Stripe/PayPal webhooks, and ledger synchronization.',
      },
    });

    const coreApiProject = await prisma.project.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: 'core-identity' } },
      update: {},
      create: {
        organizationId: org.id,
        teamId: sreTeam.id,
        name: 'Core API & Identity Gateway',
        slug: 'core-identity',
        description: 'Authentication, session management, and microservice API gateway.',
      },
    });

    // Services
    const paymentGatewayService = await prisma.service.upsert({
      where: { projectId_slug: { projectId: paymentProject.id, slug: 'payment-gateway' } },
      update: {},
      create: {
        projectId: paymentProject.id,
        name: 'Payment Gateway',
        slug: 'payment-gateway',
        description: 'Card charge orchestration and idempotency processor',
        repositoryUrl: 'https://github.com/acme-engineering/payment-gateway',
      },
    });

    const checkoutApiService = await prisma.service.upsert({
      where: { projectId_slug: { projectId: paymentProject.id, slug: 'checkout-api' } },
      update: {},
      create: {
        projectId: paymentProject.id,
        name: 'Checkout API',
        slug: 'checkout-api',
        description: 'Shopping cart and checkout session state service',
        repositoryUrl: 'https://github.com/acme-engineering/checkout-api',
      },
    });

    const authService = await prisma.service.upsert({
      where: { projectId_slug: { projectId: coreApiProject.id, slug: 'auth-service' } },
      update: {},
      create: {
        projectId: coreApiProject.id,
        name: 'Auth & Session Service',
        slug: 'auth-service',
        description: 'JWT token issuance, OAuth identity and RBAC policy service',
        repositoryUrl: 'https://github.com/acme-engineering/auth-service',
      },
    });

    // GitHub Integration & Repo
    const githubIntegration = await prisma.integration.upsert({
      where: { organizationId_provider: { organizationId: org.id, provider: IntegrationProvider.GITHUB } },
      update: { status: IntegrationStatus.CONNECTED },
      create: {
        organizationId: org.id,
        provider: IntegrationProvider.GITHUB,
        status: IntegrationStatus.CONNECTED,
        metadata: {
          accountName: 'acme-engineering',
          installedRepositories: ['payment-gateway', 'auth-service', 'checkout-api'],
          lastSync: new Date().toISOString(),
        },
      },
    });

    const githubRepo = await prisma.gitHubRepository.upsert({
      where: { organizationId_githubRepoId: { organizationId: org.id, githubRepoId: BigInt(84729103) } },
      update: {},
      create: {
        organizationId: org.id,
        integrationId: githubIntegration.id,
        githubRepoId: BigInt(84729103),
        name: 'payment-gateway',
        fullName: 'acme-engineering/payment-gateway',
        owner: 'acme-engineering',
        defaultBranch: 'main',
        url: 'https://github.com/acme-engineering/payment-gateway',
        description: 'Production payment gateway and credit card processing microservice',
        isPrivate: true,
        language: 'TypeScript',
        projectId: paymentProject.id,
        serviceId: paymentGatewayService.id,
      },
    });

    const culpritCommit = await prisma.gitHubCommit.upsert({
      where: { repositoryId_sha: { repositoryId: githubRepo.id, sha: '7f9c2d1e0a8b3f4c5d6e7f8a9b0c1d2e3f4a5b6c' } },
      update: {},
      create: {
        repositoryId: githubRepo.id,
        sha: '7f9c2d1e0a8b3f4c5d6e7f8a9b0c1d2e3f4a5b6c',
        authorName: 'Elena Rostova',
        authorEmail: 'elena.rostova@acme.dev',
        message: 'perf(pool): reduce idle timeout to 200ms and set connection pool min=2',
        branch: 'main',
        url: 'https://github.com/acme-engineering/payment-gateway/commit/7f9c2d1e0a8b3f4c5d6e7f8a9b0c1d2e3f4a5b6c',
        committedAt: new Date(Date.now() - 5 * 86400 * 1000 - 15 * 60 * 1000),
      },
    });

    const culpritPR = await prisma.gitHubPullRequest.upsert({
      where: { repositoryId_number: { repositoryId: githubRepo.id, number: 412 } },
      update: {},
      create: {
        repositoryId: githubRepo.id,
        number: 412,
        title: 'Reduce idle database connection pool timeouts to optimize connection count',
        state: 'merged',
        author: 'elena-rostova',
        branch: 'perf/pool-tuning',
        targetBranch: 'main',
        url: 'https://github.com/acme-engineering/payment-gateway/pull/412',
        mergedAt: new Date(Date.now() - 5 * 86400 * 1000 - 20 * 60 * 1000),
      },
    });

    const culpritDeploy = await prisma.gitHubDeployment.upsert({
      where: { repositoryId_deploymentId: { repositoryId: githubRepo.id, deploymentId: 'deploy-prod-9821' } },
      update: {},
      create: {
        repositoryId: githubRepo.id,
        deploymentId: 'deploy-prod-9821',
        environment: 'production',
        state: 'success',
        commitSha: culpritCommit.sha,
        creator: 'github-actions[bot]',
        url: 'https://github.com/acme-engineering/payment-gateway/deployments/deploy-prod-9821',
        createdAt: new Date(Date.now() - 5 * 86400 * 1000 - 10 * 60 * 1000),
      },
    });

    // Clean old incidents under this org to ensure idempotent fresh state
    await prisma.incident.deleteMany({ where: { organizationId: org.id } });

    const now = Date.now();
    const daysAgo = (d: number, hours = 0, mins = 0) =>
      new Date(now - d * 86400000 - hours * 3600000 - mins * 60000);

    // INCIDENT 1: SEV-1 RESOLVED
    const inc1Detected = daysAgo(5, 4, 15);
    const inc1Ack = daysAgo(5, 4, 11);
    const inc1Resolved = daysAgo(5, 2, 52);

    const inc1 = await prisma.incident.create({
      data: {
        organizationId: org.id,
        projectId: paymentProject.id,
        serviceId: paymentGatewayService.id,
        number: 101,
        title: 'Database Connection Pool Exhaustion on Payment Gateway',
        description:
          'Payment gateway experiencing 504 Gateway Timeouts across US-East cluster. Connection pool reached 100% capacity following cache miss storm.',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.RESOLVED,
        environment: IncidentEnvironment.PRODUCTION,
        detectedAt: inc1Detected,
        acknowledgedAt: inc1Ack,
        resolvedAt: inc1Resolved,
        createdById: demoAdmin.id,
        assignedToId: demoResponder.id,
        createdAt: inc1Detected,
      },
    });

    // INCIDENT 2: SEV-2 RESOLVED
    const inc2Detected = daysAgo(3, 8, 30);
    await prisma.incident.create({
      data: {
        organizationId: org.id,
        projectId: coreApiProject.id,
        serviceId: authService.id,
        number: 102,
        title: 'JWT Verification Latency Spike & Token Cache Throttling',
        description:
          'p99 authentication latency climbed from 45ms to 1,420ms following Auth Service rollout v2.14.0. Redis key cache TTL misconfiguration triggered upstream API timeouts.',
        severity: IncidentSeverity.SEV2,
        status: IncidentStatus.RESOLVED,
        environment: IncidentEnvironment.PRODUCTION,
        detectedAt: inc2Detected,
        acknowledgedAt: daysAgo(3, 8, 26),
        resolvedAt: daysAgo(3, 7, 16),
        createdById: demoResponder.id,
        assignedToId: demoAdmin.id,
        createdAt: inc2Detected,
      },
    });

    // INCIDENT 3: SEV-2 MITIGATING
    await prisma.incident.create({
      data: {
        organizationId: org.id,
        projectId: paymentProject.id,
        serviceId: checkoutApiService.id,
        number: 103,
        title: 'Elevated Stripe Webhook Rate-Limit 429 Errors',
        description:
          'Stripe webhook handler dropping event batches due to downstream concurrent lock contention. Fallback async buffer queue enabled while investigating retry storm.',
        severity: IncidentSeverity.SEV2,
        status: IncidentStatus.MITIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        detectedAt: daysAgo(0, 5, 20),
        acknowledgedAt: daysAgo(0, 5, 12),
        createdById: demoResponder.id,
        assignedToId: demoResponder.id,
        createdAt: daysAgo(0, 5, 20),
      },
    });


    // INCIDENT 4: SEV-3 INVESTIGATING
    await prisma.incident.create({
      data: {
        organizationId: org.id,
        projectId: paymentProject.id,
        serviceId: paymentGatewayService.id,
        number: 104,
        title: 'Kafka Consumer Lag Increasing on Ledger Reconciliation Stream',
        description:
          'Consumer group payment-ledger-sync lag exceeded 18,500 messages. Partition rebalance loop observed after node migration.',
        severity: IncidentSeverity.SEV3,
        status: IncidentStatus.INVESTIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        detectedAt: daysAgo(0, 2, 45),
        acknowledgedAt: daysAgo(0, 2, 35),
        createdById: demoAdmin.id,
        assignedToId: demoAdmin.id,
        createdAt: daysAgo(0, 2, 45),
      },
    });

    // INCIDENT 5: SEV-4 OPEN
    await prisma.incident.create({
      data: {
        organizationId: org.id,
        projectId: coreApiProject.id,
        serviceId: authService.id,
        number: 105,
        title: 'Minor Static Asset Hash Mismatch on Staging Gateway',
        description:
          'Documentation sub-domain serving stale favicon and SVG assets after branch merge. No production customer impact.',
        severity: IncidentSeverity.SEV4,
        status: IncidentStatus.OPEN,
        environment: IncidentEnvironment.STAGING,
        detectedAt: daysAgo(0, 0, 45),
        createdById: demoViewer.id,
        createdAt: daysAgo(0, 0, 45),
      },
    });

    // INCIDENT 6: SEV-3 RESOLVED
    await prisma.incident.create({
      data: {
        organizationId: org.id,
        projectId: paymentProject.id,
        serviceId: checkoutApiService.id,
        number: 106,
        title: 'Memory Leak in Checkout Session Cache under High Load',
        description:
          'Node.js heap size climbed steadily to 2GB OOM limit during flash sale. Resolved by replacing unbounded Map with fixed LRU cache.',
        severity: IncidentSeverity.SEV3,
        status: IncidentStatus.RESOLVED,
        environment: IncidentEnvironment.PRODUCTION,
        detectedAt: daysAgo(9, 6, 0),
        acknowledgedAt: daysAgo(9, 5, 55),
        resolvedAt: daysAgo(9, 4, 10),
        createdById: demoAdmin.id,
        assignedToId: demoResponder.id,
        createdAt: daysAgo(9, 6, 0),
      },
    });

    // INCIDENT 7: SEV-4 RESOLVED
    await prisma.incident.create({
      data: {
        organizationId: org.id,
        projectId: coreApiProject.id,
        serviceId: authService.id,
        number: 107,
        title: 'Scheduled Maintenance Webhook Queue Backpressure',
        description:
          'Inbound webhooks queued for 120 seconds during database minor version patching. All events safely replayed.',
        severity: IncidentSeverity.SEV4,
        status: IncidentStatus.RESOLVED,
        environment: IncidentEnvironment.PRODUCTION,
        detectedAt: daysAgo(14, 12, 0),
        acknowledgedAt: daysAgo(14, 11, 58),
        resolvedAt: daysAgo(14, 11, 20),
        createdById: demoAdmin.id,
        assignedToId: demoAdmin.id,
        createdAt: daysAgo(14, 12, 0),
      },
    });

    totalIncidentsCreated += 7;

    // Correlation Run & Evidence for INC-1
    const corrRun1 = await prisma.correlationRun.create({
      data: {
        organizationId: org.id,
        incidentId: inc1.id,
        triggerType: CorrelationTriggerType.AUTOMATIC_INCIDENT_CREATED,
        status: CorrelationRunStatus.COMPLETED,
        windowStart: new Date(inc1Detected.getTime() - 2 * 3600000),
        windowEnd: new Date(inc1Detected.getTime() + 1 * 3600000),
        candidateCount: 12,
        correlatedCount: 3,
        triggeredById: demoAdmin.id,
        startedAt: new Date(inc1Detected.getTime() + 60000),
        completedAt: new Date(inc1Detected.getTime() + 64000),
      },
    });

    const evidence1 = await prisma.incidentEvidence.create({
      data: {
        incidentId: inc1.id,
        correlationRunId: corrRun1.id,
        type: EvidenceType.GITHUB_DEPLOYMENT,
        source: EvidenceSource.CORRELATION_ENGINE,
        externalRefId: culpritDeploy.deploymentId,
        confidenceTier: EvidenceConfidenceTier.HIGH,
        title: `Production Deployment: ${githubRepo.name} (${culpritCommit.sha.slice(0, 7)})`,
        description: `Deployment ${culpritDeploy.deploymentId} completed 10 minutes prior to incident detection. Contained connection pool idle timeout reduction.`,
        url: culpritDeploy.url,
        confidence: 0.94,
        reasons: {
          temporalProximity: true,
          projectMatch: true,
          serviceMatch: true,
          environmentMatch: true,
          deploymentRelation: true,
        },
      },
    });

    const evidence2 = await prisma.incidentEvidence.create({
      data: {
        incidentId: inc1.id,
        correlationRunId: corrRun1.id,
        type: EvidenceType.GITHUB_COMMIT,
        source: EvidenceSource.CORRELATION_ENGINE,
        externalRefId: culpritCommit.sha,
        confidenceTier: EvidenceConfidenceTier.HIGH,
        title: `Git Commit: "${culpritCommit.message}"`,
        description: `Commit by ${culpritCommit.authorName} changed pool configuration: minPool=2, idleTimeoutMs=200.`,
        url: culpritCommit.url,
        confidence: 0.91,
      },
    });

    await prisma.incidentEvidence.create({
      data: {
        incidentId: inc1.id,
        correlationRunId: corrRun1.id,
        type: EvidenceType.GITHUB_PR,
        source: EvidenceSource.CORRELATION_ENGINE,
        externalRefId: `PR-${culpritPR.number}`,
        confidenceTier: EvidenceConfidenceTier.MEDIUM,
        title: `Pull Request #${culpritPR.number}: ${culpritPR.title}`,
        description: `Merged by Elena Rostova onto main branch.`,
        url: culpritPR.url,
        confidence: 0.78,
      },
    });

    // Timeline Events
    await prisma.incidentEvent.createMany({
      data: [
        {
          incidentId: inc1.id,
          organizationId: org.id,
          source: EventSource.SYSTEM,
          type: 'INCIDENT_CREATED',
          message: 'SEV-1 Incident declared automatically by CloudWatch latency threshold monitor.',
          occurredAt: inc1Detected,
        },
        {
          incidentId: inc1.id,
          organizationId: org.id,
          userId: demoAdmin.id,
          source: EventSource.USER,
          type: 'ASSIGNEE_CHANGED',
          message: 'Alex Chen assigned incident investigation to Elena Rostova (Lead Backend).',
          occurredAt: new Date(inc1Detected.getTime() + 4 * 60000),
        },
        {
          incidentId: inc1.id,
          organizationId: org.id,
          source: EventSource.AI,
          type: 'CORRELATION_ENGINE',
          message: 'Correlation engine matched GitHub deployment deploy-prod-9821 with 94% confidence.',
          occurredAt: new Date(inc1Detected.getTime() + 6 * 60000),
        },
        {
          incidentId: inc1.id,
          organizationId: org.id,
          userId: demoResponder.id,
          source: EventSource.USER,
          type: 'STATUS_CHANGED',
          message: 'Status updated to MITIGATING. Initiated hotfix rollback to deployment deploy-prod-9820.',
          occurredAt: new Date(inc1Detected.getTime() + 42 * 60000),
        },
        {
          incidentId: inc1.id,
          organizationId: org.id,
          source: EventSource.SYSTEM,
          type: 'STATUS_CHANGED',
          message: 'Rollback verified. Database connection pool utilization dropped from 100% to 14%. Incident RESOLVED.',
          occurredAt: inc1Resolved,
        },
      ],
    });

    // AI Investigation Run for INC-1
    await prisma.investigationRun.create({
      data: {
        organizationId: org.id,
        incidentId: inc1.id,
        correlationRunId: corrRun1.id,
        status: InvestigationStatus.COMPLETED,
        triggerType: InvestigationTriggerType.MANUAL_REQUEST,
        confidenceTier: InvestigationConfidenceTier.HIGH,
        confidence: 0.96,
        incidentSummary:
          'At 14:15 UTC, the Payment Gateway experienced a cascading outage resulting in 504 Gateway Timeouts for 100% of checkout transactions. Root cause was traced to a database connection pool starvation induced by an aggressive 200ms idle connection timeout introduced in PR #412.',
        probableRootCause:
          'PR #412 (Commit 7f9c2d1) configured database connection pool idleTimeout to 200ms and minPool=2. Under production query rates (1,800 req/s), connections were prematurely closed and rapidly re-established, exhausting PostgreSQL max_connections and blocking worker threads.',
        supportingEvidence: [
          {
            id: evidence1.id,
            type: 'GITHUB_DEPLOYMENT',
            summary: 'Deployment deploy-prod-9821 completed 10 minutes prior to latency spike.',
          },
          {
            id: evidence2.id,
            type: 'GITHUB_COMMIT',
            summary: 'Commit 7f9c2d1 modified pool configuration in payment-gateway/src/db.ts.',
          },
        ],
        impactAssessment:
          'Total duration: 83 minutes. Approximately 14,200 checkout attempts failed with HTTP 504. Estimated GMV transaction impact: $42,000.',
        riskAssessment:
          'HIGH risk of recurrence if database connection pool parameters are not enforced via automated configuration schema validation in CI.',
        recommendedActions: [
          'Enforce minimum pool size = 10 and idle timeout >= 30,000ms in database config schema.',
          'Add load test verification step in PR pipeline for database configuration alterations.',
          'Configure Prometheus alert for Postgres pool utilization exceeding 80% for > 60s.',
        ],
        providerName: 'openai',
        modelName: 'gpt-4o',
        promptTokens: 1840,
        completionTokens: 620,
        totalTokens: 2460,
        latencyMs: 1480,
      },
    });

    // Postmortem for INC-1
    const postmortem1 = await prisma.postmortem.create({
      data: {
        organizationId: org.id,
        incidentId: inc1.id,
        status: PostmortemStatus.APPROVED,
      },
    });

    const pmVersion1 = await prisma.postmortemVersion.create({
      data: {
        postmortemId: postmortem1.id,
        organizationId: org.id,
        incidentId: inc1.id,
        versionNumber: 1,
        status: PostmortemStatus.APPROVED,
        isCurrent: true,
        aiGenerated: true,
        summary:
          'On August 12, 2026, the Payment Gateway service experienced a critical outage lasting 83 minutes due to database connection pool exhaustion following deployment deploy-prod-9821.',
        impact:
          '14,200 customer checkout requests dropped (100% error rate on /charges API for 83 minutes). Service availability dipped to 99.81% for the month.',
        incidentTimeline:
          '- 14:05 UTC: Deployment deploy-prod-9821 applied to US-East production cluster.\n- 14:15 UTC: CloudWatch alert triggers for 504 Gateway Timeout spike.\n- 14:19 UTC: Incident acknowledged by SRE on-call (Alex Chen).\n- 14:40 UTC: Lead Backend Engineer (Elena Rostova) isolates root cause to PR #412 pool parameters.\n- 14:47 UTC: Rollback deployment initiated.\n- 15:38 UTC: Nominal pool saturation restored.\n- 15:42 UTC: Incident marked RESOLVED.',
        rootCause:
          'PR #412 reduced the database idle connection timeout to 200ms to conserve idle connections. Under sustained 1,800 req/s traffic, connection teardown and reconnection thrashing caused the PostgreSQL connection broker to exceed the max_connections limit, hanging all subsequent connection acquisitions.',
        contributingFactors:
          '- Staging environment did not replicate production-scale concurrent request volume.\n- Missing automated lint guard on database pool configuration parameters.\n- Health check endpoint was hitting database pool instead of isolated ping.',
        detection:
          'Detected by synthetic health check monitor after 4 minutes of elevated 504 response rate.',
        resolution:
          'Rolled back payment-gateway to deployment deploy-prod-9820, restoring idle timeout to 30,000ms and minPool to 20.',
        wentWell:
          '- Rapid acknowledgement within 4 minutes of threshold alert.\n- Automated correlation engine instantly pinpointed culprit GitHub deployment.\n- Rollback deployment completed cleanly without database schema conflicts.',
        wentWrong:
          '- Load test gates did not catch connection thrashing prior to production merge.\n- On-call engineer had to manually query pg_stat_activity to confirm connection lockup.',
        providerName: 'openai',
        modelName: 'gpt-4o',
        promptTokens: 2150,
        completionTokens: 890,
        totalTokens: 3040,
        latencyMs: 1920,
      },
    });

    // Action Items
    await prisma.actionItem.createMany({
      data: [
        {
          organizationId: org.id,
          postmortemId: postmortem1.id,
          postmortemVersionId: pmVersion1.id,
          incidentId: inc1.id,
          title: 'Add Zod validation schema guard for database pool parameters in CI',
          description: 'Prevent any PR from merging with idleTimeout < 10000ms or minPool < 5.',
          status: ActionItemStatus.COMPLETED,
          priority: ActionItemPriority.CRITICAL,
          assigneeId: demoResponder.id,
          createdById: demoAdmin.id,
          dueDate: daysAgo(2),
        },
        {
          organizationId: org.id,
          postmortemId: postmortem1.id,
          postmortemVersionId: pmVersion1.id,
          incidentId: inc1.id,
          title: 'Isolate health check endpoint from main database pool',
          description: 'Use a lightweight Redis ping or dedicated low-priority connection for pod liveness probes.',
          status: ActionItemStatus.IN_PROGRESS,
          priority: ActionItemPriority.HIGH,
          assigneeId: demoAdmin.id,
          createdById: demoAdmin.id,
          dueDate: daysAgo(-3),
        },
        {
          organizationId: org.id,
          postmortemId: postmortem1.id,
          postmortemVersionId: pmVersion1.id,
          incidentId: inc1.id,
          title: 'Implement synthetic load testing step in PR merge pipeline',
          description: 'Simulate 2,000 req/s peak concurrency on staging prior to production promote.',
          status: ActionItemStatus.OPEN,
          priority: ActionItemPriority.MEDIUM,
          assigneeId: demoResponder.id,
          createdById: demoAdmin.id,
          dueDate: daysAgo(-7),
        },
      ],
    });

    // Replay Run for INC-1
    const replayRun = await prisma.replayRun.create({
      data: {
        organizationId: org.id,
        incidentId: inc1.id,
        triggerType: ReplayTriggerType.AUTOMATIC_INCIDENT_RESOLVED,
        status: ReplayRunStatus.COMPLETED,
        windowStart: inc1Detected,
        windowEnd: inc1Resolved,
        totalEventCount: 5,
        triggeredById: demoAdmin.id,
        startedAt: new Date(inc1Resolved.getTime() + 10000),
        completedAt: new Date(inc1Resolved.getTime() + 12000),
      },
    });

    await prisma.replayEvent.createMany({
      data: [
        {
          replayRunId: replayRun.id,
          incidentId: inc1.id,
          organizationId: org.id,
          sequenceIndex: 1,
          category: ReplayCategory.STATE_CHANGE,
          eventType: 'INCIDENT_CREATED',
          sourceEventId: 'event:1:INCIDENT_CREATED',
          title: 'SEV-1 Incident Declared',
          description: 'System alert triggered by 504 Gateway Timeout spike.',
          timestamp: inc1Detected,
        },
        {
          replayRunId: replayRun.id,
          incidentId: inc1.id,
          organizationId: org.id,
          sequenceIndex: 2,
          category: ReplayCategory.TELEMETRY,
          eventType: 'GITHUB_DEPLOYMENT',
          sourceEventId: 'event:2:GITHUB_DEPLOYMENT',
          title: 'Correlated Deployment Identified',
          description: 'deploy-prod-9821 flagged with 94% confidence.',
          timestamp: new Date(inc1Detected.getTime() + 6 * 60000),
        },
        {
          replayRunId: replayRun.id,
          incidentId: inc1.id,
          organizationId: org.id,
          sequenceIndex: 3,
          category: ReplayCategory.COMMUNICATION,
          eventType: 'TEAM_DIAGNOSIS',
          sourceEventId: 'event:3:TEAM_DIAGNOSIS',
          title: 'Root Cause Identified in Pool Configuration',
          description: 'Elena Rostova confirmed PR #412 connection timeout thrashing.',
          timestamp: new Date(inc1Detected.getTime() + 25 * 60000),
        },
        {
          replayRunId: replayRun.id,
          incidentId: inc1.id,
          organizationId: org.id,
          sequenceIndex: 4,
          category: ReplayCategory.STATE_CHANGE,
          eventType: 'MITIGATION_STARTED',
          sourceEventId: 'event:4:MITIGATION_STARTED',
          title: 'Hotfix Rollback Executed',
          description: 'Rolled back payment-gateway to previous stable build.',
          timestamp: new Date(inc1Detected.getTime() + 42 * 60000),
        },
        {
          replayRunId: replayRun.id,
          incidentId: inc1.id,
          organizationId: org.id,
          sequenceIndex: 5,
          category: ReplayCategory.STATE_CHANGE,
          eventType: 'INCIDENT_RESOLVED',
          sourceEventId: 'event:5:INCIDENT_RESOLVED',
          title: 'Incident Resolved & Verified',
          description: 'Metrics returned to nominal 14% pool saturation.',
          timestamp: inc1Resolved,
        },
      ],
    });

    // Analytics Snapshots
    const thirtyDaysAgo = daysAgo(30);
    const sevenDaysAgo = daysAgo(7);

    await prisma.analyticsSnapshot.upsert({
      where: {
        organizationId_timeWindow_periodStart_periodEnd: {
          organizationId: org.id,
          timeWindow: '30d',
          periodStart: thirtyDaysAgo,
          periodEnd: new Date(now),
        },
      },
      update: {
        totalIncidents: 7,
        sev1Count: 1,
        sev2Count: 2,
        sev3Count: 2,
        sev4Count: 2,
        mttdMs: 4.2 * 60 * 1000,
        mttrMs: 78.5 * 60 * 1000,
        cfrPercent: 12.5,
      },
      create: {
        organizationId: org.id,
        timeWindow: '30d',
        periodStart: thirtyDaysAgo,
        periodEnd: new Date(now),
        totalIncidents: 7,
        sev1Count: 1,
        sev2Count: 2,
        sev3Count: 2,
        sev4Count: 2,
        mttdMs: 4.2 * 60 * 1000,
        mttrMs: 78.5 * 60 * 1000,
        cfrPercent: 12.5,
        metricsJson: {
          trend: 'improving',
          activeIncidents: 2,
          resolvedIncidents: 5,
        },
      },
    });

    await prisma.analyticsSnapshot.upsert({
      where: {
        organizationId_timeWindow_periodStart_periodEnd: {
          organizationId: org.id,
          timeWindow: '7d',
          periodStart: sevenDaysAgo,
          periodEnd: new Date(now),
        },
      },
      update: {
        totalIncidents: 5,
        sev1Count: 1,
        sev2Count: 2,
        sev3Count: 1,
        sev4Count: 1,
        mttdMs: 3.8 * 60 * 1000,
        mttrMs: 65.0 * 60 * 1000,
        cfrPercent: 14.2,
      },
      create: {
        organizationId: org.id,
        timeWindow: '7d',
        periodStart: sevenDaysAgo,
        periodEnd: new Date(now),
        totalIncidents: 5,
        sev1Count: 1,
        sev2Count: 2,
        sev3Count: 1,
        sev4Count: 1,
        mttdMs: 3.8 * 60 * 1000,
        mttrMs: 65.0 * 60 * 1000,
        cfrPercent: 14.2,
        metricsJson: {
          trend: 'stable',
          activeIncidents: 2,
          resolvedIncidents: 3,
        },
      },
    });
  }

  return {
    message: 'Demo dataset seeded successfully across all organizations!',
    organizations: targetOrgs.map((o) => o.name),
    incidentsCreated: totalIncidentsCreated,
  };
}
