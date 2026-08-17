import express from 'express';
import type { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { requestLogger } from './middleware/requestLogger';
import { globalApiRateLimiter } from './middleware/rateLimiter';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';
import { livenessHandler, readinessHandler } from './routes/health';

export function createApp(): Application {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false, // Prevents breaking Vite SPA script/style tags in dev/prod
    }),
  );
  app.use(cookieParser());

  const allowedOrigins = Array.from(
    new Set([env.CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173']),
  );

  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'X-Request-ID'],
    }),
  );

  app.use(requestLogger);
  app.use(globalApiRateLimiter);
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Root health probes
  app.get('/health/liveness', livenessHandler);
  app.get('/health/readiness', (req: Request, res: Response, next) => {
    void readinessHandler(req, res).catch(next);
  });
  app.get('/health', (req: Request, res: Response, next) => {
    void readinessHandler(req, res).catch(next);
  });

  // Versioned API routes
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
