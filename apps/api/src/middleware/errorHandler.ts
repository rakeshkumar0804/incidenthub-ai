import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

interface ErrorResponseBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  if (err instanceof AppError && err.isOperational) {
    logger.warn(
      { code: err.code, statusCode: err.statusCode, path: req.path, method: req.method },
      `Operational error: ${err.message}`,
    );

    const body: ErrorResponseBody = {
      success: false,
      error: { code: err.code, message: err.message },
    };

    res.status(err.statusCode).json(body);
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled server error');

  const isProduction = process.env['NODE_ENV'] === 'production';

  const body: ErrorResponseBody = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction
        ? 'An internal server error occurred'
        : err.message || 'An internal server error occurred',
    },
  };

  res.status(500).json(body);
};
