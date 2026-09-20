import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { checkRedisHealth, isRedisRequired } from '../lib/redis';
import { logger } from '../utils/logger';
import type { HealthResponse } from '@incidenthub/shared';

const router = Router();

let healthCheckTimeoutMs = 5000;

export function setHealthCheckTimeoutMsForTesting(timeoutMs: number): void {
  healthCheckTimeoutMs = timeoutMs;
}

export function resetHealthCheckTimeoutMsForTesting(): void {
  healthCheckTimeoutMs = 5000;
}

export const livenessHandler = (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
};

export const readinessHandler = async (_req: Request, res: Response): Promise<void> => {
  const checkDb = async (): Promise<'connected' | 'disconnected'> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const rawDbPromise = prisma.$queryRaw`SELECT 1`;
      // Prevent unhandled promise rejection if db query rejects after race timeout
      const dbPromise = rawDbPromise.catch(() => null);
      const timeoutPromise = new Promise<'disconnected'>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Database health check timeout')), healthCheckTimeoutMs);
      });
      const result = await Promise.race([dbPromise, timeoutPromise]);
      return result !== null ? 'connected' : 'disconnected';
    } catch (error) {
      logger.error(error, 'Readiness check: database connectivity failed');
      return 'disconnected';
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const checkRedis = async (): Promise<'connected' | 'disconnected'> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const rawRedisPromise = checkRedisHealth();
      // Prevent unhandled promise rejection if redis health check rejects after race timeout
      const redisPromise = rawRedisPromise.catch(() => 'disconnected' as const);
      const timeoutPromise = new Promise<'connected' | 'disconnected'>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis health check timeout')), healthCheckTimeoutMs);
      });
      return await Promise.race([redisPromise, timeoutPromise]);
    } catch (error) {
      logger.error(error, 'Readiness check: redis connectivity failed');
      return 'disconnected';
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const [dbStatus, redisStatus] = await Promise.all([checkDb(), checkRedis()]);
  const redisRequired = isRedisRequired();
  const isHealthy = dbStatus === 'connected' && (!redisRequired || redisStatus === 'connected');
  const isDegraded = dbStatus === 'connected' && redisStatus === 'disconnected';

  const response: HealthResponse = {
    status: !isHealthy ? 'degraded' : isDegraded ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      redis: redisStatus,
    },
  };

  res.status(isHealthy ? 200 : 503).json(response);
};


export const healthHandler = readinessHandler;

router.get('/liveness', livenessHandler);
router.get('/live', livenessHandler);
router.get('/readiness', (req: Request, res: Response, next) => {
  void readinessHandler(req, res).catch(next);
});
router.get('/ready', (req: Request, res: Response, next) => {
  void readinessHandler(req, res).catch(next);
});
router.get('/', (req: Request, res: Response, next) => {
  void healthHandler(req, res).catch(next);
});

export { router as healthRouter };
