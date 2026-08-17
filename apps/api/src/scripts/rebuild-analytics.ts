import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { AnalyticsService } from '../modules/analytics/analytics.service';
import type { AnalyticsTimeWindow } from '@incidenthub/shared';

export async function rebuildAnalytics(targetOrgId?: string): Promise<void> {
  logger.info('Starting Analytics Read-Model Rebuild process...');

  const orgs = targetOrgId
    ? [{ id: targetOrgId, name: 'Target Org' }]
    : await prisma.organization.findMany({ select: { id: true, name: true } });

  const windows: AnalyticsTimeWindow[] = ['24h', '7d', '30d', '90d'];

  await Promise.all(
    orgs.map(async (org) => {
      logger.info({ orgId: org.id, name: org.name }, 'Rebuilding analytics snapshots...');

      for (const w of windows) {
        try {
          await AnalyticsService.getOverview(org.id, { window: w, refresh: 'true' });
          await AnalyticsService.getServiceMetrics(org.id, { window: w, refresh: 'true' });
        } catch (err) {
          logger.error({ err, orgId: org.id, window: w }, 'Failed to rebuild analytics snapshot');
        }
      }
    }),
  );

  logger.info('Analytics Read-Model Rebuild complete cleanly.');
}

if (require.main === module) {
  void rebuildAnalytics().then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
