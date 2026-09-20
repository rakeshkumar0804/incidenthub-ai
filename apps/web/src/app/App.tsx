import { Suspense, lazy } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { queryClient } from '../lib/queryClient';
import { AuthProvider } from '../features/auth/AuthContext';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { AppLayout } from '../layouts/AppLayout';
import { ErrorBoundary } from '../components/ErrorBoundary';

const DashboardPage = lazy(() => import('../pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const LoginPage = lazy(() => import('../pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('../pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('../pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('../pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import('../pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })));
const OrganizationsPage = lazy(() => import('../pages/OrganizationsPage').then((m) => ({ default: m.OrganizationsPage })));
const MembersPage = lazy(() => import('../pages/MembersPage').then((m) => ({ default: m.MembersPage })));
const AcceptInvitationPage = lazy(() => import('../pages/AcceptInvitationPage').then((m) => ({ default: m.AcceptInvitationPage })));
const TeamsPage = lazy(() => import('../pages/TeamsPage').then((m) => ({ default: m.TeamsPage })));
const ProjectsPage = lazy(() => import('../pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const ServicesPage = lazy(() => import('../pages/ServicesPage').then((m) => ({ default: m.ServicesPage })));
const IncidentsPage = lazy(() => import('../pages/IncidentsPage').then((m) => ({ default: m.IncidentsPage })));
const CreateIncidentPage = lazy(() => import('../pages/CreateIncidentPage').then((m) => ({ default: m.CreateIncidentPage })));
const IncidentDetailPage = lazy(() => import('../pages/IncidentDetailPage').then((m) => ({ default: m.IncidentDetailPage })));
const GitHubSettingsPage = lazy(() => import('../pages/GitHubSettingsPage').then((m) => ({ default: m.GitHubSettingsPage })));
const SentrySettingsPage = lazy(() => import('../pages/SentrySettingsPage').then((m) => ({ default: m.SentrySettingsPage })));
const IntegrationsSettingsPage = lazy(() => import('../pages/IntegrationsSettingsPage').then((m) => ({ default: m.IntegrationsSettingsPage })));
const AnalyticsDashboardPage = lazy(() => import('../pages/AnalyticsDashboardPage').then((m) => ({ default: m.AnalyticsDashboardPage })));
const NotFoundPage = lazy(() => import('../pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

function PageLoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px] w-full p-8" role="status" aria-label="Loading page">
      <div className="w-8 h-8 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<PageLoadingFallback />}>
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
            </Suspense>
          </BrowserRouter>
          {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
