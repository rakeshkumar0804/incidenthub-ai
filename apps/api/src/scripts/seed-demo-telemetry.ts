import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { IntegrationProvider, IntegrationStatus } from '@prisma/client';

interface TargetIncident {
  id: string;
  number: number;
  title: string;
  organizationId: string;
  projectId: string;
  serviceId: string | null;
  environment: string;
  detectedAt: Date;
}

export async function seedDemoTelemetry(): Promise<void> {
  logger.info('Starting idempotent demo telemetry seeding for INC-0002 across organizations...');

  // 1. Retrieve all target incidents (number = 2 or title contains Payment / latency / error)
  const rawIncidents = await prisma.incident.findMany({
    where: {
      OR: [
        { number: 2 },
        { title: { contains: 'Payment', mode: 'insensitive' } },
        { title: { contains: 'latency', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      number: true,
      title: true,
      organizationId: true,
      projectId: true,
      serviceId: true,
      environment: true,
      detectedAt: true,
    },
  });

  if (rawIncidents.length === 0) {
    logger.error('No incidents found in database to seed telemetry against');
    return;
  }

  for (const rawInc of rawIncidents) {
    let serviceId = rawInc.serviceId;
    if (!serviceId) {
      const existingService = await prisma.service.findFirst({
        where: { projectId: rawInc.projectId },
        select: { id: true },
      });
      if (!existingService) {
        const newService = await prisma.service.create({
          data: {
            projectId: rawInc.projectId,
            name: 'Payment API Service',
            slug: `payment-api-service-${Date.now()}`,
            description: 'Core Payment Processing REST API Service',
          },
          select: { id: true },
        });
        serviceId = newService.id;
      } else {
        serviceId = existingService.id;
      }

      await prisma.incident.update({
        where: { id: rawInc.id },
        data: { serviceId },
      });
    }

    const targetIncident: TargetIncident = {
      ...rawInc,
      serviceId,
    };

    logger.info(
      {
        incidentId: targetIncident.id,
        number: targetIncident.number,
        title: targetIncident.title,
        orgId: targetIncident.organizationId,
        projectId: targetIncident.projectId,
        serviceId,
        detectedAt: targetIncident.detectedAt,
      },
      'Seeding demo telemetry for incident',
    );

    await seedTelemetryForIncident(targetIncident, serviceId);
  }
}

async function seedTelemetryForIncident(incident: TargetIncident, serviceId: string): Promise<void> {
  const { organizationId, projectId, environment, detectedAt } = incident;

  const targetSha = 'f82a1b9c3e4d5f6a7b8c9d0e1f2a3b4c5d6e7f8a';
  const targetDeploymentId = `deploy-pay-${incident.number}`;
  const targetSentryIssueId = `PAYMENT-API-500-SPIKE-${incident.number}`;
  const repoFullName = `acme/payment-service-${incident.projectId.substring(0, 6)}`;

  // 2. Ensure GitHub Integration & Repository exist
  let githubIntegration = await prisma.integration.findFirst({
    where: { organizationId, provider: IntegrationProvider.GITHUB },
    select: { id: true },
  });

  if (!githubIntegration) {
    githubIntegration = await prisma.integration.create({
      data: {
        organizationId,
        provider: IntegrationProvider.GITHUB,
        status: IntegrationStatus.CONNECTED,
        metadata: { installationId: 'demo-install-1001', accountName: 'acme-corp' },
      },
      select: { id: true },
    });
  }

  let repository = await prisma.gitHubRepository.findFirst({
    where: { organizationId, fullName: repoFullName },
    select: { id: true, projectId: true, serviceId: true },
  });

  if (!repository) {
    repository = await prisma.gitHubRepository.create({
      data: {
        integrationId: githubIntegration.id,
        organizationId,
        projectId,
        serviceId,
        githubRepoId: Math.floor(Math.random() * 1000000) + 100000,
        owner: 'acme-corp',
        name: 'payment-service',
        fullName: repoFullName,
        isPrivate: true,
        defaultBranch: 'main',
        url: 'https://github.com/acme/payment-service',
      },
      select: { id: true, projectId: true, serviceId: true },
    });
  } else if (!repository.projectId || repository.serviceId !== serviceId) {
    repository = await prisma.gitHubRepository.update({
      where: { id: repository.id },
      data: { projectId, serviceId },
      select: { id: true, projectId: true, serviceId: true },
    });
  }

  // Timestamps placed inside optimal correlation windows:
  // detectedAt = T
  // Commit at T - 25 minutes
  // Deployment at T - 15 minutes (precursor deployment)
  // Sentry Issue spike lastSeen at T + 5 minutes
  const commitTime = new Date(detectedAt.getTime() - 25 * 60 * 1000);
  const deploymentTime = new Date(detectedAt.getTime() - 15 * 60 * 1000);
  const sentryTime = new Date(detectedAt.getTime() + 5 * 60 * 1000);

  // 3. Create or Update GitHub Commit
  const existingCommit = await prisma.gitHubCommit.findFirst({
    where: { repositoryId: repository.id, sha: targetSha },
    select: { id: true },
  });

  if (!existingCommit) {
    await prisma.gitHubCommit.create({
      data: {
        repositoryId: repository.id,
        sha: targetSha,
        authorName: 'Rakesh Kumar',
        message: 'fix(payment): update gateway socket connection timeout to 300ms',
        branch: 'main',
        url: `https://github.com/acme/payment-service/commit/${targetSha}`,
        committedAt: commitTime,
      },
    });
    logger.info({ sha: targetSha }, '✔ Created GitHub Commit telemetry');
  }

  // 4. Create or Update GitHub Deployment
  const existingDeployment = await prisma.gitHubDeployment.findFirst({
    where: { repositoryId: repository.id, deploymentId: targetDeploymentId },
    select: { id: true },
  });

  if (!existingDeployment) {
    await prisma.gitHubDeployment.create({
      data: {
        repositoryId: repository.id,
        deploymentId: targetDeploymentId,
        environment: environment || 'PRODUCTION',
        state: 'success',
        commitSha: targetSha,
        creator: 'Rakesh Kumar',
        url: `https://github.com/acme/payment-service/deployments/${targetDeploymentId}`,
        createdAt: deploymentTime,
      },
    });
    logger.info({ deploymentId: targetDeploymentId }, '✔ Created GitHub Deployment precursor telemetry');
  }

  // 5. Ensure Sentry Integration & Sentry Issue exist
  let sentryIntegration = await prisma.integration.findFirst({
    where: { organizationId, provider: IntegrationProvider.SENTRY },
    select: { id: true },
  });

  if (!sentryIntegration) {
    sentryIntegration = await prisma.integration.create({
      data: {
        organizationId,
        provider: IntegrationProvider.SENTRY,
        status: IntegrationStatus.CONNECTED,
        metadata: { organizationSlug: 'acme-corp' },
      },
      select: { id: true },
    });
  }

  const existingSentry = await prisma.sentryIssue.findFirst({
    where: { organizationId, sentryIssueId: targetSentryIssueId },
    select: { id: true, serviceId: true },
  });

  if (!existingSentry) {
    await prisma.sentryIssue.create({
      data: {
        organizationId,
        integrationId: sentryIntegration.id,
        projectSlug: 'payment-service-prod',
        projectId,
        serviceId,
        sentryIssueId: targetSentryIssueId,
        title: 'HTTP 500: PaymentGatewayConnectionTimeoutException: Connection reset by peer',
        culprit: 'PaymentController.processCharge(payment_service.py:142)',
        level: 'fatal',
        userCount: 42,
        eventCount: 389,
        environment: environment || 'PRODUCTION',
        permalink: 'https://sentry.io/organizations/acme/issues/5928194',
        firstSeen: deploymentTime,
        lastSeen: sentryTime,
      },
    });
    logger.info({ sentryIssueId: targetSentryIssueId }, '✔ Created Sentry Error Issue telemetry');
  } else if (existingSentry.serviceId !== serviceId) {
    await prisma.sentryIssue.update({
      where: { id: existingSentry.id },
      data: { serviceId },
    });
  }

  logger.info({ incidentNumber: incident.number }, '✔ Idempotent demo telemetry seeding completed successfully');
}

async function run(): Promise<void> {
  await seedDemoTelemetry();
  process.exit(0);
}

void run();
