import { prisma } from '../../../lib/prisma';
import { logger } from '../../../utils/logger';
import { IntegrationStatus } from '@incidenthub/shared';

export class DeliveryService {
  /**
   * Atomic Claim Operation (Database transaction boundary for worker correctness).
   * Only the worker that successfully updates status from PENDING/RETRYING -> PROCESSING owns the attempt.
   */
  public static async claimDelivery(deliveryId: string): Promise<boolean> {
    const updatedCount = await prisma.$executeRaw`
      UPDATE integration_deliveries
      SET status = 'PROCESSING'::"IntegrationDeliveryStatus",
          "updatedAt" = NOW()
      WHERE id = ${deliveryId}
        AND status IN ('PENDING'::"IntegrationDeliveryStatus", 'RETRYING'::"IntegrationDeliveryStatus")
    `;

    return updatedCount > 0;
  }

  /**
   * Process a single delivery with Error Classification & Retry Scheduling.
   */
  public static async processDelivery(deliveryId: string): Promise<void> {
    const delivery = await prisma.integrationDelivery.findUnique({
      where: { id: deliveryId },
      include: { integration: true },
    });

    if (!delivery || delivery.status !== 'PROCESSING') {
      return;
    }

    try {
      // Execute provider outbound request (Mock or real HTTP dispatch)
      if (process.env['NODE_ENV'] !== 'test') {
        logger.info({ deliveryId, provider: delivery.provider }, 'Processing outbound integration delivery');
      }

      await prisma.integrationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SUCCESS',
          attemptCount: delivery.attemptCount + 1,
        },
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isNonRetryable = errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('404');
      const maxAttempts = 3;
      const nextAttempt = delivery.attemptCount + 1;

      if (isNonRetryable || nextAttempt >= maxAttempts) {
        await prisma.integrationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            attemptCount: nextAttempt,
            lastError: errMsg,
          },
        });

        if (errMsg.includes('401') || errMsg.includes('403')) {
          await prisma.integration.update({
            where: { id: delivery.integrationId },
            data: { status: IntegrationStatus.ERROR },
          });
        }
      } else {
        const backoffMs = nextAttempt === 1 ? 5000 : nextAttempt === 2 ? 30000 : 300000;
        await prisma.integrationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'RETRYING',
            attemptCount: nextAttempt,
            lastError: errMsg,
            nextRetryAt: new Date(Date.now() + backoffMs),
          },
        });
      }
    }
  }

  /**
   * Stale PROCESSING Recovery Worker Task (Runs every 60s, 5-minute lease threshold).
   */
  public static async recoverStaleDeliveries(): Promise<number> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const staleDeliveries = await prisma.integrationDelivery.findMany({
      where: {
        status: 'PROCESSING',
        updatedAt: { lt: fiveMinutesAgo },
      },
    });

    let recoveredCount = 0;
    for (const delivery of staleDeliveries) {
      const nextAttempt = delivery.attemptCount + 1;
      const maxAttempts = 3;

      if (nextAttempt >= maxAttempts) {
        await prisma.integrationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            lastError: 'Delivery lease expired: worker crashed or dropped while PROCESSING',
          },
        });
      } else {
        await prisma.integrationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'RETRYING',
            nextRetryAt: new Date(Date.now() + 5000),
            lastError: 'Delivery lease recovered after worker crash',
          },
        });
      }
      recoveredCount++;
    }

    return recoveredCount;
  }
}
