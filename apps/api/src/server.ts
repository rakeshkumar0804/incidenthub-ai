import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './lib/prisma';
import { ensureLocalRedisServer, closeRedis } from './lib/redis';
import { initSocketServer, closeSocketServer } from './lib/socket';
import { DeliveryWorker } from './modules/integrations/delivery/delivery.worker';

let isShuttingDown = false;

export function resetShutdownState(): void {
  isShuttingDown = false;
}

export async function shutdownGracefully(
  server: http.Server,
  signal: string,
  exitProcess = true,
  timeoutMs = 10_000,
  disconnectDatabases = exitProcess,
): Promise<{
  httpClosed: boolean;
  socketClosed: boolean;
  workersStopped: boolean;
  prismaDisconnected: boolean;
  redisClosed: boolean;
}> {
  if (isShuttingDown) {
    logger.warn({ signal }, 'Shutdown already in progress, ignoring duplicate signal');
    return {
      httpClosed: false,
      socketClosed: false,
      workersStopped: false,
      prismaDisconnected: false,
      redisClosed: false,
    };
  }
  isShuttingDown = true;
  logger.info({ signal }, 'Shutdown signal received, initiating graceful shutdown');

  let forceExitTimer: NodeJS.Timeout | undefined;
  if (exitProcess) {
    forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out after 10s, forcing exit');
      process.exit(1);
    }, timeoutMs);
    forceExitTimer.unref();
  }

  const results = {
    httpClosed: false,
    socketClosed: false,
    workersStopped: false,
    prismaDisconnected: false,
    redisClosed: false,
  };

  // 1. Close Socket.IO transports & disconnect active clients
  try {
    await closeSocketServer();
    results.socketClosed = true;
  } catch (err) {
    logger.error(err, 'Error during Socket.IO close');
  }

  // 2. Stop accepting new HTTP requests & close HTTP server
  try {
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          logger.error(err, 'Error while closing HTTP server');
        } else {
          results.httpClosed = true;
        }
        resolve();
      });
    });
  } catch (err) {
    logger.error(err, 'Error during HTTP server close');
  }


  // 3. Stop delivery workers & background timers
  try {
    DeliveryWorker.stop();
    results.workersStopped = true;
  } catch (err) {
    logger.error(err, 'Error stopping background delivery workers');
  }

  // 4. Disconnect Prisma
  try {
    if (disconnectDatabases) {
      await prisma.$disconnect();
    }
    results.prismaDisconnected = true;
  } catch (err) {
    logger.error(err, 'Error disconnecting Prisma client');
  }

  // 5. Close Redis (executes even if Prisma disconnect or workers threw)
  try {
    if (disconnectDatabases) {
      await closeRedis();
    }
    results.redisClosed = true;
  } catch (err) {
    logger.error(err, 'Error closing Redis client');
  }

  logger.info('Server and background workers closed cleanly');

  if (forceExitTimer) {
    clearTimeout(forceExitTimer);
  }

  if (exitProcess) {
    process.exit(0);
  }

  return results;
}

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

  process.on('SIGTERM', () => void shutdownGracefully(server, 'SIGTERM'));
  process.on('SIGINT', () => void shutdownGracefully(server, 'SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    logger.error(error, 'Uncaught exception');
    process.exit(1);
  });
}

if (require.main === module) {
  void startServer();
}
