import crypto from 'crypto';
import type { Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../utils/logger';

export const requestLogger = pinoHttp({
  logger,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  genReqId: (req: Request, res: Response) => {
    const existingId = req.headers['x-request-id'];
    const requestId = typeof existingId === 'string' && existingId ? existingId : crypto.randomUUID();
    res.setHeader('X-Request-ID', requestId);
    return requestId;
  },
  customLogLevel: (_req, res) => {
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
