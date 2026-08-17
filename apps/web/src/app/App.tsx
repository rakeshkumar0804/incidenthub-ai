import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { queryClient } from '../lib/queryClient';
import { AuthProvider } from '../features/auth/AuthContext';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { AppLayout } from '../layouts/AppLayout';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';
import { OrganizationsPage } from '../pages/OrganizationsPage';
import { MembersPage } from '../pages/MembersPage';
import { AcceptInvitationPage } from '../pages/AcceptInvitationPage';
import { TeamsPage } from '../pages/TeamsPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { ServicesPage } from '../pages/ServicesPage';
import { IncidentsPage } from '../pages/IncidentsPage';
import { CreateIncidentPage } from '../pages/CreateIncidentPage';
import { IncidentDetailPage } from '../pages/IncidentDetailPage';
import { GitHubSettingsPage } from '../pages/GitHubSettingsPage';
import { SentrySettingsPage } from '../pages/SentrySettingsPage';
import { IntegrationsSettingsPage } from '../pages/IntegrationsSettingsPage';
import { AnalyticsDashboardPage } from '../pages/AnalyticsDashboardPage';
import { NotFoundPage } from '../pages/NotFoundPage';

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public Auth & Invitation Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/accept-invitation" element={<AcceptInvitationPage />} />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="incidents" element={<IncidentsPage />} />
              <Route path="incidents/new" element={<CreateIncidentPage />} />
              <Route path="incidents/:incidentId" element={<IncidentDetailPage />} />
              <Route path="analytics" element={<AnalyticsDashboardPage />} />
              <Route path="organizations" element={<OrganizationsPage />} />
              <Route path="organizations/:organizationId/members" element={<MembersPage />} />
              <Route path="members" element={<MembersPage />} />
              <Route path="organizations/:organizationId/teams" element={<TeamsPage />} />
              <Route path="teams" element={<TeamsPage />} />
              <Route path="organizations/:organizationId/projects" element={<ProjectsPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:projectId/services" element={<ServicesPage />} />
              <Route path="settings/github" element={<GitHubSettingsPage />} />
              <Route path="settings/sentry" element={<SentrySettingsPage />} />
              <Route path="settings/integrations" element={<IntegrationsSettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
