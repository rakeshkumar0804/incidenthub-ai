import { prisma } from '../../../lib/prisma';
import { redis } from '../../../lib/redis';
import { logger } from '../../../utils/logger';
import { DeliveryService } from './delivery.service';

export class DeliveryWorker {
  private static isRunning = false;
  private static timer: NodeJS.Timeout | null = null;
  private static recoveryTimer: NodeJS.Timeout | null = null;

  public static start(intervalMs = 5000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (process.env['NODE_ENV'] !== 'test') {
      logger.info('Integration Delivery Worker started (polling interval: 5s)');
      this.timer = setInterval(() => void this.pollDeliveries(), intervalMs);
      this.recoveryTimer = setInterval(() => void DeliveryService.recoverStaleDeliveries(), 60000);
    }
  }

  public static stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  public static async pollDeliveries(): Promise<void> {
    if (!this.isRunning) return;

    // Redis coordination layer (Optimization only; DB atomic UPDATE ensures strict correctness)
    const lockAcquired = await redis.set('lock:integration-delivery-worker', 'active', 'EX', 10, 'NX');
    if (!lockAcquired && process.env['NODE_ENV'] !== 'test') {
      return; // Another node is processing the batch
    }

    try {
      const now = new Date();
      const pendingDeliveries = await prisma.integrationDelivery.findMany({
        where: {
          OR: [
            { status: 'PENDING' },
            { status: 'RETRYING', nextRetryAt: { lte: now } },
          ],
        },
        take: 20,
      });

      for (const delivery of pendingDeliveries) {
        const claimed = await DeliveryService.claimDelivery(delivery.id);
        if (claimed) {
          await DeliveryService.processDelivery(delivery.id);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error during integration delivery worker polling');
    }
  }
}
