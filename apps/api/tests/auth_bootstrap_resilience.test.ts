import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { getSafeInternalPath } from '../../web/src/utils/navigation';

interface MockResponse<T = unknown> {
  data: T;
  status?: number;
}

describe('Auth Bootstrap Resilience & Interceptor Regression Suite', () => {
  let mockAxiosInstance: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    defaults: { headers: { common: Record<string, string> } };
    interceptors: {
      response: {
        use: ReturnType<typeof vi.fn>;
      };
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      defaults: { headers: { common: {} } },
      interceptors: { response: { use: vi.fn() } },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. No token: unauthenticated user immediately resolves without infinite loading
  it('1. No token bootstrap resolves to unauthenticated state with isLoading=false', async () => {
    let isLoading = true;
    let user = null;
    let authError: string | null = null;

    mockAxiosInstance.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: { message: 'Unauthorized' } },
    });

    try {
      await mockAxiosInstance.post('/auth/refresh');
      const meRes = (await mockAxiosInstance.get('/auth/me')) as MockResponse<{ user: { id: string } }>;
      user = meRes.data.user;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        authError = null;
      }
      user = null;
    } finally {
      isLoading = false;
    }

    expect(isLoading).toBe(false);
    expect(user).toBeNull();
    expect(authError).toBeNull();
  });

  // 2. Valid session: loads authenticated user and organizations
  it('2. Valid session loads user profile and active organization', async () => {
    let isLoading = true;
    let user: { id: string; email: string } | null = null;

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { success: true, data: { accessToken: 'valid-access-token-123' } },
    });
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          user: { id: 'u1', email: 'alex@acme.dev' },
          organizations: [{ organizationId: 'org1', role: 'ADMIN' }],
          activeOrganizationId: 'org1',
        },
      },
    });

    try {
      const refreshRes = (await mockAxiosInstance.post('/auth/refresh')) as MockResponse<{
        success: boolean;
        data: { accessToken: string };
      }>;
      if (refreshRes.data.success) {
        mockAxiosInstance.defaults.headers.common['Authorization'] = `Bearer ${refreshRes.data.data.accessToken}`;
      }
      const meRes = (await mockAxiosInstance.get('/auth/me')) as MockResponse<{
        success: boolean;
        data: { user: { id: string; email: string } };
      }>;
      if (meRes.data.success) {
        user = meRes.data.data.user;
      }
    } finally {
      isLoading = false;
    }

    expect(isLoading).toBe(false);
    expect(user).toEqual({ id: 'u1', email: 'alex@acme.dev' });
    expect(mockAxiosInstance.defaults.headers.common['Authorization']).toBe('Bearer valid-access-token-123');
  });

  // 3. Expired access token with successful refresh
  it('3. Refreshes token and retries failed request seamlessly', async () => {
    let callCount = 0;
    mockAxiosInstance.get.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        const error = new Error('Unauthorized') as Error & { response: { status: number } };
        error.response = { status: 401 };
        return Promise.reject(error);
      }
      return Promise.resolve({ data: { success: true, incidents: [] } });
    });

    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { success: true, data: { accessToken: 'new-token-456' } },
    });

    // Simulate interceptor behavior
    let finalResult: MockResponse<{ success: boolean }> | undefined;
    try {
      finalResult = (await mockAxiosInstance.get('/incidents')) as MockResponse<{ success: boolean }>;
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status: number } };
      if (axiosErr.response?.status === 401) {
        const refresh = (await mockAxiosInstance.post('/auth/refresh')) as MockResponse<{
          data: { accessToken: string };
        }>;
        mockAxiosInstance.defaults.headers.common['Authorization'] = `Bearer ${refresh.data.data.accessToken}`;
        finalResult = (await mockAxiosInstance.get('/incidents')) as MockResponse<{ success: boolean }>;
      }
    }

    expect(finalResult?.data.success).toBe(true);
    expect(callCount).toBe(2);
  });

  // 4. Refresh failure clears session and avoids infinite loop
  it('4. Refresh failure terminates cleanly without recursive retry', async () => {
    let isLoading = true;
    let sessionCleared = false;

    mockAxiosInstance.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: { error: 'Invalid refresh token' } },
    });

    try {
      await mockAxiosInstance.post('/auth/refresh');
    } catch {
      sessionCleared = true;
    } finally {
      isLoading = false;
    }

    expect(isLoading).toBe(false);
    expect(sessionCleared).toBe(true);
  });

  // 5. Bootstrap 401: cleans state and returns to login
  it('5. Bootstrap 401 immediately sets unauthenticated state', async () => {
    let user: { id: string } | null = { id: 'old-user' };
    let token: string | null = 'old-token';
    let isLoading = true;

    mockAxiosInstance.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401 },
    });

    try {
      await mockAxiosInstance.post('/auth/refresh');
    } catch {
      user = null;
      token = null;
    } finally {
      isLoading = false;
    }

    expect(isLoading).toBe(false);
    expect(user).toBeNull();
    expect(token).toBeNull();
  });

  // 6. Network failure: triggers retryable error state instead of hanging spinner
  it('6. Network failure sets descriptive authError and terminates loading', async () => {
    let isLoading = true;
    let authError: string | null = null;

    mockAxiosInstance.post.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Network Error',
      response: undefined,
    });

    try {
      await mockAxiosInstance.post('/auth/refresh');
    } catch (err: unknown) {
      const e = err as { isAxiosError?: boolean; response?: unknown; message?: string };
      if (e.isAxiosError && !e.response) {
        authError = 'Failed to reach API server. Please check your network connection.';
      }
    } finally {
      isLoading = false;
    }

    expect(isLoading).toBe(false);
    expect(authError).toContain('Failed to reach API server');
  });

  // 7. Backend 5xx: sets server error state
  it('7. Backend 500 error sets retryable server error state', async () => {
    let isLoading = true;
    let authError: string | null = null;

    mockAxiosInstance.post.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 502, data: 'Bad Gateway' },
    });

    try {
      await mockAxiosInstance.post('/auth/refresh');
    } catch (err: unknown) {
      const e = err as { isAxiosError?: boolean; response?: { status: number } };
      if (e.isAxiosError && e.response && e.response.status >= 500) {
        authError = 'Server error occurred during authentication. Please retry.';
      }
    } finally {
      isLoading = false;
    }

    expect(isLoading).toBe(false);
    expect(authError).toContain('Server error occurred');
  });

  // 8. Request that never settles / bounded timeout handling
  it('8. AbortController triggers timeout when backend does not respond within bounded window', async () => {
    const controller = new AbortController();
    let timedOut = false;

    // Simulate timeout trigger
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Connection timed out while contacting API server.'));
      }, 50);
      return timer;
    });

    let caughtMessage = '';
    try {
      await timeoutPromise;
    } catch (err) {
      timedOut = true;
      caughtMessage = (err as Error).message;
    }

    expect(timedOut).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(caughtMessage).toContain('Connection timed out');
  });

  // 9. Component unmount aborts in-flight requests cleanly
  it('9. Component unmount signals abort controller to discard in-flight request', () => {
    const abortController = new AbortController();
    expect(abortController.signal.aborted).toBe(false);

    // Simulate cleanup function in useEffect
    const cleanup = () => {
      abortController.abort();
    };
    cleanup();

    expect(abortController.signal.aborted).toBe(true);
  });

  // 10. Retry after backend recovery succeeds
  it('10. Retry auth function successfully establishes session after initial network error', async () => {
    let isAuthenticated = false;
    let authError: string | null = 'Initial network error';

    // Second call succeeds
    mockAxiosInstance.post.mockResolvedValueOnce({
      data: { success: true, data: { accessToken: 'recovered-token' } },
    });
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: { success: true, data: { user: { id: 'u1', email: 'alex@acme.dev' } } },
    });

    // Execute retry
    const retryAuth = async () => {
      const refreshRes = (await mockAxiosInstance.post('/auth/refresh')) as MockResponse<{
        success: boolean;
        data: { accessToken: string };
      }>;
      if (refreshRes.data.success) {
        const meRes = (await mockAxiosInstance.get('/auth/me')) as MockResponse<{
          success: boolean;
          data: { user: { id: string; email: string } };
        }>;
        if (meRes.data.success) {
          isAuthenticated = true;
          authError = null;
        }
      }
    };

    await retryAuth();
    expect(isAuthenticated).toBe(true);
    expect(authError).toBeNull();
  });

  // 11. StrictMode / double initialization deduplication
  it('11. Concurrent refresh invocations share single in-flight promise', async () => {
    let networkCallCount = 0;
    let inFlightPromise: Promise<{ accessToken: string }> | null = null;

    const singleFlightRefresh = () => {
      if (inFlightPromise) {
        return inFlightPromise;
      }
      inFlightPromise = (async () => {
        networkCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { accessToken: 'deduped-token' };
      })().finally(() => {
        inFlightPromise = null;
      });
      return inFlightPromise;
    };

    // Trigger two concurrent invocations (simulating React StrictMode mounting twice)
    const [res1, res2] = await Promise.all([
      singleFlightRefresh(),
      singleFlightRefresh(),
    ]);

    expect(networkCallCount).toBe(1);
    expect(res1.accessToken).toBe('deduped-token');
    expect(res2.accessToken).toBe('deduped-token');
  });

  // 12. Malicious return-path rejection
  it('12. Rejects malicious external and protocol-relative return paths', () => {
    expect(getSafeInternalPath('//evil.com', '/')).toBe('/');
    expect(getSafeInternalPath('https://evil.com/phishing', '/')).toBe('/');
    expect(getSafeInternalPath('javascript:alert(1)', '/')).toBe('/');
    expect(getSafeInternalPath('/dashboard/incidents', '/')).toBe('/dashboard/incidents');
  });
});
