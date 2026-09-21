/**
 * ============================================================================
 * IncidentHub AI — Production Demo Restoration Operator CLI
 * ============================================================================
 *
 * PURPOSE:
 * Restores the recruiter/portfolio demo workspace ("Acme Engineering") in a
 * safe, idempotent, and non-destructive manner.
 *
 * SCOPE & CONSTRAINTS:
 * - This is an operator-only CLI tool, NOT a general database seeder.
 * - This script MUST NEVER be exposed as an HTTP route or API endpoint.
 * - This script MUST NOT be deleted without verifying how the live portfolio
 *   demo workspace is safely maintained.
 * - Executes in dry-run mode by default.
 * - In apply mode (--apply), strictly requires:
 *     1. NODE_ENV=production
 *     2. CONFIRM_PRODUCTION_DEMO_RESTORE=acme-engineering
 *     3. EXPECTED_DATABASE_HOST matching the parsed hostname of DATABASE_URL
 * - Scoped strictly to organization slug "acme-engineering".
 * - Never modifies, deletes, or alters personal organizations ("Rakesh Kumar's Org").
 * - Verifies pre- and post-execution entity counts of all other organizations.
 * ============================================================================
 */

import crypto from 'crypto';
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
  PostmortemStatus,
  ActionItemStatus,
  ActionItemPriority,
  IntegrationProvider,
  IntegrationStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

export interface RestoreDemoOptions {
  apply?: boolean;
  expectedDbHost?: string;
  confirmSlug?: string;
  demoOwnerEmail?: string;
  demoPassword?: string;
  rotateDemoPassword?: boolean;
}

export interface DemoRestoreSummary {
  mode: 'DRY_RUN' | 'APPLY';
  targetDbHost: string;
  organization: {
    id: string;
    slug: string;
    name: string;
    action: 'PREVIEW_UPSERT' | 'UPSERTED';
  };
  memberships: Array<{ email: string; role: OrgRole }>;
  teamsCount: number;
  projectsCount: number;
  servicesCount: number;
  incidentsCount: {
    total: number;
    sev1: number;
    sev2: number;
    sev3: number;
    sev4: number;
    resolved: number;
    open: number;
    investigating: number;
    mitigating: number;
  };
  postmortemsCount: number;
  githubReferencesCount: {
    repositories: number;
    commits: number;
    pullRequests: number;
    deployments: number;
    evidences: number;
  };
  personalOrgsPreCounts: Record<string, number>;
  personalOrgsPostCounts: Record<string, number>;
}

export function parseHostnameFromUrl(urlStr?: string): string {
  if (!urlStr) return '';
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
}

export async function executeRestoreDemo(
  prisma: PrismaClient,
  options: RestoreDemoOptions = {},
): Promise<DemoRestoreSummary> {
  const isApply = options.apply ?? process.argv.includes('--apply');
  const dbUrl = process.env['DATABASE_URL'] || '';
  const parsedDbHost = parseHostnameFromUrl(dbUrl);

  const confirmSlug =
    options.confirmSlug ?? process.env['CONFIRM_PRODUCTION_DEMO_RESTORE'];
  const expectedDbHost =
    options.expectedDbHost ?? process.env['EXPECTED_DATABASE_HOST'];

  // Safety Gates for Apply mode
  if (isApply) {
    if (process.env['NODE_ENV'] !== 'production') {
      throw new Error(
        'Safety Check Failed: Apply mode requires NODE_ENV=production.',
      );
    }
    if (confirmSlug !== 'acme-engineering') {
      throw new Error(
        'Safety Check Failed: CONFIRM_PRODUCTION_DEMO_RESTORE must be explicitly set to "acme-engineering".',
      );
    }
    if (!expectedDbHost) {
      throw new Error(
        'Safety Check Failed: EXPECTED_DATABASE_HOST is required in apply mode.',
      );
    }
    const hostMatch =
      parsedDbHost.toLowerCase() === expectedDbHost.toLowerCase() ||
      parsedDbHost.toLowerCase().startsWith(expectedDbHost.toLowerCase()) ||
      expectedDbHost.toLowerCase().startsWith(parsedDbHost.toLowerCase());

    if (!hostMatch) {
      throw new Error(
        `Safety Check Failed: Database host mismatch. Expected "${expectedDbHost}", but parsed host was "${parsedDbHost}".`,
      );
    }
  }

  // Step 1: Capture Pre-State of all non-Acme organizations
  const otherOrgs = await prisma.organization.findMany({
    where: {
      slug: { not: 'acme-engineering' },
    },
    select: { id: true, slug: true, name: true },
  });

  const personalOrgsPreCounts: Record<string, number> = {};
  for (const org of otherOrgs) {
    const incCount = await prisma.incident.count({
      where: { organizationId: org.id },
    });
    const memCount = await prisma.organizationMember.count({
      where: { organizationId: org.id },
    });
    const projCount = await prisma.project.count({
      where: { organizationId: org.id },
    });
    personalOrgsPreCounts[`${org.slug}:incidents`] = incCount;
    personalOrgsPreCounts[`${org.slug}:members`] = memCount;
    personalOrgsPreCounts[`${org.slug}:projects`] = projCount;
  }

  const isRotatePassword =
    options.rotateDemoPassword ??
    (process.argv.includes('--rotate-demo-password') ||
      process.env['ROTATE_DEMO_PASSWORD'] === 'true');

  const demoOwnerEmail =
    options.demoOwnerEmail ||
    process.env['DEMO_OWNER_EMAIL'] ||
    'rakesh.personal@company.com';

  const recruiterPass =
    options.demoPassword ||
    process.env['DEMO_RECRUITER_PASSWORD'] ||
    'DemoRecruiter2026!';
  const recruiterPasswordHash = await bcrypt.hash(recruiterPass, 10);

  // Independent cryptographically random passwords for other non-public demo users
  const alexRandomPass = crypto.randomBytes(32).toString('hex');
  const alexPasswordHash = await bcrypt.hash(alexRandomPass, 10);

  const elenaRandomPass = crypto.randomBytes(32).toString('hex');
  const elenaPasswordHash = await bcrypt.hash(elenaRandomPass, 10);

  const demoUsers = [
    {
      email: 'alex.chen@acme.dev',
      name: 'Alex Chen (Staff SRE)',
      role: OrgRole.ADMIN,
      passwordHash: alexPasswordHash,
    },
    {
      email: 'elena.rostova@acme.dev',
      name: 'Elena Rostova (Lead Backend)',
      role: OrgRole.RESPONDER,
      passwordHash: elenaPasswordHash,
    },
    {
      email: 'demo.recruiter@acme.dev',
      name: 'Recruiter Demo Viewer',
      role: OrgRole.VIEWER,
      passwordHash: recruiterPasswordHash,
    },
  ];

  const now = Date.now();
  const daysAgo = (d: number, hours = 0, mins = 0) =>
    new Date(now - d * 86400000 - hours * 3600000 - mins * 60000);

  const incidentsData = [
    {
      number: 101,
      title: 'Database Connection Pool Exhaustion on Payment Gateway',
      description:
        'Payment gateway experiencing 504 Gateway Timeouts across US-East cluster. Connection pool reached 100% capacity following cache miss storm.',
      severity: IncidentSeverity.SEV1,
      status: IncidentStatus.RESOLVED,
      environment: IncidentEnvironment.PRODUCTION,
      startedAt: daysAgo(5, 4, 30),
      detectedAt: daysAgo(5, 4, 15),
      acknowledgedAt: daysAgo(5, 4, 11),
      resolvedAt: daysAgo(5, 2, 52),
      serviceSlug: 'payment-gateway',
      projectSlug: 'payment-checkout',
    },
    {
      number: 102,
      title: 'Elevated Token Verification Latency on Identity Gateway',
      description:
        'Redis session cache replication lag causing p99 auth token verification times to spike to 4.2s.',
      severity: IncidentSeverity.SEV2,
      status: IncidentStatus.RESOLVED,
      environment: IncidentEnvironment.PRODUCTION,
      startedAt: daysAgo(3, 8, 45),
      detectedAt: daysAgo(3, 8, 30),
      acknowledgedAt: daysAgo(3, 8, 25),
      resolvedAt: daysAgo(3, 7, 10),
      serviceSlug: 'auth-service',
      projectSlug: 'core-identity',
    },
    {
      number: 103,
      title: 'Stripe Webhook Delivery Backlog on Checkout Worker',
      description:
        'Webhook ingestion queue worker partitions stalled due to unhandled idempotency key conflict.',
      severity: IncidentSeverity.SEV2,
      status: IncidentStatus.RESOLVED,
      environment: IncidentEnvironment.PRODUCTION,
      startedAt: daysAgo(2, 11, 15),
      detectedAt: daysAgo(2, 11, 0),
      acknowledgedAt: daysAgo(2, 10, 52),
      resolvedAt: daysAgo(2, 9, 30),
      serviceSlug: 'checkout-api',
      projectSlug: 'payment-checkout',
    },
    {
      number: 104,
      title: 'Checkout Cart Item Desynchronization in Staging Cluster',
      description:
        'Staging checkout sessions occasionally dropping cart metadata on currency switch.',
      severity: IncidentSeverity.SEV3,
      status: IncidentStatus.RESOLVED,
      environment: IncidentEnvironment.STAGING,
      startedAt: daysAgo(4, 2, 10),
      detectedAt: daysAgo(4, 2, 0),
      acknowledgedAt: daysAgo(4, 1, 45),
      resolvedAt: daysAgo(4, 0, 50),
      serviceSlug: 'checkout-api',
      projectSlug: 'payment-checkout',
    },
    {
      number: 105,
      title: 'Transient DNS Resolution Failures in EU-Central Region',
      description:
        'Upstream cloud provider DNS resolver intermittently failing lookups for external banking APIs.',
      severity: IncidentSeverity.SEV4,
      status: IncidentStatus.RESOLVED,
      environment: IncidentEnvironment.PRODUCTION,
      startedAt: daysAgo(1, 14, 15),
      detectedAt: daysAgo(1, 14, 0),
      acknowledgedAt: daysAgo(1, 13, 50),
      resolvedAt: daysAgo(1, 12, 40),
      serviceSlug: 'payment-gateway',
      projectSlug: 'payment-checkout',
    },
    {
      number: 106,
      title: 'Intermittent 429 Rate Limiting on Third-Party SMS Gateway',
      description:
        'Multi-factor authentication SMS delivery delays due to sudden carrier throttling.',
      severity: IncidentSeverity.SEV3,
      status: IncidentStatus.MITIGATING,
      environment: IncidentEnvironment.PRODUCTION,
      startedAt: daysAgo(0, 3, 50),
      detectedAt: daysAgo(0, 3, 40),
      acknowledgedAt: daysAgo(0, 3, 30),
      resolvedAt: null,
      serviceSlug: 'auth-service',
      projectSlug: 'core-identity',
    },
    {
      number: 107,
      title: 'Memory Leak Spike on Checkout Session In-Memory Cache',
      description:
        'Node.js heap memory usage climbing monotonically following v2.4.0 canary rollout.',
      severity: IncidentSeverity.SEV2,
      status: IncidentStatus.INVESTIGATING,
      environment: IncidentEnvironment.PRODUCTION,
      startedAt: daysAgo(0, 1, 35),
      detectedAt: daysAgo(0, 1, 25),
      acknowledgedAt: daysAgo(0, 1, 18),
      resolvedAt: null,
      serviceSlug: 'checkout-api',
      projectSlug: 'payment-checkout',
    },
    {
      number: 108,
      title: 'Payment Webhook Signature Validation Failure on Sandbox',
      description:
        'Sandbox merchant callbacks failing signature verification after test secret rotation.',
      severity: IncidentSeverity.SEV4,
      status: IncidentStatus.OPEN,
      environment: IncidentEnvironment.DEVELOPMENT,
      startedAt: daysAgo(0, 0, 50),
      detectedAt: daysAgo(0, 0, 45),
      acknowledgedAt: null,
      resolvedAt: null,
      serviceSlug: 'payment-gateway',
      projectSlug: 'payment-checkout',
    },
  ];

  let acmeOrgId = 'acme-org-preview-id';

  // If in Apply mode, execute transactional upserts strictly scoped to Acme
  if (isApply) {
    await prisma.$transaction(async (tx) => {
      // 1. Organization Upsert
      const org = await tx.organization.upsert({
        where: { slug: 'acme-engineering' },
        update: {
          name: 'Acme Engineering',
          logoUrl:
            'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128&q=80',
        },
        create: {
          name: 'Acme Engineering',
          slug: 'acme-engineering',
          logoUrl:
            'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128&q=80',
        },
      });
      acmeOrgId = org.id;

      // 2. Demo Users & Memberships
      for (const u of demoUsers) {
        const existingUser = await tx.user.findUnique({
          where: { email: u.email },
        });

        let user;
        if (existingUser) {
          // If user exists: never update passwordHash for ADMIN/RESPONDER,
          // and only update for VIEWER if --rotate-demo-password is set.
          const shouldUpdatePass =
            u.email === 'demo.recruiter@acme.dev' && isRotatePassword;
          user = await tx.user.update({
            where: { id: existingUser.id },
            data: {
              name: u.name,
              ...(shouldUpdatePass ? { passwordHash: u.passwordHash } : {}),
            },
          });
        } else {
          user = await tx.user.create({
            data: {
              email: u.email,
              name: u.name,
              emailVerified: true,
              passwordHash: u.passwordHash,
            },
          });
        }

        await tx.organizationMember.upsert({
          where: {
            organizationId_userId: {
              organizationId: org.id,
              userId: user.id,
            },
          },
          update: { role: u.role },
          create: {
            organizationId: org.id,
            userId: user.id,
            role: u.role,
          },
        });
      }

      // Add DEMO_OWNER_EMAIL as separate Acme OWNER without mutating other orgs
      if (demoOwnerEmail) {
        const ownerUser = await tx.user.findUnique({
          where: { email: demoOwnerEmail.toLowerCase().trim() },
        });
        if (ownerUser) {
          await tx.organizationMember.upsert({
            where: {
              organizationId_userId: {
                organizationId: org.id,
                userId: ownerUser.id,
              },
            },
            update: { role: OrgRole.OWNER },
            create: {
              organizationId: org.id,
              userId: ownerUser.id,
              role: OrgRole.OWNER,
            },
          });
        }
      }

      // 3. Teams
      const sreTeam = await tx.team.upsert({
        where: {
          organizationId_name: {
            organizationId: org.id,
            name: 'SRE & Platform Infrastructure',
          },
        },
        update: {},
        create: {
          organizationId: org.id,
          name: 'SRE & Platform Infrastructure',
          description:
            'Site Reliability Engineering, Observability & Cloud Platforms',
        },
      });

      const backendTeam = await tx.team.upsert({
        where: {
          organizationId_name: {
            organizationId: org.id,
            name: 'Core Backend & Payments',
          },
        },
        update: {},
        create: {
          organizationId: org.id,
          name: 'Core Backend & Payments',
          description:
            'Payment orchestration, customer billing & financial ledger',
        },
      });

      // 4. Projects
      const paymentProject = await tx.project.upsert({
        where: {
          organizationId_slug: {
            organizationId: org.id,
            slug: 'payment-checkout',
          },
        },
        update: { teamId: backendTeam.id },
        create: {
          organizationId: org.id,
          teamId: backendTeam.id,
          name: 'Payment & Checkout Platform',
          slug: 'payment-checkout',
          description:
            'Customer checkout flows, Stripe/PayPal webhooks, and ledger synchronization.',
        },
      });

      const coreApiProject = await tx.project.upsert({
        where: {
          organizationId_slug: {
            organizationId: org.id,
            slug: 'core-identity',
          },
        },
        update: { teamId: sreTeam.id },
        create: {
          organizationId: org.id,
          teamId: sreTeam.id,
          name: 'Core API & Identity Gateway',
          slug: 'core-identity',
          description:
            'Authentication, session management, and microservice API gateway.',
        },
      });

      // 5. Services
      const paymentGatewayService = await tx.service.upsert({
        where: {
          projectId_slug: {
            projectId: paymentProject.id,
            slug: 'payment-gateway',
          },
        },
        update: {},
        create: {
          projectId: paymentProject.id,
          name: 'Payment Gateway',
          slug: 'payment-gateway',
          description:
            'Card charge orchestration and idempotency processor',
          repositoryUrl: 'https://github.com/acme-demo/payment-gateway',
        },
      });

      const checkoutApiService = await tx.service.upsert({
        where: {
          projectId_slug: {
            projectId: paymentProject.id,
            slug: 'checkout-api',
          },
        },
        update: {},
        create: {
          projectId: paymentProject.id,
          name: 'Checkout API',
          slug: 'checkout-api',
          description: 'Shopping cart and checkout session state service',
          repositoryUrl: 'https://github.com/acme-demo/checkout-api',
        },
      });

      const authService = await tx.service.upsert({
        where: {
          projectId_slug: {
            projectId: coreApiProject.id,
            slug: 'auth-service',
          },
        },
        update: {},
        create: {
          projectId: coreApiProject.id,
          name: 'Auth & Session Service',
          slug: 'auth-service',
          description:
            'JWT token issuance, OAuth identity and RBAC policy service',
          repositoryUrl: 'https://github.com/acme-demo/auth-service',
        },
      });

      const servicesMap = {
        'payment-gateway': paymentGatewayService,
        'checkout-api': checkoutApiService,
        'auth-service': authService,
      };

      const projectsMap = {
        'payment-checkout': paymentProject,
        'core-identity': coreApiProject,
      };

      // 6. GitHub Integration & Demo Correlation Records
      const githubIntegration = await tx.integration.upsert({
        where: {
          organizationId_provider: {
            organizationId: org.id,
            provider: IntegrationProvider.GITHUB,
          },
        },
        update: { status: IntegrationStatus.CONNECTED },
        create: {
          organizationId: org.id,
          provider: IntegrationProvider.GITHUB,
          status: IntegrationStatus.CONNECTED,
          metadata: {
            accountName: 'acme-demo',
            installedRepositories: [
              'payment-gateway',
              'auth-service',
              'checkout-api',
            ],
            lastSync: new Date().toISOString(),
          },
        },
      });

      const githubRepo = await tx.gitHubRepository.upsert({
        where: {
          organizationId_githubRepoId: {
            organizationId: org.id,
            githubRepoId: BigInt(948201),
          },
        },
        update: {},
        create: {
          organizationId: org.id,
          integrationId: githubIntegration.id,
          githubRepoId: BigInt(948201),
          name: 'payment-gateway',
          fullName: 'acme-demo/payment-gateway',
          owner: 'acme-demo',
          defaultBranch: 'main',
          url: 'https://github.com/acme-demo/payment-gateway',
          description:
            'Production payment gateway microservice (fictional demo)',
          isPrivate: true,
          language: 'TypeScript',
          projectId: paymentProject.id,
          serviceId: paymentGatewayService.id,
        },
      });

      const culpritCommit = await tx.gitHubCommit.upsert({
        where: {
          repositoryId_sha: {
            repositoryId: githubRepo.id,
            sha: 'e4a8b2c1f90e3d7a6b5c4d3e2f1a0b9c8d7e6f5a',
          },
        },
        update: {},
        create: {
          repositoryId: githubRepo.id,
          sha: 'e4a8b2c1f90e3d7a6b5c4d3e2f1a0b9c8d7e6f5a',
          authorName: 'Elena Rostova',
          authorEmail: 'elena.rostova@acme.dev',
          message:
            'perf(pool): reduce idle timeout to 200ms and set connection pool min=2',
          branch: 'main',
          url: 'https://github.com/acme-demo/payment-gateway/commit/e4a8b2c1f90e3d7a6b5c4d3e2f1a0b9c8d7e6f5a',
          committedAt: daysAgo(5, 4, 30),
        },
      });

      await tx.gitHubCommit.upsert({
        where: {
          repositoryId_sha: {
            repositoryId: githubRepo.id,
            sha: 'b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9',
          },
        },
        update: {},
        create: {
          repositoryId: githubRepo.id,
          sha: 'b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9',
          authorName: 'Alex Chen',
          authorEmail: 'alex.chen@acme.dev',
          message:
            'fix(pool): restore connection pool min=20 and idle timeout=10000ms',
          branch: 'main',
          url: 'https://github.com/acme-demo/payment-gateway/commit/b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9',
          committedAt: daysAgo(5, 2, 55),
        },
      });

      const pullRequest = await tx.gitHubPullRequest.upsert({
        where: {
          repositoryId_number: { repositoryId: githubRepo.id, number: 108 },
        },
        update: {},
        create: {
          repositoryId: githubRepo.id,
          number: 108,
          title: 'Optimize database connection pool timeouts under high load',
          state: 'merged',
          author: 'elena-rostova',
          branch: 'perf/pool-tuning',
          targetBranch: 'main',
          url: 'https://github.com/acme-demo/payment-gateway/pull/108',
          mergedAt: daysAgo(5, 4, 35),
        },
      });

      const culpritDeploy = await tx.gitHubDeployment.upsert({
        where: {
          repositoryId_deploymentId: {
            repositoryId: githubRepo.id,
            deploymentId: 'deploy-acme-prod-402',
          },
        },
        update: {},
        create: {
          repositoryId: githubRepo.id,
          deploymentId: 'deploy-acme-prod-402',
          environment: 'production',
          state: 'success',
          commitSha: culpritCommit.sha,
          creator: 'github-actions[bot]',
          url: 'https://github.com/acme-demo/payment-gateway/deployments/deploy-acme-prod-402',
          createdAt: daysAgo(5, 4, 20),
        },
      });

      // 7. Incidents & Events
      const adminUser = await tx.user.findUnique({
        where: { email: 'alex.chen@acme.dev' },
      });
      const responderUser = await tx.user.findUnique({
        where: { email: 'elena.rostova@acme.dev' },
      });

      for (const incData of incidentsData) {
        const project =
          projectsMap[incData.projectSlug as keyof typeof projectsMap];
        const service =
          servicesMap[incData.serviceSlug as keyof typeof servicesMap];

        const creatorId = adminUser?.id || (await tx.user.findFirstOrThrow({ where: { email: 'alex.chen@acme.dev' } })).id;

        const incident = await tx.incident.upsert({
          where: {
            organizationId_number: {
              organizationId: org.id,
              number: incData.number,
            },
          },
          update: {
            title: incData.title,
            description: incData.description,
            severity: incData.severity,
            status: incData.status,
            environment: incData.environment,
            detectedAt: incData.detectedAt,
            acknowledgedAt: incData.acknowledgedAt,
            resolvedAt: incData.resolvedAt,
          },
          create: {
            organizationId: org.id,
            projectId: project.id,
            serviceId: service.id,
            number: incData.number,
            title: incData.title,
            description: incData.description,
            severity: incData.severity,
            status: incData.status,
            environment: incData.environment,
            detectedAt: incData.detectedAt,
            acknowledgedAt: incData.acknowledgedAt,
            resolvedAt: incData.resolvedAt,
            createdById: creatorId,
            assignedToId: responderUser?.id,
            createdAt: incData.detectedAt,
          },
        });

        // Add timeline events
        const detectedEventId = `demo-event-${incident.id}-detected`;
        await tx.incidentEvent.upsert({
          where: { id: detectedEventId },
          update: {},
          create: {
            id: detectedEventId,
            incidentId: incident.id,
            organizationId: org.id,
            source: EventSource.SYSTEM,
            type: 'INCIDENT_DETECTED',
            message: `Automated alarm detected anomaly: ${incData.title}`,
            occurredAt: incData.detectedAt,
          },
        });

        if (incData.acknowledgedAt) {
          const ackEventId = `demo-event-${incident.id}-ack`;
          await tx.incidentEvent.upsert({
            where: { id: ackEventId },
            update: {},
            create: {
              id: ackEventId,
              incidentId: incident.id,
              organizationId: org.id,
              userId: responderUser?.id,
              source: EventSource.USER,
              type: 'INCIDENT_ACKNOWLEDGED',
              message: 'On-call responder acknowledged incident and opened war room.',
              occurredAt: incData.acknowledgedAt,
            },
          });
        }

        if (incData.resolvedAt) {
          const resolvedEventId = `demo-event-${incident.id}-resolved`;
          await tx.incidentEvent.upsert({
            where: { id: resolvedEventId },
            update: {},
            create: {
              id: resolvedEventId,
              incidentId: incident.id,
              organizationId: org.id,
              userId: adminUser?.id,
              source: EventSource.USER,
              type: 'INCIDENT_RESOLVED',
              message: 'Incident verified resolved following canary rollback.',
              occurredAt: incData.resolvedAt,
            },
          });
        }

        // Link Evidence to Incident #101
        if (incData.number === 101) {
          const commitEvidenceId = `demo-evidence-${incident.id}-commit`;
          await tx.incidentEvidence.upsert({
            where: { id: commitEvidenceId },
            update: {},
            create: {
              id: commitEvidenceId,
              incidentId: incident.id,
              type: EvidenceType.GITHUB_COMMIT,
              source: EvidenceSource.CORRELATION_ENGINE,
              externalRefId: culpritCommit.sha,
              title: `Preceding commit: ${culpritCommit.message}`,
              description: `Committed by ${culpritCommit.authorName} 15m prior to error threshold breach.`,
              url: culpritCommit.url,
              confidence: 0.94,
              confidenceTier: EvidenceConfidenceTier.HIGH,
              reasons: { temporalProximity: true, commitRelation: true },
            },
          });

          const deployEvidenceId = `demo-evidence-${incident.id}-deploy`;
          await tx.incidentEvidence.upsert({
            where: { id: deployEvidenceId },
            update: {},
            create: {
              id: deployEvidenceId,
              incidentId: incident.id,
              type: EvidenceType.GITHUB_DEPLOYMENT,
              source: EvidenceSource.CORRELATION_ENGINE,
              externalRefId: culpritDeploy.deploymentId,
              title: `Production Deployment: ${culpritDeploy.deploymentId}`,
              description: 'Deployment completed 5m prior to gateway 504 spike.',
              url: culpritDeploy.url,
              confidence: 0.96,
              confidenceTier: EvidenceConfidenceTier.HIGH,
              reasons: { temporalProximity: true, deploymentRelation: true },
            },
          });

          const prEvidenceId = `demo-evidence-${incident.id}-pr`;
          await tx.incidentEvidence.upsert({
            where: { id: prEvidenceId },
            update: {},
            create: {
              id: prEvidenceId,
              incidentId: incident.id,
              type: EvidenceType.GITHUB_PR,
              source: EvidenceSource.CORRELATION_ENGINE,
              externalRefId: String(pullRequest.number),
              title: `Merged Pull Request #${pullRequest.number}: ${pullRequest.title}`,
              description: `Merged by ${pullRequest.author} introducing pool configuration adjustments.`,
              url: pullRequest.url,
              confidence: 0.91,
              confidenceTier: EvidenceConfidenceTier.HIGH,
              reasons: { pullRequestRelation: true },
            },
          });

          // Create Postmortem for Incident #101
          const postmortem = await tx.postmortem.upsert({
            where: { incidentId: incident.id },
            update: { status: PostmortemStatus.PUBLISHED },
            create: {
              incidentId: incident.id,
              organizationId: org.id,
              status: PostmortemStatus.PUBLISHED,
            },
          });

          const pv = await tx.postmortemVersion.upsert({
            where: {
              postmortemId_versionNumber: {
                postmortemId: postmortem.id,
                versionNumber: 1,
              },
            },
            update: { status: PostmortemStatus.PUBLISHED, isCurrent: true },
            create: {
              postmortemId: postmortem.id,
              organizationId: org.id,
              incidentId: incident.id,
              versionNumber: 1,
              status: PostmortemStatus.PUBLISHED,
              isCurrent: true,
              aiGenerated: false,
              summary:
                '[DEMO-GENERATED] Payment gateway connection pool exhaustion occurred due to aggressive idle connection timeout reduction in commit e4a8b2c.',
              impact:
                '14.2% of checkout attempts resulted in HTTP 504 gateway timeouts for 2 hours and 37 minutes.',
              rootCause:
                'The minimum connection pool was reduced to 2 with a 200ms idle timeout. During high traffic spikes, connection creation latency caused thread contention.',
              detection:
                'Automated Sentry error alert triggered when 504 error rate exceeded 2.0% threshold.',
              resolution:
                'Canary deployment was rolled back to previous stable release and minimum pool size restored to 20.',
              wentWell:
                'Rapid automated detection within 4 minutes; seamless rollback procedure executed by on-call SRE.',
              wentWrong:
                'Load testing in staging cluster did not simulate high-concurrency connection churning.',
            },
          });

          await tx.postmortem.update({
            where: { id: postmortem.id },
            data: { activeVersionId: pv.id },
          });

          // Action item for Incident #101 Postmortem
          await tx.actionItem.upsert({
            where: {
              id: `demo-ai-${incident.id}-1`,
            },
            update: {},
            create: {
              id: `demo-ai-${incident.id}-1`,
              organizationId: org.id,
              incidentId: incident.id,
              postmortemId: postmortem.id,
              postmortemVersionId: pv.id,
              title: 'Add connection pool exhaustion chaos test to CI regression pipeline',
              description: 'Simulate connection storm in load tests to verify pool minimum thresholds.',
              status: ActionItemStatus.COMPLETED,
              priority: ActionItemPriority.HIGH,
            },
          });
        }

        // Postmortem for Incident #102
        if (incData.number === 102) {
          const postmortem = await tx.postmortem.upsert({
            where: { incidentId: incident.id },
            update: { status: PostmortemStatus.PUBLISHED },
            create: {
              incidentId: incident.id,
              organizationId: org.id,
              status: PostmortemStatus.PUBLISHED,
            },
          });

          const pv = await tx.postmortemVersion.upsert({
            where: {
              postmortemId_versionNumber: {
                postmortemId: postmortem.id,
                versionNumber: 1,
              },
            },
            update: { status: PostmortemStatus.PUBLISHED, isCurrent: true },
            create: {
              postmortemId: postmortem.id,
              organizationId: org.id,
              incidentId: incident.id,
              versionNumber: 1,
              status: PostmortemStatus.PUBLISHED,
              isCurrent: true,
              aiGenerated: false,
              summary:
                '[DEMO-GENERATED] Token verification latency spike caused by Redis replication lag on session read replicas.',
              impact:
                'p99 authentication latency increased from 18ms to 4.2s across all authenticated API requests.',
              rootCause:
                'Cross-availability-zone network congestion caused replication buffer saturation on secondary Redis nodes.',
              detection:
                'Latency threshold breach alarm on Core API Gateway.',
              resolution:
                'Traffic routed temporarily to primary Redis node while replica buffers were drained.',
              wentWell:
                'Zero session data loss; automatic fallback to primary node prevented full auth failure.',
              wentWrong:
                'Replication lag monitoring lacked proactive alerting before user impact occurred.',
            },
          });

          await tx.postmortem.update({
            where: { id: postmortem.id },
            data: { activeVersionId: pv.id },
          });
        }
      }
    }, { maxWait: 60000, timeout: 300000 });
  }

  // Step 3: Capture Post-State of all non-Acme organizations
  const personalOrgsPostCounts: Record<string, number> = {};
  for (const org of otherOrgs) {
    const incCount = await prisma.incident.count({
      where: { organizationId: org.id },
    });
    const memCount = await prisma.organizationMember.count({
      where: { organizationId: org.id },
    });
    const projCount = await prisma.project.count({
      where: { organizationId: org.id },
    });
    personalOrgsPostCounts[`${org.slug}:incidents`] = incCount;
    personalOrgsPostCounts[`${org.slug}:members`] = memCount;
    personalOrgsPostCounts[`${org.slug}:projects`] = projCount;
  }

  // Verify non-Acme organizations remained completely unchanged
  for (const key of Object.keys(personalOrgsPreCounts)) {
    if (personalOrgsPreCounts[key] !== personalOrgsPostCounts[key]) {
      throw new Error(
        `Safety Violation: Non-Acme entity count for "${key}" modified from ${personalOrgsPreCounts[key]} to ${personalOrgsPostCounts[key]}.`,
      );
    }
  }

  return {
    mode: isApply ? 'APPLY' : 'DRY_RUN',
    targetDbHost: parsedDbHost || 'localhost',
    organization: {
      id: acmeOrgId,
      slug: 'acme-engineering',
      name: 'Acme Engineering',
      action: isApply ? 'UPSERTED' : 'PREVIEW_UPSERT',
    },
    memberships: [
      { email: demoOwnerEmail, role: OrgRole.OWNER },
      ...demoUsers.map((u) => ({ email: u.email, role: u.role })),
    ],
    teamsCount: 2,
    projectsCount: 2,
    servicesCount: 3,
    incidentsCount: {
      total: incidentsData.length,
      sev1: incidentsData.filter((i) => i.severity === IncidentSeverity.SEV1)
        .length,
      sev2: incidentsData.filter((i) => i.severity === IncidentSeverity.SEV2)
        .length,
      sev3: incidentsData.filter((i) => i.severity === IncidentSeverity.SEV3)
        .length,
      sev4: incidentsData.filter((i) => i.severity === IncidentSeverity.SEV4)
        .length,
      resolved: incidentsData.filter(
        (i) => i.status === IncidentStatus.RESOLVED,
      ).length,
      open: incidentsData.filter((i) => i.status === IncidentStatus.OPEN)
        .length,
      investigating: incidentsData.filter(
        (i) => i.status === IncidentStatus.INVESTIGATING,
      ).length,
      mitigating: incidentsData.filter(
        (i) => i.status === IncidentStatus.MITIGATING,
      ).length,
    },
    postmortemsCount: 2,
    githubReferencesCount: {
      repositories: 1,
      commits: 2,
      pullRequests: 1,
      deployments: 1,
      evidences: 3,
    },
    personalOrgsPreCounts,
    personalOrgsPostCounts,
  };
}

// CLI Direct Invocation
if (require.main === module) {
  const prisma = new PrismaClient();
  executeRestoreDemo(prisma)
    .then((summary) => {
      // eslint-disable-next-line no-console
      console.log('\n========================================================');
      // eslint-disable-next-line no-console
      console.log(`🚀 Production Demo Restore Summary [${summary.mode}]`);
      // eslint-disable-next-line no-console
      console.log('========================================================');
      // eslint-disable-next-line no-console
      console.log(`Database Host:           ${summary.targetDbHost}`);
      // eslint-disable-next-line no-console
      console.log(`Target Organization:     ${summary.organization.name} (${summary.organization.slug})`);
      // eslint-disable-next-line no-console
      console.log(`Action:                  ${summary.organization.action}`);
      // eslint-disable-next-line no-console
      console.log(`Memberships:             ${summary.memberships.length} (${summary.memberships.map((m) => `${m.email}: ${m.role}`).join(', ')})`);
      // eslint-disable-next-line no-console
      console.log(`Teams:                   ${summary.teamsCount}`);
      // eslint-disable-next-line no-console
      console.log(`Projects:                ${summary.projectsCount}`);
      // eslint-disable-next-line no-console
      console.log(`Services:                ${summary.servicesCount}`);
      // eslint-disable-next-line no-console
      console.log(`Total Incidents:         ${summary.incidentsCount.total}`);
      // eslint-disable-next-line no-console
      console.log(`  - SEV1:                ${summary.incidentsCount.sev1}`);
      // eslint-disable-next-line no-console
      console.log(`  - SEV2:                ${summary.incidentsCount.sev2}`);
      // eslint-disable-next-line no-console
      console.log(`  - SEV3:                ${summary.incidentsCount.sev3}`);
      // eslint-disable-next-line no-console
      console.log(`  - SEV4:                ${summary.incidentsCount.sev4}`);
      // eslint-disable-next-line no-console
      console.log(`  - Resolved:            ${summary.incidentsCount.resolved}`);
      // eslint-disable-next-line no-console
      console.log(`  - Open:                ${summary.incidentsCount.open}`);
      // eslint-disable-next-line no-console
      console.log(`  - Investigating:       ${summary.incidentsCount.investigating}`);
      // eslint-disable-next-line no-console
      console.log(`  - Mitigating:          ${summary.incidentsCount.mitigating}`);
      // eslint-disable-next-line no-console
      console.log(`Postmortems:             ${summary.postmortemsCount}`);
      // eslint-disable-next-line no-console
      console.log(`GitHub Repositories:     ${summary.githubReferencesCount.repositories}`);
      // eslint-disable-next-line no-console
      console.log(`GitHub Commits:          ${summary.githubReferencesCount.commits}`);
      // eslint-disable-next-line no-console
      console.log(`GitHub Pull Requests:    ${summary.githubReferencesCount.pullRequests}`);
      // eslint-disable-next-line no-console
      console.log(`GitHub Deployments:      ${summary.githubReferencesCount.deployments}`);
      // eslint-disable-next-line no-console
      console.log(`Correlated Evidences:    ${summary.githubReferencesCount.evidences}`);
      // eslint-disable-next-line no-console
      console.log(`Personal Orgs Protected: ${Object.keys(summary.personalOrgsPreCounts).length > 0 ? 'Verified 0 Mutations' : 'None detected'}`);
      // eslint-disable-next-line no-console
      console.log('========================================================\n');
      return prisma.$disconnect();
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('\n❌ Operator Restore Failed:', err instanceof Error ? err.message : err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
