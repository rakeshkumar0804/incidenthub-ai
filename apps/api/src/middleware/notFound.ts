import crypto from 'crypto';
import type { Request, Response } from 'express';

const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export const notFoundHandler = (req: Request, res: Response): void => {
  let requestId = res.getHeader('X-Request-ID');
  if (typeof requestId !== 'string' || !SAFE_REQUEST_ID_REGEX.test(requestId)) {
    const headerReqId = req.headers['x-request-id'];
    if (typeof headerReqId === 'string' && SAFE_REQUEST_ID_REGEX.test(headerReqId)) {
      requestId = headerReqId;
    } else if (typeof req.id === 'string' && SAFE_REQUEST_ID_REGEX.test(req.id)) {
      requestId = req.id;
    } else {
      requestId = crypto.randomUUID();
    }
    res.setHeader('X-Request-ID', requestId);
  }

  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      requestId,
    },
  });
};
