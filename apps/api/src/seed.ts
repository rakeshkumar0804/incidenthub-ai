import { PrismaClient, OrgRole, IncidentSeverity, IncidentStatus, IncidentEnvironment } from '@prisma/client';
import crypto from 'crypto';
import { logger } from './utils/logger';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(password, salt, 1000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

async function seedUser() {
  const email = 'rakesh6651@company.com';
  const name = 'Rakesh Rajput';
  const password = 'Password123!';

  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findUnique({ where: { email } });

  let user;
  if (existing) {
    logger.info(`User ${email} exists, updating password hash...`);
    user = await prisma.user.update({
      where: { email },
      data: { passwordHash, emailVerified: true },
    });
  } else {
    logger.info(`Creating user ${email}...`);
    user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        emailVerified: true,
      },
    });
  }

  // Create Organization
  let org = await prisma.organization.findFirst({
    where: { slug: 'rakesh-org' },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: "Rakesh's Org",
        slug: 'rakesh-org',
      },
    });
  }

  // Ensure Organization Membership
  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: user.id,
      },
    },
  });

  if (!member) {
    await prisma.organizationMember.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        role: OrgRole.OWNER,
      },
    });
  } else {
    await prisma.organizationMember.update({
      where: { id: member.id },
      data: { role: OrgRole.OWNER },
    });
  }

  // Create Project & Service
  let project = await prisma.project.findFirst({
    where: { organizationId: org.id, slug: 'payment-platform' },
  });

  if (!project) {
    project = await prisma.project.create({
      data: {
        organizationId: org.id,
        name: 'Payment Platform',
        slug: 'payment-platform',
      },
    });
  }

  let service = await prisma.service.findFirst({
    where: { projectId: project.id, slug: 'checkout-api' },
  });

  if (!service) {
    service = await prisma.service.create({
      data: {
        projectId: project.id,
        name: 'Checkout API Service',
        slug: 'checkout-api',
      },
    });
  }

  // Create Sample Incident
  const existingIncident = await prisma.incident.findFirst({
    where: { organizationId: org.id, number: 1 },
  });

  if (!existingIncident) {
    await prisma.incident.create({
      data: {
        organizationId: org.id,
        projectId: project.id,
        serviceId: service.id,
        number: 1,
        title: 'Elevated 504 Gateway Timeout during Checkout',
        description: 'Payment checkout requests timing out under high load in production.',
        severity: IncidentSeverity.SEV1,
        status: IncidentStatus.INVESTIGATING,
        environment: IncidentEnvironment.PRODUCTION,
        createdById: user.id,
        detectedAt: new Date(),
      },
    });
  }

  logger.info(`✔ User ${email} seeded successfully with password: ${password}`);
}

seedUser()
  .catch((err) => logger.error({ err }, 'Seed script error'))
  .finally(() => prisma.$disconnect());
