import crypto from 'crypto';
import type { Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../utils/logger';

const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export const requestLogger = pinoHttp({
  logger,
  redact: ['req.headers.authorization', 'req.headers.cookie'],
  genReqId: (req: Request, res: Response) => {
    const existingId = req.headers['x-request-id'];
    const isValid = typeof existingId === 'string' && SAFE_REQUEST_ID_REGEX.test(existingId);
    const requestId = isValid ? existingId : crypto.randomUUID();
    res.setHeader('X-Request-ID', requestId);
    return requestId;
  },
  customLogLevel: (_req, res) => {
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
