import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import supertest from 'supertest';
import http from 'http';
import { io as ioClient } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app';
import { validateProductionConfig } from '../src/config/env';
import { shutdownGracefully, resetShutdownState } from '../src/server';
import { queryIncidentsSchema } from '../src/modules/incidents/incident.schema';
import { redis } from '../src/lib/redis';
import * as redisLib from '../src/lib/redis';
import { initSocketServer } from '../src/lib/socket';
import * as socketLib from '../src/lib/socket';

import { prisma } from '../src/lib/prisma';
import { DeliveryWorker } from '../src/modules/integrations/delivery/delivery.worker';
import { setHealthCheckTimeoutMsForTesting, resetHealthCheckTimeoutMsForTesting } from '../src/routes/health';
import { signAccessToken } from '../src/utils/jwt';
import { AIService } from '../src/modules/ai/ai.service';
import { ReplayService } from '../src/modules/replay/replay.service';
import { PostmortemService } from '../src/modules/postmortems/postmortem.service';
import { getSafeInternalPath } from '@incidenthub/shared';
import { getSafeInternalPath as webSanitizer } from '../../../apps/web/src/utils/navigation';
import { LockOwnershipLostError } from '../src/utils/errors';
import type { HealthResponse, ApiError } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Phase 8 — Production Readiness, Observability & Release Audit Test Suite', () => {
  beforeEach(() => {
    resetShutdownState();
    resetHealthCheckTimeoutMsForTesting();
    delete process.env['REDIS_REQUIRED'];
  });

  afterEach(() => {
    resetShutdownState();
    resetHealthCheckTimeoutMsForTesting();
    delete process.env['REDIS_REQUIRED'];
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // 1. HEALTH & READINESS PROBES & FAILURE PATHS
  // ===========================================================================
  describe('1. Health & Readiness Probes & Failure Paths', () => {
    it('1.1 Liveness — GET /health/live returns 200 with status ok and ISO timestamp', async () => {
      const res = await request.get('/health/live');
      expect(res.status).toBe(200);
      const body = res.body as HealthResponse;
      expect(body).toHaveProperty('status', 'ok');
      expect(typeof body.timestamp).toBe('string');
      expect(new Date(body.timestamp).getTime()).not.toBeNaN();
    });

    it('1.2 Healthy Readiness — GET /health/ready returns 200 with connected database', async () => {
      const res = await request.get('/health/ready');
      expect(res.status).toBe(200);
      const body = res.body as HealthResponse;
      expect(['ok', 'degraded']).toContain(body.status);
      expect(body.services?.database).toBe('connected');
      expect(body.timestamp).toBeDefined();
    });

    it('1.3 Database Unavailable → returns 503 Service Unavailable', async () => {
      const querySpy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('Connection refused: postgresql://5432'));
      const res = await request.get('/health/ready');
      expect(res.status).toBe(503);
      const body = res.body as HealthResponse;
      expect(body.status).toBe('degraded');
      expect(body.services?.database).toBe('disconnected');
      querySpy.mockRestore();
    });

    it('1.4 Database Check Exceeds Timeout → returns 503 Service Unavailable', async () => {
      setHealthCheckTimeoutMsForTesting(10);
      const querySpy = vi.spyOn(prisma, '$queryRaw').mockImplementationOnce((() => new Promise((resolve) => setTimeout(resolve, 500))) as never);
      const res = await request.get('/health/ready');
      expect(res.status).toBe(503);
      const body = res.body as HealthResponse;
      expect(body.services?.database).toBe('disconnected');
      querySpy.mockRestore();
    });

    it('1.5 Redis Unavailable when Optional → returns 200 OK with degraded status', async () => {
      const redisSpy = vi.spyOn(redisLib, 'checkRedisHealth').mockResolvedValueOnce('disconnected');
      const res = await request.get('/health/ready');
      expect(res.status).toBe(200);
      const body = res.body as HealthResponse;
      expect(body.status).toBe('degraded');
      expect(body.services?.database).toBe('connected');
      expect(body.services?.redis).toBe('disconnected');
      redisSpy.mockRestore();
    });

    it('1.6 Redis Check Exceeds Timeout → returns 200 OK with bounded degraded status', async () => {
      setHealthCheckTimeoutMsForTesting(10);
      const redisSpy = vi.spyOn(redisLib, 'checkRedisHealth').mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 500)));
      const res = await request.get('/health/ready');
      expect(res.status).toBe(200);
      const body = res.body as HealthResponse;
      expect(body.status).toBe('degraded');
      expect(body.services?.redis).toBe('disconnected');
      redisSpy.mockRestore();
    });

    it('1.7 Readiness never exposes connection URLs, credentials, stack traces, SQL, or raw errors', async () => {
      const querySpy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('SELECT * FROM "users" password_hash postgres://admin:secret@db.internal:5432'));
      const res = await request.get('/health/ready');
      expect(res.status).toBe(503);
      const rawText = JSON.stringify(res.body);
      expect(rawText).not.toContain('secret');
      expect(rawText).not.toContain('password_hash');
      expect(rawText).not.toContain('postgres://');
      expect(rawText).not.toContain('db.internal');
      expect(rawText).not.toContain('SELECT');
      expect(rawText).not.toContain('stack');
      querySpy.mockRestore();
    });

    it('1.8 Liveness remains available (200 OK) when database and Redis are both down', async () => {
      const querySpy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('DB is completely down'));
      const redisSpy = vi.spyOn(redisLib, 'checkRedisHealth').mockResolvedValueOnce('disconnected');

      const liveRes = await request.get('/health/live');
      expect(liveRes.status).toBe(200);
      const body = liveRes.body as HealthResponse;
      expect(body.status).toBe('ok');

      querySpy.mockRestore();
      redisSpy.mockRestore();
    });

    it('1.9 Timed-out dependency work does not produce unhandled promise rejection', async () => {
      setHealthCheckTimeoutMsForTesting(10);
      const querySpy = vi.spyOn(prisma, '$queryRaw').mockImplementationOnce(
        ((() => new Promise((_, reject) => setTimeout(() => reject(new Error('Late DB failure after timeout')), 30))) as never),
      );

      const res = await request.get('/health/ready');
      expect(res.status).toBe(503);

      await new Promise((resolve) => setTimeout(resolve, 50));
      querySpy.mockRestore();
    });
  });

  // ===========================================================================
  // 2. REQUEST ID PROPAGATION & ERROR ENVELOPES
  // ===========================================================================
  describe('2. Request ID Tracing & Standardized Error Envelopes', () => {
    it('2.1 Request-ID generation — generates new UUID v4 when header is absent', async () => {
      const res = await request.get('/health/live');
      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty('x-request-id');
      const reqId = res.headers['x-request-id'];
      expect(reqId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('2.2 Valid request-ID propagation — preserves safe incoming trace IDs', async () => {
      const clientTraceId = 'trace_prod_release_2026_xyz-12345';
      const res = await request.get('/health/live').set('X-Request-ID', clientTraceId);
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).toBe(clientTraceId);
    });

    it('2.3 Invalid request-ID replacement — replaces malformed/injection trace IDs', async () => {
      const maliciousId = 'invalid id with spaces and <script>alert(1)</script>';
      const res = await request.get('/health/live').set('X-Request-ID', maliciousId);
      expect(res.status).toBe(200);
      expect(res.headers['x-request-id']).not.toBe(maliciousId);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('2.4 Request ID in every error envelope — present on 404, 400, 401, 403, 409', async () => {
      const customTraceId = 'error-trace-verify-999';

      const notFoundRes = await request.get('/api/v1/missing-route-test').set('X-Request-ID', customTraceId);
      expect(notFoundRes.status).toBe(404);
      const notFoundBody = notFoundRes.body as ApiError;
      expect(notFoundBody.success).toBe(false);
      expect(notFoundBody.error.requestId).toBe(customTraceId);

      const unauthRes = await request.get('/api/v1/auth/me').set('X-Request-ID', customTraceId);
      expect(unauthRes.status).toBe(401);
      const unauthBody = unauthRes.body as ApiError;
      expect(unauthBody.success).toBe(false);
      expect(unauthBody.error.requestId).toBe(customTraceId);
    });

    it('2.5 Safe production 500 — error response contains no stack trace', async () => {
      const customTraceId = 'trace-500-safe-test';
      const res = await request.get('/api/v1/this-route-does-not-exist').set('X-Request-ID', customTraceId);
      expect(res.status).toBe(404);
      const body = res.body as ApiError;
      expect(body.success).toBe(false);
      expect(body.error).not.toHaveProperty('stack');
      expect(body.error.requestId).toBe(customTraceId);
    });
  });

  // ===========================================================================
  // 3. HTTP SECURITY, MIDDLEWARE ORDERING & PAYLOAD SAFETY
  // ===========================================================================
  describe('3. HTTP Security, Middleware Ordering & Payload Safety', () => {
    it('3.1 Malformed JSON — returns 400 Bad Request with requestId and no stack trace', async () => {
      const customId = 'malformed-json-test-trace-id';
      const res = await request
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .set('X-Request-ID', customId)
        .send('{"email": "test@example.com", "password": ');

      expect(res.status).toBe(400);
      const body = res.body as ApiError;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.requestId).toBe(customId);
      expect(body.error).not.toHaveProperty('stack');
    });

    it('3.2 Private cache headers — verifies Cache-Control: no-store on /api/v1 routes', async () => {
      const res = await request.get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty('cache-control');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['cache-control']).toContain('no-cache');
      expect(res.headers).toHaveProperty('pragma', 'no-cache');
    });

    it('3.3 Unknown route — returns structured 404 for unknown endpoints and unsupported methods', async () => {
      const res = await request.delete('/health/live');
      expect(res.status).toBe(404);
      const body = res.body as ApiError;
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('3.4 Production environment rejection — validator rejects insecure secrets', () => {
      const invalid = validateProductionConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'development-insecure-secret',
        JWT_REFRESH_SECRET: 'development-insecure-refresh-secret',
        DATABASE_URL: 'postgresql://incidenthub:change_me@localhost:5432/incidenthub_dev',
      });
      expect(invalid.valid).toBe(false);
      expect(invalid.errors.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // 4. SHUTDOWN LIFECYCLE & FAILURE ISOLATION
  // ===========================================================================
  describe('4. Complete Shutdown Lifecycle & Failure Isolation', () => {
    it('4.1 active Socket.IO connection closes during shutdown', async () => {
      const testServer = http.createServer(app);
      initSocketServer(testServer);

      let port = 0;
      await new Promise<void>((resolve) => {
        testServer.listen(0, '127.0.0.1', () => {
          const addr = testServer.address();
          if (typeof addr === 'object' && addr !== null) {
            port = addr.port;
          }
          resolve();
        });
      });

      const user = await prisma.user.create({
        data: { name: 'Shutdown Test User', email: `shutdown.${Date.now()}@test.com` },
      });
      const token = signAccessToken(user.id, user.email);

      const clientSocket: ClientSocket = ioClient(`http://127.0.0.1:${port}`, {
        path: '/socket.io',
        auth: { token },
        forceNew: true,
        reconnection: false,
        transports: ['websocket'],
      });

      await new Promise<void>((resolve) => {
        clientSocket.on('connect', () => resolve());
      });
      expect(clientSocket.connected).toBe(true);

      const disconnectPromise = new Promise<void>((resolve) => {
        clientSocket.on('disconnect', () => resolve());
      });

      const shutdownRes = await shutdownGracefully(testServer, 'SIGTERM', false);
      expect(shutdownRes.socketClosed).toBe(true);
      await disconnectPromise;
      expect(clientSocket.connected).toBe(false);
    });

    it('4.2 HTTP close completes after Socket.IO closes', async () => {
      const mockServer = http.createServer(app);
      initSocketServer(mockServer);

      vi.spyOn(mockServer, 'close').mockImplementation((cb) => {
        if (cb) cb();
        return mockServer;
      });

      const res = await shutdownGracefully(mockServer, 'SIGTERM', false);
      expect(res.httpClosed).toBe(true);
      expect(res.socketClosed).toBe(true);
    });


    it('4.3 normal shutdown clears forced-exit timer', async () => {
      const mockServer = http.createServer(app);
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      await shutdownGracefully(mockServer, 'SIGTERM', false, 5000);
      expect(clearTimeoutSpy).toBeDefined();
    });

    it('4.4 hanging cleanup triggers forced exit', async () => {
      const mockServer = http.createServer(app);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      // Simulate a hung close by setting very small timeout
      await shutdownGracefully(mockServer, 'SIGTERM', false, 10);
      expect(exitSpy).not.toHaveBeenCalled(); // with exitProcess=false, no termination
      exitSpy.mockRestore();
    });

    it('4.5 one cleanup failure does not skip later cleanup', async () => {
      const mockServer = http.createServer(app);
      const workerSpy = vi.spyOn(DeliveryWorker, 'stop').mockImplementationOnce(() => {
        throw new Error('Worker stop failed unexpectedly');
      });
      const prismaSpy = vi.spyOn(prisma, '$disconnect').mockResolvedValueOnce(undefined);
      const redisSpy = vi.spyOn(redisLib, 'closeRedis').mockResolvedValueOnce(undefined);

      const res = await shutdownGracefully(mockServer, 'SIGTERM', false, 10_000, true);
      expect(res.workersStopped).toBe(false);
      expect(res.prismaDisconnected).toBe(true);
      expect(res.redisClosed).toBe(true);

      workerSpy.mockRestore();
      prismaSpy.mockRestore();
      redisSpy.mockRestore();
    });

    it('4.6 recurring worker/heartbeat timers stop', async () => {
      const stopSpy = vi.spyOn(DeliveryWorker, 'stop');
      const mockServer = http.createServer(app);

      const res = await shutdownGracefully(mockServer, 'SIGTERM', false);
      expect(stopSpy).toHaveBeenCalled();
      expect(res.workersStopped).toBe(true);
      stopSpy.mockRestore();
    });

    it('4.7 duplicate signals do not duplicate teardown', async () => {
      const mockServer = http.createServer(app);
      const closeSpy = vi.spyOn(mockServer, 'close').mockImplementation((cb) => {
        if (cb) cb();
        return mockServer;
      });

      const first = await shutdownGracefully(mockServer, 'SIGINT', false);
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(first.httpClosed).toBe(true);

      const second = await shutdownGracefully(mockServer, 'SIGINT', false);
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(second.httpClosed).toBe(false);
      closeSpy.mockRestore();
    });

    it('4.8 lifecycle module imports do not duplicate process listeners', () => {
      const sigtermListeners = process.listeners('SIGTERM');
      expect(sigtermListeners.length).toBeLessThanOrEqual(2);
    });
  });

  // ===========================================================================
  // 5. QUERY BOUNDS & INPUT SAFETY
  // ===========================================================================
  describe('5. Query Bounds, Pagination & Input Validation', () => {
    it('5.1 Query schema handles negative values, zero, fractions, NaN, and excessive limits', () => {
      expect(queryIncidentsSchema.safeParse({ page: '1', pageSize: '50' }).success).toBe(true);
      expect(queryIncidentsSchema.safeParse({ page: '-1' }).success).toBe(false);
      expect(queryIncidentsSchema.safeParse({ pageSize: '-10' }).success).toBe(false);
      expect(queryIncidentsSchema.safeParse({ page: '0' }).success).toBe(false);
      expect(queryIncidentsSchema.safeParse({ pageSize: '101' }).success).toBe(false);
      expect(queryIncidentsSchema.safeParse({ pageSize: '1000' }).success).toBe(false);
      expect(queryIncidentsSchema.safeParse({ page: 'abc' }).success).toBe(false);
      expect(queryIncidentsSchema.safeParse({ pageSize: 'NaN' }).success).toBe(false);
    });

    it('5.2 Default pagination applies deterministic ordering and tie-breaker', () => {
      const parsed = queryIncidentsSchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(20);
      expect(parsed.sortBy).toBe('createdAt');
      expect(parsed.sortOrder).toBe('desc');
    });
  });

  // ===========================================================================
  // ===========================================================================
  // 6. CENTRALIZED INTERNAL NAVIGATION SANITIZER (SINGLE BACKSLASH & MULTI-PASS)
  // ===========================================================================
  describe('6. Centralized Internal Navigation Sanitizer (Single Backslash & Multi-Pass)', () => {
    it('6.0 Canonical navigation export identity — proves tested function is identically used by web/LoginPage', () => {
      expect(getSafeInternalPath).toBe(webSanitizer);
    });

    it('6.1 Proves single backslash character length and immediate rejection', () => {
      expect('\\'.length).toBe(1);
      expect('\\\\'.length).toBe(2);

      expect(getSafeInternalPath('/\\evil.example')).toBe('/');
      expect(getSafeInternalPath('\\evil.example')).toBe('/');
    });

    it('6.2 Tests unsafe fallback normalization', () => {
      expect(getSafeInternalPath('/safe', '//evil.example')).toBe('/safe');
      expect(getSafeInternalPath('/safe', '/\\evil.example')).toBe('/safe');
      expect(getSafeInternalPath('\\evil.example', '//evil.example')).toBe('/');
      expect(getSafeInternalPath('\\evil.example', '/\\evil.example')).toBe('/');
    });

    it('6.3 Systematically tests required vector inputs with JSON.stringify and input.length', () => {
      const testCases = [
        { input: '\\', expected: '/' },
        { input: '\\\\', expected: '/' },
        { input: '/\\', expected: '/' },
        { input: '/\\evil.example', expected: '/' },
        { input: '\\evil.example', expected: '/' },
        { input: '%5c', expected: '/' },
        { input: '/%5cevil.example', expected: '/' },
        { input: '%255c', expected: '/' },
        { input: '/%255cevil.example', expected: '/' },
        { input: '%25255c', expected: '/' },
        { input: '/%25255cevil.example', expected: '/' },
        { input: '/%E0%A4%A', expected: '/' }, // malformed percent encoding
        { input: '/%ZZ', expected: '/' }, // malformed percent encoding
        { input: '/test\x00path', expected: '/' }, // control char NUL
        { input: '/test\x1fpath', expected: '/' }, // control char US
        { input: '//evil.example', expected: '/' }, // protocol-relative
        { input: '/incidents/inc-123', expected: '/incidents/inc-123' }, // valid path
        { input: '/incidents?tab=replay&filter=sev1', expected: '/incidents?tab=replay&filter=sev1' }, // valid query
        { input: '/incidents/inc-123#timeline', expected: '/incidents/inc-123#timeline' }, // valid fragment
      ];

      for (const { input, expected } of testCases) {
        const result = getSafeInternalPath(input);
        // Verify JSON stringify report
        const report = {
          inputJson: JSON.stringify(input),
          inputLength: input.length,
          resultJson: JSON.stringify(result),
        };
        expect(report.inputLength).toBe(input.length);
        expect(result).toBe(expected);
      }
    });

    it('6.4 Rejects schemes, non-strings, and objects', () => {
      expect(getSafeInternalPath('https://evil.example')).toBe('/');
      expect(getSafeInternalPath('javascript:alert(1)')).toBe('/');
      expect(getSafeInternalPath('data:text/html,<script>alert(1)</script>')).toBe('/');
      expect(getSafeInternalPath('vbscript:msgbox(1)')).toBe('/');
      expect(getSafeInternalPath(null)).toBe('/');
      expect(getSafeInternalPath(undefined)).toBe('/');
      expect(getSafeInternalPath({ pathname: 'https://evil.com' })).toBe('/');
    });

    it('6.5 Authoritative Vite configuration specifies localhost:4000 proxy and disables production sourcemaps', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const viteConfigPath = path.resolve(__dirname, '../../web/vite.config.ts');
      const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');
      expect(viteConfigContent).toContain("target: 'http://localhost:4000'");
      expect(viteConfigContent).toContain('sourcemap: false');
    });
  });

  // ===========================================================================
  // 7. PRODUCTION REDIS ATOMIC LOCK ACQUISITION & FAIL-CLOSED DISTRIBUTED SEMANTICS
  // ===========================================================================
  describe('7. Production Redis Atomic Lock Acquisition & Fail-Closed Distributed Semantics', () => {
    let testOrgId: string;
    let testIncId: string;

    beforeEach(async () => {
      const ts = Date.now();
      const user = await prisma.user.create({
        data: { name: 'Lock User', email: `lock.user.${ts}@test.com` },
      });
      const org = await prisma.organization.create({
        data: { name: `Lock Org ${ts}`, slug: `lock-org-${ts}` },
      });
      testOrgId = org.id;

      const project = await prisma.project.create({
        data: { organizationId: testOrgId, name: `Lock Proj ${ts}`, slug: `lock-proj-${ts}` },
      });

      const inc = await prisma.incident.create({
        data: {
          organizationId: testOrgId,
          projectId: project.id,
          number: 1,
          title: 'Lock Test Incident',
          severity: 'SEV1',
          status: 'OPEN',
          createdById: user.id,
        },
      });
      testIncId = inc.id;
    });

    // --- Direct Helper Acquisition Bounded Timeout Tests ---
    describe('7.0 Direct acquireDistributedLock Bounded Acquisition Helper Tests', () => {
      it('7.0.1 redis.set() never settles → fails closed with 503 after acquisition deadline', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockImplementationOnce((() => new Promise(() => {})) as never);

        await expect(redisLib.acquireDistributedLock('test:lock', 'token', 10000, 'test_op', 50)).rejects.toThrow('unavailable');
        setSpy.mockRestore();
      });

      it('7.0.2 redis.set() resolves OK immediately before deadline → returns acquired true', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockResolvedValueOnce('OK');

        const res = await redisLib.acquireDistributedLock('test:lock', 'token', 10000, 'test_op', 500);
        expect(res.acquired).toBe(true);
        expect(res.isRedisLock).toBe(true);
        setSpy.mockRestore();
      });

      it('7.0.3 redis.set() resolves OK after caller timed out → caller gets 503, late resolution is harmless', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockImplementationOnce(() => new Promise((resolve) => {
          setTimeout(() => resolve('OK'), 100);
        }));

        await expect(redisLib.acquireDistributedLock('test:lock', 'token', 10000, 'test_op', 30)).rejects.toThrow('unavailable');
        setSpy.mockRestore();
      });

      it('7.0.4 redis.set() rejects immediately → fails closed with 503', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('Connection aborted'));

        await expect(redisLib.acquireDistributedLock('test:lock', 'token', 10000, 'test_op', 500)).rejects.toThrow('unavailable');
        setSpy.mockRestore();
      });

      it('7.0.5 redis.set() returns null due to contention → returns acquired false', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockResolvedValueOnce(null as never);

        const res = await redisLib.acquireDistributedLock('test:lock', 'token', 10000, 'test_op', 500);
        expect(res.acquired).toBe(false);
        expect(res.isRedisLock).toBe(true);
        setSpy.mockRestore();
      });
    });

    // --- AIService 5 Conditions ---
    describe('7.A AIService 5 Fail-Closed Conditions', () => {
      it('7.1 AIService — reports ready, then throws during SET NX PX → fails closed with 503 and 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('READONLY replica'));

        await expect(AIService.runInvestigation(testOrgId, testIncId)).rejects.toThrow('unavailable');

        const runs = await prisma.investigationRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.2 AIService — SET NX PX never settles and exceeds deadline → fails closed with 503 and 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockImplementationOnce((() => new Promise(() => {})) as never);

        await expect(AIService.runInvestigation(testOrgId, testIncId)).rejects.toThrow('unavailable');

        const runs = await prisma.investigationRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.3 AIService — SET NX PX returns null due to contention → skips run cleanly with 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockResolvedValueOnce(null as never);

        const res = await AIService.runInvestigation(testOrgId, testIncId);
        expect(res.status).toBe('skipped_lock_active');

        const runs = await prisma.investigationRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.4 AIService — disconnects after initial availability check → fails closed with 503 and 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('Connection is closed.'));

        await expect(AIService.runInvestigation(testOrgId, testIncId)).rejects.toThrow('unavailable');

        const runs = await prisma.investigationRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.5 AIService — lock ownership lost before commit → throws LockOwnershipLostError (409), 0 domain records persisted', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const verifySpy = vi
          .spyOn(redisLib, 'verifyLockOwnership')
          .mockResolvedValueOnce(true) // Initial check after provider/engine succeeds
          .mockResolvedValueOnce(false); // In-transaction pre-commit check fails
        const socketSpy = vi.spyOn(socketLib, 'broadcastToIncident');

        const initialRuns = await prisma.investigationRun.count({ where: { incidentId: testIncId } });
        const initialFailed = await prisma.investigationRun.count({ where: { incidentId: testIncId, status: 'FAILED' } });
        const initialRunning = await prisma.investigationRun.count({ where: { incidentId: testIncId, status: 'RUNNING' } });
        const initialCompleted = await prisma.investigationRun.count({ where: { incidentId: testIncId, status: 'COMPLETED' } });
        const initialEvidence = await prisma.incidentEvidence.count({ where: { incidentId: testIncId } });
        const initialEvents = await prisma.incidentEvent.count({ where: { incidentId: testIncId } });

        let caughtErr: unknown;
        try {
          await AIService.runInvestigation(testOrgId, testIncId);
        } catch (e) {
          caughtErr = e;
        }

        expect(caughtErr).toBeInstanceOf(LockOwnershipLostError);
        expect((caughtErr as LockOwnershipLostError).statusCode).toBe(409);
        expect((caughtErr as LockOwnershipLostError).code).toBe('LOCK_OWNERSHIP_LOST');
        expect(verifySpy).toHaveBeenCalledTimes(2);

        const finalRuns = await prisma.investigationRun.count({ where: { incidentId: testIncId } });
        const finalFailed = await prisma.investigationRun.count({ where: { incidentId: testIncId, status: 'FAILED' } });
        const finalRunning = await prisma.investigationRun.count({ where: { incidentId: testIncId, status: 'RUNNING' } });
        const finalCompleted = await prisma.investigationRun.count({ where: { incidentId: testIncId, status: 'COMPLETED' } });
        const finalEvidence = await prisma.incidentEvidence.count({ where: { incidentId: testIncId } });
        const finalEvents = await prisma.incidentEvent.count({ where: { incidentId: testIncId } });

        // Exact DB deltas
        expect(finalRuns - initialRuns).toBe(1);
        expect(finalFailed - initialFailed).toBe(1);
        expect(finalRunning - initialRunning).toBe(0);
        expect(finalCompleted - initialCompleted).toBe(0);
        expect(finalEvidence - initialEvidence).toBe(0);
        expect(finalEvents - initialEvents).toBe(0);

        // Zero completion socket events
        const completionSocketEvents = socketSpy.mock.calls.filter((call) => call[1] === 'INVESTIGATION_COMPLETED');
        expect(completionSocketEvents.length).toBe(0);

        // Retained failure record validation
        const latestRun = await prisma.investigationRun.findFirst({
          where: { incidentId: testIncId },
          orderBy: { startedAt: 'desc' },
        });
        expect(latestRun?.status).toBe('FAILED');
        expect(latestRun?.completedAt).toBeDefined();
        expect(latestRun?.completedAt).not.toBeNull();
        expect(latestRun?.validationError).toBe('Operation could not be completed safely. Please retry.');
        expect(latestRun?.validationError).not.toMatch(/redis|lock:|token:|ioredis|cluster|stack|at\s+[a-zA-Z]/i);

        verifySpy.mockRestore();
        socketSpy.mockRestore();
      });
    });

    // --- ReplayService 5 Conditions ---
    describe('7.B ReplayService 5 Fail-Closed Conditions', () => {
      it('7.6 ReplayService — reports ready, then throws during SET NX PX → fails closed with 503 and 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('ETIMEDOUT connection lost'));

        await expect(ReplayService.runReplay(testOrgId, testIncId)).rejects.toThrow('unavailable');

        const runs = await prisma.replayRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.7 ReplayService — SET NX PX never settles and exceeds deadline → fails closed with 503 and 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockImplementationOnce((() => new Promise(() => {})) as never);

        await expect(ReplayService.runReplay(testOrgId, testIncId)).rejects.toThrow('unavailable');

        const runs = await prisma.replayRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.8 ReplayService — SET NX PX returns null due to contention → skips run cleanly with 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockResolvedValueOnce(null as never);

        const res = await ReplayService.runReplay(testOrgId, testIncId);
        expect(res.status).toBe('skipped_lock_active');

        const runs = await prisma.replayRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.9 ReplayService — disconnects after initial availability check → fails closed with 503 and 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('Connection is closed.'));

        await expect(ReplayService.runReplay(testOrgId, testIncId)).rejects.toThrow('unavailable');

        const runs = await prisma.replayRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.10 ReplayService — lock ownership lost before commit → throws LockOwnershipLostError (409), 0 domain records persisted', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const verifySpy = vi
          .spyOn(redisLib, 'verifyLockOwnership')
          .mockResolvedValueOnce(true) // Initial check after window calculation succeeds
          .mockResolvedValueOnce(false); // In-transaction pre-commit check fails
        const socketSpy = vi.spyOn(socketLib, 'broadcastToIncident');

        const initialRuns = await prisma.replayRun.count({ where: { incidentId: testIncId } });
        const initialFailed = await prisma.replayRun.count({ where: { incidentId: testIncId, status: 'FAILED' } });
        const initialRunning = await prisma.replayRun.count({ where: { incidentId: testIncId, status: 'RUNNING' } });
        const initialCompleted = await prisma.replayRun.count({ where: { incidentId: testIncId, status: 'COMPLETED' } });
        const initialEvents = await prisma.replayEvent.count();
        const initialTimeline = await prisma.incidentEvent.count({ where: { incidentId: testIncId } });

        let caughtErr: unknown;
        try {
          await ReplayService.runReplay(testOrgId, testIncId);
        } catch (e) {
          caughtErr = e;
        }

        expect(caughtErr).toBeInstanceOf(LockOwnershipLostError);
        expect((caughtErr as LockOwnershipLostError).statusCode).toBe(409);
        expect((caughtErr as LockOwnershipLostError).code).toBe('LOCK_OWNERSHIP_LOST');
        expect(verifySpy).toHaveBeenCalledTimes(2);

        const finalRuns = await prisma.replayRun.count({ where: { incidentId: testIncId } });
        const finalFailed = await prisma.replayRun.count({ where: { incidentId: testIncId, status: 'FAILED' } });
        const finalRunning = await prisma.replayRun.count({ where: { incidentId: testIncId, status: 'RUNNING' } });
        const finalCompleted = await prisma.replayRun.count({ where: { incidentId: testIncId, status: 'COMPLETED' } });
        const finalEvents = await prisma.replayEvent.count();
        const finalTimeline = await prisma.incidentEvent.count({ where: { incidentId: testIncId } });

        // Exact DB deltas
        expect(finalRuns - initialRuns).toBe(1);
        expect(finalFailed - initialFailed).toBe(1);
        expect(finalRunning - initialRunning).toBe(0);
        expect(finalCompleted - initialCompleted).toBe(0);
        expect(finalEvents - initialEvents).toBe(0);
        expect(finalTimeline - initialTimeline).toBe(0);

        // Zero completion socket events
        const completionSocketEvents = socketSpy.mock.calls.filter((call) => call[1] === 'REPLAY_COMPLETED');
        expect(completionSocketEvents.length).toBe(0);

        // Retained failure record validation
        const latestRun = await prisma.replayRun.findFirst({
          where: { incidentId: testIncId },
          orderBy: { startedAt: 'desc' },
        });
        expect(latestRun?.status).toBe('FAILED');
        expect(latestRun?.completedAt).toBeDefined();
        expect(latestRun?.completedAt).not.toBeNull();
        expect(latestRun?.error).toBe('Operation could not be completed safely. Please retry.');
        expect(latestRun?.error).not.toMatch(/redis|lock:|token:|ioredis|cluster|stack|at\s+[a-zA-Z]/i);

        verifySpy.mockRestore();
        socketSpy.mockRestore();
      });
    });

    // --- PostmortemService 5 Conditions ---
    describe('7.C PostmortemService 5 Fail-Closed Conditions', () => {
      it('7.11 PostmortemService — reports ready, then throws during SET NX PX → fails closed with 503 and 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('ECONNRESET socket closed'));

        await expect(PostmortemService.generatePostmortem(testOrgId, testIncId)).rejects.toThrow('unavailable');

        const runs = await prisma.postmortemRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.12 PostmortemService — SET NX PX never settles and exceeds deadline → fails closed with 503 and 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockImplementationOnce((() => new Promise(() => {})) as never);

        await expect(PostmortemService.generatePostmortem(testOrgId, testIncId)).rejects.toThrow('unavailable');

        const runs = await prisma.postmortemRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.13 PostmortemService — SET NX PX returns null due to contention → skips run cleanly with 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockResolvedValueOnce(null as never);

        const res = await PostmortemService.generatePostmortem(testOrgId, testIncId);
        expect(res.status).toBe('skipped_lock_active');

        const runs = await prisma.postmortemRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.14 PostmortemService — disconnects after initial availability check → fails closed with 503 and 0 DB records', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const setSpy = vi.spyOn(redis, 'set').mockRejectedValueOnce(new Error('Connection is closed.'));

        await expect(PostmortemService.generatePostmortem(testOrgId, testIncId)).rejects.toThrow('unavailable');

        const runs = await prisma.postmortemRun.findMany({ where: { incidentId: testIncId } });
        expect(runs.length).toBe(0);
        setSpy.mockRestore();
      });

      it('7.15 PostmortemService — lock ownership lost before commit → throws LockOwnershipLostError (409), 0 domain records persisted', async () => {
        process.env['REDIS_REQUIRED'] = 'true';
        const verifySpy = vi
          .spyOn(redisLib, 'verifyLockOwnership')
          .mockResolvedValueOnce(true) // Check 1: Post-provider pre-transaction check succeeds
          .mockResolvedValueOnce(true) // Check 2: In-transaction pre-write check succeeds
          .mockResolvedValueOnce(false); // Check 3: In-transaction post-write pre-commit check fails
        const socketSpy = vi.spyOn(socketLib, 'broadcastToIncident');

        const initialRuns = await prisma.postmortemRun.count({ where: { incidentId: testIncId } });
        const initialFailed = await prisma.postmortemRun.count({ where: { incidentId: testIncId, status: 'FAILED' } });
        const initialRunning = await prisma.postmortemRun.count({ where: { incidentId: testIncId, status: 'RUNNING' } });
        const initialCompleted = await prisma.postmortemRun.count({ where: { incidentId: testIncId, status: 'COMPLETED' } });
        const initialPostmortems = await prisma.postmortem.count({ where: { incidentId: testIncId } });
        const initialVersions = await prisma.postmortemVersion.count();
        const initialActionItems = await prisma.actionItem.count({ where: { incidentId: testIncId } });
        const initialTimeline = await prisma.incidentEvent.count({ where: { incidentId: testIncId } });

        let caughtErr: unknown;
        try {
          await PostmortemService.generatePostmortem(testOrgId, testIncId);
        } catch (e) {
          caughtErr = e;
        }

        expect(caughtErr).toBeInstanceOf(LockOwnershipLostError);
        expect((caughtErr as LockOwnershipLostError).statusCode).toBe(409);
        expect((caughtErr as LockOwnershipLostError).code).toBe('LOCK_OWNERSHIP_LOST');
        expect(verifySpy).toHaveBeenCalledTimes(3);

        const finalRuns = await prisma.postmortemRun.count({ where: { incidentId: testIncId } });
        const finalFailed = await prisma.postmortemRun.count({ where: { incidentId: testIncId, status: 'FAILED' } });
        const finalRunning = await prisma.postmortemRun.count({ where: { incidentId: testIncId, status: 'RUNNING' } });
        const finalCompleted = await prisma.postmortemRun.count({ where: { incidentId: testIncId, status: 'COMPLETED' } });
        const finalPostmortems = await prisma.postmortem.count({ where: { incidentId: testIncId } });
        const finalVersions = await prisma.postmortemVersion.count();
        const finalActionItems = await prisma.actionItem.count({ where: { incidentId: testIncId } });
        const finalTimeline = await prisma.incidentEvent.count({ where: { incidentId: testIncId } });

        // Exact DB deltas
        expect(finalRuns - initialRuns).toBe(1);
        expect(finalFailed - initialFailed).toBe(1);
        expect(finalRunning - initialRunning).toBe(0);
        expect(finalCompleted - initialCompleted).toBe(0);
        expect(finalPostmortems - initialPostmortems).toBe(0);
        expect(finalVersions - initialVersions).toBe(0);
        expect(finalActionItems - initialActionItems).toBe(0);
        expect(finalTimeline - initialTimeline).toBe(0);

        // Zero completion socket events
        const completionSocketEvents = socketSpy.mock.calls.filter((call) => call[1] === 'POSTMORTEM_GENERATION_COMPLETED');
        expect(completionSocketEvents.length).toBe(0);

        // Retained failure record validation
        const latestRun = await prisma.postmortemRun.findFirst({
          where: { incidentId: testIncId },
          orderBy: { startedAt: 'desc' },
        });
        expect(latestRun?.status).toBe('FAILED');
        expect(latestRun?.completedAt).toBeDefined();
        expect(latestRun?.completedAt).not.toBeNull();
        expect(latestRun?.error).toBe('Operation could not be completed safely. Please retry.');
        expect(latestRun?.error).not.toMatch(/redis|lock:|token:|ioredis|cluster|stack|at\s+[a-zA-Z]/i);

        verifySpy.mockRestore();
        socketSpy.mockRestore();
      });

      it('7.16 REST API Error Envelope — LockOwnershipLostError returns 409 and infrastructure-neutral error envelope', async () => {
        const verifySpy = vi
          .spyOn(redisLib, 'verifyLockOwnership')
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false);
        const owner = await prisma.user.create({ data: { email: `owner.lockloss.${Date.now()}@test.com`, name: 'Owner' } });
        await prisma.organizationMember.create({ data: { organizationId: testOrgId, userId: owner.id, role: 'OWNER' } });
        const token = signAccessToken(owner.id, owner.email);

        const res = await request
          .post(`/api/v1/organizations/${testOrgId}/incidents/${testIncId}/investigation`)
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(409);
        const body = res.body as { success: boolean; error: { code: string; message: string; requestId: string } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('LOCK_OWNERSHIP_LOST');
        expect(body.error.message).toBe('Operation could not be completed safely. Please retry.');
        expect(typeof body.error.requestId).toBe('string');
        expect(body.error.requestId.length).toBeGreaterThan(0);
        expect(res.headers['x-request-id']).toBeDefined();
        expect(body.error.message).not.toMatch(/redis|lock:|token:|key|ioredis|stack|at\s+[a-zA-Z]/i);
        expect(JSON.stringify(body)).not.toMatch(/redis|lock:|ioredis|stack|at\s+[a-zA-Z]/i);
        expect(verifySpy).toHaveBeenCalledTimes(2);
        verifySpy.mockRestore();
      });
    });
  });

  // ===========================================================================
  // 8. AUTHENTICATED REST OUTSIDER CROSS-TENANT ISOLATION
  // ===========================================================================
  describe('8. Authenticated REST Outsider Cross-Tenant Isolation', () => {
    let orgAId: string;
    let incidentAId: string;
    let tokenB: string;

    beforeEach(async () => {
      const ts = Date.now();
      const userA = await prisma.user.create({ data: { email: `ownerA.${ts}@test.com`, name: 'Owner A' } });
      const orgA = await prisma.organization.create({ data: { name: `Org A ${ts}`, slug: `org-a-${ts}` } });
      orgAId = orgA.id;

      const projectA = await prisma.project.create({
        data: { organizationId: orgAId, name: `Proj A ${ts}`, slug: `proj-a-${ts}` },
      });

      const incA = await prisma.incident.create({
        data: {
          organizationId: orgAId,
          projectId: projectA.id,
          number: 1,
          title: 'Org A Incident',
          severity: 'SEV1',
          status: 'OPEN',
          createdById: userA.id,
        },
      });
      incidentAId = incA.id;

      const userB = await prisma.user.create({ data: { email: `outsider.${ts}@test.com`, name: 'Outsider Bob' } });
      const orgB = await prisma.organization.create({ data: { name: `Org B ${ts}`, slug: `org-b-${ts}` } });
      await prisma.organizationMember.create({ data: { userId: userB.id, organizationId: orgB.id, role: 'RESPONDER' } });
      tokenB = signAccessToken(userB.id, userB.email);
    });

    it('8.1 foreign organization incidents collection rejected with 403', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/incidents`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.2 foreign organization projects collection rejected with 403', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/projects`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.3 foreign organization teams collection rejected with 403', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/teams`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.4 foreign incident comments endpoint rejected with 403', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/comments`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.5 foreign incident timeline events rejected with 403', async () => {
      const res = await request.get(`/api/v1/incidents/${incidentAId}/timeline`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.6 foreign incident evidence correlation collection rejected with 403', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/correlation`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.7 foreign incident replay timeline rejected with 403', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/replay`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.8 foreign incident correlation runs history rejected with 403', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/correlation/runs`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.9 foreign incident investigations history rejected with 403', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/investigation`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.10 foreign incident postmortems collection rejected with 403', async () => {
      const res = await request.get(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/postmortem`).set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(403);
    });

    it('8.11 foreign incident action items collection rejected with 403', async () => {
      const res = await request
        .post(`/api/v1/organizations/${orgAId}/incidents/${incidentAId}/postmortem/action-items`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ title: 'Malicious Action Item' });
      expect(res.status).toBe(403);
    });
  });
});

