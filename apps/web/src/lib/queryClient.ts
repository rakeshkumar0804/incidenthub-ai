import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      gcTime: 1000 * 60 * 5,
      retry: (failureCount, error) => {
        if (typeof error === 'object' && error !== null && 'response' in error) {
          const e = error as { response?: { status?: number } };
          const status = e.response?.status;
          if (status !== undefined && status >= 400 && status < 500) return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
