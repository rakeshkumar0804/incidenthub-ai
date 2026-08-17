import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { checkRedisHealth } from '../lib/redis';
import { logger } from '../utils/logger';
import type { HealthResponse } from '@incidenthub/shared';

const router = Router();

export const livenessHandler = (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
};

export const readinessHandler = async (_req: Request, res: Response): Promise<void> => {
  let dbStatus: 'connected' | 'disconnected' = 'disconnected';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (error) {
    logger.error(error, 'Readiness check: database connectivity failed');
  }

  const redisStatus = await checkRedisHealth();
  const isHealthy = dbStatus === 'connected';
  const isDegraded = isHealthy && redisStatus === 'disconnected';

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
router.get('/readiness', (req: Request, res: Response, next) => {
  void readinessHandler(req, res).catch(next);
});
router.get('/', (req: Request, res: Response, next) => {
  void healthHandler(req, res).catch(next);
});

export { router as healthRouter };
