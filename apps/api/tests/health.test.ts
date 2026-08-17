import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import type { HealthResponse, ApiError } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('GET /api/v1/health', () => {
  it('returns 200 with status ok when database is connected', async () => {
    const res = await request.get('/api/v1/health');
    expect(res.status).toBe(200);
    const body = res.body as HealthResponse;
    expect(body.status).toBe('ok');
    expect(body.services.database).toBe('connected');
    expect(body.timestamp).toBeDefined();
  });
});

describe('404 handler', () => {
  it('returns 404 with structured error for unknown routes', async () => {
    const res = await request.get('/api/v1/this-route-does-not-exist');
    expect(res.status).toBe(404);
    const body = res.body as ApiError;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for unsupported methods', async () => {
    const res = await request.delete('/api/v1/health');
    expect(res.status).toBe(404);
    const body = res.body as ApiError;
    expect(body.success).toBe(false);
  });
});
