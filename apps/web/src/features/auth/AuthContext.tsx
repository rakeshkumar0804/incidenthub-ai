import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { apiClient } from '../../lib/axios';
import type { UserDto, OrgMemberDto, AuthResponseData, ApiSuccess } from '@incidenthub/shared';

interface AuthContextType {
  user: UserDto | null;
  organizations: OrgMemberDto[];
  activeOrg: OrgMemberDto | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  login: (data: AuthResponseData) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  retryAuth: () => Promise<void>;
  setActiveOrgId: (orgId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserDto | null>(null);
  const [organizations, setOrganizations] = useState<OrgMemberDto[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const inFlightPromiseRef = useRef<Promise<void> | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const applyAuthData = useCallback((data: AuthResponseData) => {
    setUser(data.user);
    setOrganizations(data.organizations || []);
    const initialOrgId = data.activeOrganizationId || data.organizations?.[0]?.organizationId || null;
    setActiveOrgIdState(initialOrgId);
    setAuthError(null);
    if (data.accessToken) {
      setAccessToken(data.accessToken);
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
    }
  }, []);

  const refreshUser = useCallback(async (): Promise<void> => {
    if (inFlightPromiseRef.current) {
      return inFlightPromiseRef.current;
    }

    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    activeAbortControllerRef.current = abortController;

    const promise = (async () => {
      setIsLoading(true);
      setAuthError(null);

      // Bounded 15-second bootstrap timeout
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, 15000);

      try {
        // First attempt to refresh access token via cookie
        const refreshRes = await apiClient.post<ApiSuccess<{ accessToken: string }>>(
          '/auth/refresh',
          {},
          { signal: abortController.signal },
        );

        if (refreshRes.data.success && refreshRes.data.data.accessToken) {
          setAccessToken(refreshRes.data.data.accessToken);
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${refreshRes.data.data.accessToken}`;
        }

        const { data } = await apiClient.get<
          ApiSuccess<{ user: UserDto; organizations: OrgMemberDto[]; activeOrganizationId?: string }>
        >('/auth/me', { signal: abortController.signal });

        if (data.success) {
          setUser(data.data.user);
          setOrganizations(data.data.organizations || []);
          setActiveOrgIdState(data.data.activeOrganizationId || data.data.organizations?.[0]?.organizationId || null);
          setAuthError(null);
        }
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          setAuthError('Connection timed out while contacting API server.');
        } else if (axios.isAxiosError(err)) {
          if (!err.response || err.code === 'ECONNABORTED' || err.message?.includes('Network Error')) {
            setAuthError('Failed to reach API server. Please check your network connection.');
          } else if (err.response.status >= 500) {
            setAuthError('Server error occurred during authentication. Please retry.');
          } else if (err.response.status === 401) {
            // Standard unauthenticated state
            setAuthError(null);
          }
        }
        setUser(null);
        setOrganizations([]);
        setActiveOrgIdState(null);
        setAccessToken(null);
        delete apiClient.defaults.headers.common['Authorization'];
      } finally {
        clearTimeout(timeoutId);
        setIsLoading(false);
        inFlightPromiseRef.current = null;
      }
    })();

    inFlightPromiseRef.current = promise;
    return promise;
  }, []);

  const retryAuth = useCallback(async () => {
    await refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    void refreshUser();
    return () => {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
  }, [refreshUser]);

  const login = useCallback(
    (data: AuthResponseData) => {
      applyAuthData(data);
    },
    [applyAuthData],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore logout errors
    } finally {
      setUser(null);
      setOrganizations([]);
      setActiveOrgIdState(null);
      setAccessToken(null);
      setAuthError(null);
      delete apiClient.defaults.headers.common['Authorization'];
    }
  }, []);

  const setActiveOrgId = useCallback((orgId: string) => {
    setActiveOrgIdState(orgId);
  }, []);

  const activeOrg = organizations.find((o) => o.organizationId === activeOrgId) || organizations[0] || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        organizations,
        activeOrg,
        accessToken,
        isAuthenticated: !!user,
        isLoading,
        authError,
        login,
        logout,
        refreshUser,
        retryAuth,
        setActiveOrgId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
