/**
 * IncidentHub AI — Database Seed Script
 *
 * Purpose: Validates that all core entity relationships work correctly.
 * Creates the minimum data needed to verify the schema is coherent.
 *
 * This is a DEVELOPMENT-ONLY validation seed.
 * It does NOT create production-like data.
 *
 * Run: npm run db:seed
 * Reset + reseed: npm run db:reset && npm run db:seed
 */

import { PrismaClient, OrgRole, IncidentSeverity, IncidentStatus, EventSource } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Starting database seed...');

  // Clean existing seed data (idempotent re-runs)
  await prisma.organization.deleteMany({ where: { slug: 'seed-org' } });

  // -------------------------------------------------------------------------
  // 1. User
  // -------------------------------------------------------------------------
  const user = await prisma.user.upsert({
    where: { email: 'seed-owner@incidenthub.dev' },
    update: {},
    create: {
      email: 'seed-owner@incidenthub.dev',
      name: 'Seed Owner',
      emailVerified: true,
      // passwordHash would be set during real auth setup (Phase 2)
    },
  });
  console.log(`  ✔ User created: ${user.email}`);

  // -------------------------------------------------------------------------
  // 2. Organization
  // -------------------------------------------------------------------------
  const org = await prisma.organization.create({
    data: {
      name: 'Seed Organization',
      slug: 'seed-org',
    },
  });
  console.log(`  ✔ Organization created: ${org.slug}`);

  // -------------------------------------------------------------------------
  // 3. Organization membership (user is OWNER)
  // -------------------------------------------------------------------------
  await prisma.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      role: OrgRole.OWNER,
    },
  });
  console.log('  ✔ Organization membership created: OWNER');

  // -------------------------------------------------------------------------
  // 4. Team
  // -------------------------------------------------------------------------
  const team = await prisma.team.create({
    data: {
      organizationId: org.id,
      name: 'SRE',
      description: 'Site Reliability Engineering',
    },
  });
  console.log(`  ✔ Team created: ${team.name}`);

  // -------------------------------------------------------------------------
  // 5. Team membership
  // -------------------------------------------------------------------------
  await prisma.teamMember.create({
    data: {
      teamId: team.id,
      userId: user.id,
    },
  });
  console.log('  ✔ Team membership created');

  // -------------------------------------------------------------------------
  // 6. Project
  // -------------------------------------------------------------------------
  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
      name: 'Payment API',
      slug: 'payment-api',
      description: 'Core payment processing service',
    },
  });
  console.log(`  ✔ Project created: ${project.slug}`);

  // -------------------------------------------------------------------------
  // 7. Service
  // -------------------------------------------------------------------------
  const service = await prisma.service.create({
    data: {
      projectId: project.id,
      name: 'Payment Service',
      slug: 'payment-service',
      description: 'Handles payment transaction processing',
    },
  });
  console.log(`  ✔ Service created: ${service.slug}`);

  // -------------------------------------------------------------------------
  // 8. Incident (validates the full FK chain)
  // -------------------------------------------------------------------------
  const incident = await prisma.incident.create({
    data: {
      organizationId: org.id,
      projectId: project.id,
      serviceId: service.id,
      assigneeId: user.id,
      title: 'Payment service returning 503 errors',
      description: 'Customers are unable to complete checkout. Error rate elevated above threshold.',
      severity: IncidentSeverity.SEV_2,
      status: IncidentStatus.INVESTIGATING,
      startedAt: new Date(),
    },
  });
  console.log(`  ✔ Incident created: ${incident.id} (${incident.severity})`);

  // -------------------------------------------------------------------------
  // 9. Incident Event (validates unified timeline)
  // -------------------------------------------------------------------------
  await prisma.incidentEvent.create({
    data: {
      incidentId: incident.id,
      userId: user.id,
      source: EventSource.SYSTEM,
      type: 'incident_created',
      message: 'Incident declared by seed script',
      metadata: { automated: true, seedScript: true },
    },
  });
  console.log('  ✔ Incident event created');

  // -------------------------------------------------------------------------
  // 10. Comment (validates threading)
  // -------------------------------------------------------------------------
  const comment = await prisma.comment.create({
    data: {
      incidentId: incident.id,
      userId: user.id,
      content: 'Looking into the payment service logs now.',
    },
  });

  await prisma.comment.create({
    data: {
      incidentId: incident.id,
      userId: user.id,
      parentId: comment.id,
      content: 'Found connection pool exhaustion in the logs — related to the deployment 15 min ago.',
    },
  });
  console.log('  ✔ Comments created (with thread reply)');

  // -------------------------------------------------------------------------
  // 11. Integration (stub — validates FK chain)
  // -------------------------------------------------------------------------
  await prisma.integration.create({
    data: {
      organizationId: org.id,
      provider: 'GITHUB',
      status: 'DISCONNECTED',
      metadata: { note: 'Not yet configured — Phase 7' },
    },
  });
  console.log('  ✔ Integration stub created (GITHUB, DISCONNECTED)');

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const counts = {
    users: await prisma.user.count(),
    organizations: await prisma.organization.count(),
    projects: await prisma.project.count(),
    services: await prisma.service.count(),
    incidents: await prisma.incident.count(),
    incidentEvents: await prisma.incidentEvent.count(),
    comments: await prisma.comment.count(),
    integrations: await prisma.integration.count(),
  };

  console.log('\n📊 Database seed complete. Record counts:');
  Object.entries(counts).forEach(([model, count]) => {
    console.log(`  ${model}: ${count}`);
  });
  console.log('\n✅ All relationships validated successfully.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error('❌ Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
