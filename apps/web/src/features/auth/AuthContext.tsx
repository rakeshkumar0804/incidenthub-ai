import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../../lib/axios';
import type { UserDto, OrgMemberDto, AuthResponseData, ApiSuccess } from '@incidenthub/shared';

interface AuthContextType {
  user: UserDto | null;
  organizations: OrgMemberDto[];
  activeOrg: OrgMemberDto | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (data: AuthResponseData) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setActiveOrgId: (orgId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function sortOrgs(orgs: OrgMemberDto[]): OrgMemberDto[] {
  return [...orgs].sort((a, b) => {
    if (a.organization.slug === 'acme-engineering' || a.organization.name === 'Acme Engineering') return -1;
    if (b.organization.slug === 'acme-engineering' || b.organization.name === 'Acme Engineering') return 1;
    return 0;
  });
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserDto | null>(null);
  const [organizations, setOrganizations] = useState<OrgMemberDto[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const applyAuthData = useCallback((data: AuthResponseData) => {
    const sorted = sortOrgs(data.organizations || []);
    setUser(data.user);
    setOrganizations(sorted);
    const initialOrgId = data.activeOrganizationId || sorted[0]?.organizationId || null;
    setActiveOrgIdState(initialOrgId);
    if (data.accessToken) {
      setAccessToken(data.accessToken);
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      // First attempt to refresh access token via cookie
      const refreshRes = await apiClient.post<ApiSuccess<{ accessToken: string }>>('/auth/refresh');
      if (refreshRes.data.success && refreshRes.data.data.accessToken) {
        setAccessToken(refreshRes.data.data.accessToken);
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${refreshRes.data.data.accessToken}`;
      }

      const { data } = await apiClient.get<ApiSuccess<{ user: UserDto; organizations: OrgMemberDto[]; activeOrganizationId?: string }>>('/auth/me');
      if (data.success) {
        const sorted = sortOrgs(data.data.organizations || []);
        setUser(data.data.user);
        setOrganizations(sorted);
        setActiveOrgIdState(data.data.activeOrganizationId || sorted[0]?.organizationId || null);
      }
    } catch {
      setUser(null);
      setOrganizations([]);
      setActiveOrgIdState(null);
      setAccessToken(null);
    } finally {
      setIsLoading(false);
    }

  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback((data: AuthResponseData) => {
    applyAuthData(data);
  }, [applyAuthData]);

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
        login,
        logout,
        refreshUser,
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
