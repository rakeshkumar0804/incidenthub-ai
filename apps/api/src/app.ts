import express from 'express';
import type { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env, isProduction } from './config/env';
import { requestLogger } from './middleware/requestLogger';
import { globalApiRateLimiter } from './middleware/rateLimiter';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { livenessHandler, readinessHandler } from './routes/health';

import crypto from 'crypto';

export function createApp(): Application {
  const app = express();

  // 1. Initial Request ID assignment for correlation tracing across all handlers
  const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
  app.use((req: Request, res: Response, next) => {
    const existingId = req.headers['x-request-id'];
    const isValid = typeof existingId === 'string' && SAFE_REQUEST_ID_REGEX.test(existingId);
    const requestId = isValid ? existingId : crypto.randomUUID();
    res.setHeader('X-Request-ID', requestId);
    req.id = requestId;
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: false, // Prevents breaking Vite SPA script/style tags in dev/prod
    }),
  );
  app.use(cookieParser());

  const allowedOrigins = new Set<string>();
  if (env.CLIENT_URL) {
    allowedOrigins.add(env.CLIENT_URL.replace(/\/$/, ''));
  }
  if (env.CORS_ALLOWED_ORIGINS) {
    env.CORS_ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean)
      .forEach((o) => allowedOrigins.add(o));
  }
  allowedOrigins.add('https://incidenthub-ai-web.vercel.app');

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          return callback(null, true);
        }

        const normalizedOrigin = origin.replace(/\/$/, '');

        if (allowedOrigins.has(normalizedOrigin)) {
          return callback(null, true);
        }

        if (!isProduction) {
          if (
            origin.startsWith('http://localhost:') ||
            origin.startsWith('http://127.0.0.1:') ||
            origin === 'http://localhost' ||
            origin === 'http://127.0.0.1'
          ) {
            return callback(null, true);
          }
        }

        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'X-Request-ID'],
    }),
  );

  app.use(requestLogger);

  app.use(globalApiRateLimiter);
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: Request, _res: Response, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  // Root health probes
  app.get('/health/liveness', livenessHandler);
  app.get('/health/live', livenessHandler);
  app.get('/health/readiness', (req: Request, res: Response, next) => {
    void readinessHandler(req, res).catch(next);
  });
  app.get('/health/ready', (req: Request, res: Response, next) => {
    void readinessHandler(req, res).catch(next);
  });
  app.get('/health', (req: Request, res: Response, next) => {
    void readinessHandler(req, res).catch(next);
  });

  // Versioned API routes with Cache-Control policy for private data
  app.use(
    '/api/v1',
    (_req: Request, res: Response, next) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      next();
    },
    apiRouter,
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
