import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { safeRedisGet, safeRedisSet, safeRedisDel } from '../src/lib/redis';

const app = createApp();
const request = supertest(app);

describe('Phase 14 — Production Hardening + Final Polish Test Suite', () => {
  // ===========================================================================
  // 1. SECURITY HEADERS & REQUEST CORRELATION TRACING
  // ===========================================================================
  describe('Security Headers & Request ID Tracing', () => {
    it('sets security headers via Helmet middleware', async () => {
      const res = await request.get('/health/liveness');
      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty('x-dns-prefetch-control');
      expect(res.headers).toHaveProperty('x-content-type-options', 'nosniff');
    });

    it('generates and propagates X-Request-ID header on all responses', async () => {
      const res = await request.get('/health/liveness');
      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty('x-request-id');
      expect(typeof res.headers['x-request-id']).toBe('string');
    });

    it('preserves incoming X-Request-ID header when supplied by client', async () => {
      const customId = 'custom-trace-id-12345';
      const res = await request.get('/health/liveness').set('X-Request-ID', customId);
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(customId);
    });
  });

  // ===========================================================================
  // 2. HEALTH & READINESS PROBES
  // ===========================================================================
  describe('Health Probes (/health/liveness, /health/readiness)', () => {
    it('GET /health/liveness returns 200 OK with event loop timestamp', async () => {
      const res = await request.get('/health/liveness');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('GET /health/readiness returns 200 OK with database connectivity status', async () => {
      const res = await request.get('/health/readiness');
      expect(res.status).toBe(200);
      const body = res.body as { services?: { database?: string } };
      expect(body).toHaveProperty('services');
      expect(body.services).toHaveProperty('database', 'connected');
    });
  });

  // ===========================================================================
  // 3. REDIS FAULT-TOLERANT CACHE HELPERS
  // ===========================================================================
  describe('Redis Resilience & Safe Cache Degradation', () => {
    it('safeRedisSet and safeRedisGet store and retrieve values with TTL jitter', async () => {
      const key = `test:phase14:key-${Date.now()}`;
      await safeRedisSet(key, 'test-resilience-value', 60);
      const val = await safeRedisGet(key);
      expect(val).toBe('test-resilience-value');
      await safeRedisDel(key);
    });

    it('safeRedisGet handles missing keys without throwing errors', async () => {
      const val = await safeRedisGet('non-existent-key-99999');
      expect(val).toBeNull();
    });
  });
});
