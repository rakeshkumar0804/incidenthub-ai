import { describe, it, expect } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import type { ApiSuccess, ApiError, AuthResponseData } from '@incidenthub/shared';

const app = createApp();
const request = supertest(app);

describe('Auth Endpoints (/api/v1/auth)', () => {
  const testEmail = `auth-test-${Date.now()}@example.com`;
  const testPassword = 'SecurePassword123!';
  let accessToken = '';
  let refreshTokenCookie = '';
  let verificationToken = '';
  let resetToken = '';

  it('1. POST /register — creates user, org, OWNER membership, and returns tokens', async () => {
    const res = await request.post('/api/v1/auth/register').send({
      name: 'Auth Test User',
      email: testEmail,
      password: testPassword,
      confirmPassword: testPassword,
    });

    expect(res.status).toBe(201);
    const body = res.body as ApiSuccess<AuthResponseData & { verificationToken?: string }>;
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(testEmail);
    expect(body.data.user.name).toBe('Auth Test User');
    expect(body.data.accessToken).toBeDefined();
    expect(body.data.organizations).toHaveLength(1);
    expect(body.data.organizations[0].role).toBe('OWNER');
    expect(body.data.verificationToken).toBeDefined();

    accessToken = body.data.accessToken;
    verificationToken = body.data.verificationToken || '';

    // Cookie set
    const cookies = res.get('Set-Cookie');
    expect(cookies).toBeDefined();
    const refreshCookie = cookies?.find((c: string) => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();
    refreshTokenCookie = refreshCookie || '';
  });

  it('2. POST /register — fails on duplicate email', async () => {
    const res = await request.post('/api/v1/auth/register').send({
      name: 'Duplicate User',
      email: testEmail,
      password: testPassword,
      confirmPassword: testPassword,
    });

    expect(res.status).toBe(409);
    const body = res.body as ApiError;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
  });

  it('3. POST /login — fails on invalid password', async () => {
    const res = await request.post('/api/v1/auth/login').send({
      email: testEmail,
      password: 'WrongPassword!',
    });

    expect(res.status).toBe(401);
    const body = res.body as ApiError;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('4. POST /login — succeeds on valid credentials', async () => {
    const res = await request.post('/api/v1/auth/login').send({
      email: testEmail,
      password: testPassword,
    });

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<AuthResponseData>;
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(testEmail);
    expect(body.data.accessToken).toBeDefined();

    accessToken = body.data.accessToken;
    const cookies = res.get('Set-Cookie');
    const refreshCookie = cookies?.find((c: string) => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();
    refreshTokenCookie = refreshCookie || '';
  });

  it('5. GET /me — returns authenticated user profile and orgs', async () => {
    const res = await request
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ user: { email: string }; organizations: unknown[] }>;
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe(testEmail);
    expect(body.data.organizations.length).toBeGreaterThan(0);
  });

  it('6. GET /me — rejects unauthenticated request', async () => {
    const res = await request.get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('7. POST /refresh — rotates refresh token cookie and issues new access token', async () => {
    const res = await request
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshTokenCookie);

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ accessToken: string }>;
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBeDefined();

    accessToken = body.data.accessToken;
    const cookies = res.get('Set-Cookie');
    const refreshCookie = cookies?.find((c: string) => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();
    refreshTokenCookie = refreshCookie || '';
  });

  it('8. POST /verify-email — verifies user email with token', async () => {
    const res = await request
      .post('/api/v1/auth/verify-email')
      .send({ token: verificationToken });

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ message: string }>;
    expect(body.success).toBe(true);

    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(user?.emailVerified).toBe(true);
  });

  it('9. POST /forgot-password — generates password reset token', async () => {
    const res = await request
      .post('/api/v1/auth/forgot-password')
      .send({ email: testEmail });

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ resetToken?: string }>;
    expect(body.success).toBe(true);
    expect(body.data.resetToken).toBeDefined();
    resetToken = body.data.resetToken || '';
  });

  it('10. POST /reset-password — updates password and revokes previous sessions', async () => {
    const newPassword = 'NewSecurePassword456!';
    const res = await request.post('/api/v1/auth/reset-password').send({
      token: resetToken,
      newPassword,
      confirmPassword: newPassword,
    });

    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ message: string }>;
    expect(body.success).toBe(true);

    // Old login fails
    const oldLogin = await request.post('/api/v1/auth/login').send({
      email: testEmail,
      password: testPassword,
    });
    expect(oldLogin.status).toBe(401);

    // New password login succeeds
    const newLogin = await request.post('/api/v1/auth/login').send({
      email: testEmail,
      password: newPassword,
    });
    expect(newLogin.status).toBe(200);
  });

  it('11. POST /logout — revokes session cookie', async () => {
    const res = await request
      .post('/api/v1/auth/logout')
      .set('Cookie', refreshTokenCookie);

    expect(res.status).toBe(200);

    // Subsequent refresh fails
    const refreshRes = await request
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshTokenCookie);
    expect(refreshRes.status).toBe(401);
  });

  it('12. POST /dev-restore-owner — restores owner membership in development environment', async () => {
    const res = await request.post('/api/v1/auth/dev-restore-owner').send({});
    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ user: { email: string }; organizations: Array<{ role: string }> }>;
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('rakesh6651@company.com');
    expect(body.data.organizations[0]?.role).toBe('OWNER');
  });

  it('13. POST /dev-reset-viewer — resets viewer password in development environment', async () => {
    const res = await request.post('/api/v1/auth/dev-reset-viewer').send({});
    expect(res.status).toBe(200);
    const body = res.body as ApiSuccess<{ user: { email: string }; organizations: Array<{ role: string }> }>;
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('rakesh5566@company.com');
    expect(body.data.organizations[0]?.role).toBe('VIEWER');
  });
});
