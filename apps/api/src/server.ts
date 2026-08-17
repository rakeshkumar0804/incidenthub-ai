import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './lib/prisma';
import { ensureLocalRedisServer } from './lib/redis';
import { initSocketServer } from './lib/socket';
import { DeliveryWorker } from './modules/integrations/delivery/delivery.worker';

async function startServer(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  try {
    await prisma.$connect();
    logger.info('Database connection established');
  } catch (error) {
    logger.error(error, 'Failed to connect to database. Run: npm run docker:up');
    process.exit(1);
  }

  try {
    await ensureLocalRedisServer();
  } catch (error) {
    logger.warn(error, 'Redis initialization warning');
  }

  initSocketServer(server);
  DeliveryWorker.start();

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, url: `http://localhost:${env.PORT}/api/v1/health` },
      'IncidentHub AI API server started with Socket.IO & Integration Delivery Worker',
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutdown signal received');
    DeliveryWorker.stop();
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('Server closed cleanly');
      process.exit(0);
    });
    setTimeout(() => { process.exit(1); }, 10_000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    logger.error(error, 'Uncaught exception');
    process.exit(1);
  });
}

void startServer();
