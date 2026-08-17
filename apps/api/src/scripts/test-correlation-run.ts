import { CorrelationService } from '../modules/correlation/correlation.service';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../utils/logger';

async function runTest(): Promise<void> {
  const incident = await prisma.incident.findFirst({
    where: { number: 2 },
  });

  if (!incident) {
    logger.error('Incident number 2 not found');
    process.exit(1);
  }

  const redisKey = `lock:correlation:${incident.id}`;
  try {
    await redis.del(redisKey);
  } catch {
    // Ignore redis error
  }

  logger.info({ incidentId: incident.id, orgId: incident.organizationId, number: incident.number }, 'Running correlation for INC-0002...');

  const result = await CorrelationService.runCorrelation(
    incident.organizationId,
    incident.id,
    undefined,
    'MANUAL_REQUEST',
  );

  logger.info({ result }, 'Correlation execution result');

  // Query generated evidence
  const evidenceList = await prisma.incidentEvidence.findMany({
    where: { incidentId: incident.id },
    orderBy: { confidence: 'desc' },
  });

  logger.info({ totalEvidence: evidenceList.length }, 'Generated Evidence Summary:');
  for (const item of evidenceList) {
    logger.info(
      {
        id: item.id,
        type: item.type,
        tier: item.confidenceTier,
        confidence: item.confidence,
        title: item.title,
        reasons: item.reasons,
      },
      'Evidence Card',
    );
  }

  // Query audit events
  const auditEvents = await prisma.incidentEvent.findMany({
    where: { incidentId: incident.id, type: 'CORRELATION_RUN_COMPLETED' },
    orderBy: { occurredAt: 'desc' },
    take: 1,
  });

  logger.info({ auditEvent: auditEvents[0] }, 'Incident Audit Event Created');
  process.exit(0);
}

void runTest();
