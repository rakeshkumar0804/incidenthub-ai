import axios from 'axios';

const apiBaseUrl = (import.meta.env['VITE_API_URL'] as string | undefined)?.replace(/\/+$/, '') || '';

export const apiClient = axios.create({
  baseURL: apiBaseUrl ? `${apiBaseUrl}/api/v1` : '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
  timeout: 15000,
});

let isRefreshing = false;

let failedQueue: Array<{ resolve: (token: string) => void; reject: (error: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || !error.config) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const originalRequest = error.config as typeof error.config & { _retry?: boolean };

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/login')
    ) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              if (originalRequest.headers) {
                originalRequest.headers['Authorization'] = `Bearer ${token}`;
              }
              resolve(apiClient(originalRequest));
            },
            reject: (err: unknown) => {
              reject(err instanceof Error ? err : new Error(String(err)));
            },
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await apiClient.post<{ success: boolean; data: { accessToken: string } }>('/auth/refresh');
        if (data.success && data.data.accessToken) {
          const newToken = data.data.accessToken;
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
          if (originalRequest.headers) {
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
          }
          processQueue(null, newToken);
          return apiClient(originalRequest);
        }
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  },
);
