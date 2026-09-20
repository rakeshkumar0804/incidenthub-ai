import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

interface ErrorResponseBody {
  success: false;
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

function getOrSetRequestId(req: Request, res: Response): string {
  const existingHeader = res.getHeader('X-Request-ID');
  if (typeof existingHeader === 'string' && SAFE_REQUEST_ID_REGEX.test(existingHeader)) {
    return existingHeader;
  }
  const reqHeader = req.headers['x-request-id'];
  if (typeof reqHeader === 'string' && SAFE_REQUEST_ID_REGEX.test(reqHeader)) {
    res.setHeader('X-Request-ID', reqHeader);
    return reqHeader;
  }
  if (typeof req.id === 'string' && SAFE_REQUEST_ID_REGEX.test(req.id)) {
    res.setHeader('X-Request-ID', req.id);
    return req.id;
  }
  const newId = crypto.randomUUID();
  res.setHeader('X-Request-ID', newId);
  return newId;
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  const requestId = getOrSetRequestId(req, res);

  // 1. Handle JSON parse / syntax errors (Malformed JSON body)
  if (err instanceof SyntaxError && 'body' in err) {
    logger.warn({ path: req.path, method: req.method, requestId }, 'Malformed JSON request body');
    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Malformed JSON payload in request body',
        requestId,
      },
    };
    res.status(400).json(body);
    return;
  }

  // 2. Handle 413 Payload Too Large
  if ((err as { type?: string }).type === 'entity.too.large' || (err as { status?: number }).status === 413) {
    logger.warn({ path: req.path, method: req.method, requestId }, 'Payload too large');
    const body: ErrorResponseBody = {
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds limit',
        requestId,
      },
    };
    res.status(413).json(body);
    return;
  }

  // 3. Handle AppError operational errors
  if (err instanceof AppError && err.isOperational) {
    logger.warn(
      { code: err.code, statusCode: err.statusCode, path: req.path, method: req.method, requestId },
      `Operational error: ${err.message}`,
    );

    const body: ErrorResponseBody = {
      success: false,
      error: { code: err.code, message: err.message, requestId },
    };

    res.status(err.statusCode).json(body);
    return;
  }

  // 4. Handle unhandled server errors (safe 500 without stack leakage)
  logger.error({ err, path: req.path, method: req.method, requestId }, 'Unhandled server error');

  const isProduction = process.env['NODE_ENV'] === 'production';

  const body: ErrorResponseBody = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction
        ? 'An internal server error occurred'
        : err.message || 'An internal server error occurred',
      requestId,
    },
  };

  res.status(500).json(body);
};
