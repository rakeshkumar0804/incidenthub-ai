import rateLimit from 'express-rate-limit';

/**
 * Rate limiter middleware for authentication endpoints to prevent brute-force attacks.
 * Limits IP addresses to 10 requests per 15 minutes.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // Limit each IP to 10 requests per window
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many authentication attempts. Please try again in 15 minutes.',
    },
  },
});

/**
 * Global rate limiter for general API endpoints.
 * Limits IP addresses to 300 requests per 15 minutes.
 */
export const globalApiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env['NODE_ENV'] === 'test' ? 10000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many API requests. Please slow down.',
    },
  },
});

/**
 * Rate limiter for expensive analytics computation routes.
 * Limits IP addresses to 30 requests per minute.
 */
export const analyticsRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env['NODE_ENV'] === 'test' ? 10000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Analytics query limit exceeded. Please wait a minute before retrying.',
    },
  },
});

/**
 * High-capacity rate limiter for inbound integration webhooks (GitHub, Slack, Jira).
 * Uses a high ceiling (1000/min) to prevent blocking shared cloud provider IP pools.
 */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: process.env['NODE_ENV'] === 'test' ? 10000 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Webhook burst rate limit exceeded.',
    },
  },
});
