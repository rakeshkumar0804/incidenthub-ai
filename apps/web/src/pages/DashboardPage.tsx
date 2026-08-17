import { useHealth } from '../hooks/useHealth';

interface RoadmapPhase {
  num: number;
  phase: string;
  label: string;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'UPCOMING';
  description: string;
}

const ROADMAP_PHASES: RoadmapPhase[] = [
  {
    num: 1,
    phase: 'PHASE 1',
    label: 'Foundation',
    status: 'COMPLETED',
    description: 'Monorepo scaffold, PostgreSQL schema, Redis setup, Express API base & Vite React frontend.',
  },
  {
    num: 2,
    phase: 'PHASE 2',
    label: 'Authentication & Organization RBAC',
    status: 'COMPLETED',
    description: 'JWT Auth, Refresh Token Rotation, Multi-Tenant Organizations, Member Management & RBAC Roles.',
  },
  {
    num: 3,
    phase: 'PHASE 3',
    label: 'Teams, Projects & Services Hierarchy',
    status: 'COMPLETED',
    description: 'Teams, Projects, Services CRUD, service owner assignments, and tenant boundary security.',
  },
  {
    num: 4,
    phase: 'PHASE 4',
    label: 'Incident Lifecycle Engine',
    status: 'COMPLETED',
    description: 'Incident CRUD, severity/status state machine, number generation, timeline events & RBAC enforcement.',
  },
  {
    num: 5,
    phase: 'PHASE 5',
    label: 'Real-Time Collaboration',
    status: 'COMPLETED',
    description: 'Socket.io incident rooms, live timeline updates, comments, replies, presence & assignment sync.',
  },
  {
    num: 6,
    phase: 'PHASE 6',
    label: 'GitHub Integration',
    status: 'COMPLETED',
    description: 'OAuth, webhooks, repo metadata, commits, PRs, deployments, workflow runs & incident linking.',
  },
  {
    num: 7,
    phase: 'PHASE 7',
    label: 'Sentry Integration',
    status: 'COMPLETED',
    description: 'Webhook handling, error events, stack traces, spike detection & incident triggers.',
  },
  {
    num: 8,
    phase: 'PHASE 8',
    label: 'Correlation Engine',
    status: 'COMPLETED',
    description: 'Signal correlation across GitHub, Sentry, timeline & historical data with confidence scoring.',
  },
  {
    num: 9,
    phase: 'PHASE 9',
    label: 'AI Investigation Engine',
    status: 'COMPLETED',
    description: 'Evidence-backed root cause analysis, risk assessments & explicit uncertainty reporting.',
  },
  {
    num: 10,
    phase: 'PHASE 10',
    label: 'Incident Replay',
    status: 'COMPLETED',
    description: 'Automated chronological incident timeline reconstruction from detection to recovery.',
  },
  {
    num: 11,
    phase: 'PHASE 11',
    label: 'AI Postmortems',
    status: 'COMPLETED',
    description: 'AI-generated postmortem versions with human review, editing & action item tracking.',
  },
  {
    num: 12,
    phase: 'PHASE 12',
    label: 'Analytics + Engineering Intelligence',
    status: 'COMPLETED',
    description: 'Incident trends, MTTR/MTTD, candidate deployment correlations & engineering signals.',
  },
  {
    num: 13,
    phase: 'PHASE 13',
    label: 'Slack + Jira Integrations',
    status: 'COMPLETED',
    description: 'Slack incident channels/notifications and Jira action item issue creation/syncing.',
  },
  {
    num: 14,
    phase: 'PHASE 14',
    label: 'Production Hardening + Final Polish',
    status: 'COMPLETED',
    description: 'Redis resilience, tiered rate limiting, security headers, request tracing, health probes & polish.',
  },
];

export function DashboardPage() {
  const { data: health, isLoading, isError } = useHealth();

  const apiStatus = isLoading ? 'loading' : isError ? 'error' : health?.status === 'ok' ? 'ok' : 'degraded';

  return (
    <div className="flex min-h-screen flex-col items-center justify-start px-4 py-12">
      {/* Brand Header */}
      <div className="mb-10 text-center">
        <div className="mb-4 flex items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-500/20">
            <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-xl font-semibold text-white">IncidentHub AI</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Engineering Incident{' '}
          <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
            Intelligence Platform
          </span>
        </h1>
        <p className="mt-3 max-w-2xl text-base text-gray-400">
          Correlates GitHub activity, Sentry errors, and team actions to deliver
          evidence-backed root-cause analysis and AI-generated postmortems.
        </p>

        {/* Real-time System Status Indicator */}
        <div className="mt-6 flex items-center justify-center gap-4">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-gray-300 backdrop-blur">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                apiStatus === 'ok'
                  ? 'bg-emerald-400 animate-pulse'
                  : apiStatus === 'degraded'
                  ? 'bg-amber-400'
                  : apiStatus === 'loading'
                  ? 'bg-blue-400 animate-spin'
                  : 'bg-rose-500'
              }`}
            />
            <span>
              System Status:{' '}
              <strong className="text-white uppercase">
                {apiStatus === 'ok' ? 'Operational' : apiStatus === 'degraded' ? 'Degraded' : apiStatus}
              </strong>
            </span>
          </div>

          {health?.services && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-gray-400">
              <span>DB: <strong className="text-emerald-400">{health.services.database}</strong></span>
              <span>Redis: <strong className={health.services.redis === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{health.services.redis}</strong></span>
            </div>
          )}
        </div>
      </div>

      <div className="grid w-full max-w-5xl gap-6 md:grid-cols-2">
        {/* Phase 1 Completion Status Card */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Phase 1 — Foundation</h2>
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
              COMPLETED
            </span>
          </div>
          <ul className="space-y-2.5">
            {[
              'Monorepo architecture (npm workspaces)',
              'PostgreSQL 15 + Prisma 13-entity schema',
              'Redis 7 infrastructure (Docker Compose)',
              'Express + TypeScript API server foundation',
              'Vite + React 18 + Vanilla CSS frontend',
            ].map((item) => (
              <li key={item} className="flex items-center gap-3 text-sm text-gray-300">
                <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* System Health Card */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">API Health</h2>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                apiStatus === 'ok'
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  : apiStatus === 'degraded'
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                  : apiStatus === 'loading'
                  ? 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
                  : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
              }`}
            >
              {apiStatus.toUpperCase()}
            </span>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between text-gray-300">
              <span className="text-gray-400">Database</span>
              <span className="font-mono text-xs text-emerald-400">{health?.services.database ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span className="text-gray-400">Redis Cache</span>
              <span className="font-mono text-xs text-emerald-400">{health?.services.redis ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span className="text-gray-400">Timestamp</span>
              <span className="font-mono text-xs text-gray-400">
                {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Product Vision Roadmap Section */}
      <div className="mt-12 w-full max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Product Vision Roadmap</h2>
            <p className="text-sm text-gray-400">Phases 1 through 14 fully implemented, verified, and complete.</p>
          </div>
          <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-3 py-1 text-xs font-medium text-blue-400">
            14 / 14 Phases Complete
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {ROADMAP_PHASES.map((p) => (
            <div
              key={p.num}
              className={`rounded-xl border p-5 transition-all ${
                p.status === 'COMPLETED'
                  ? 'border-emerald-500/20 bg-emerald-500/[0.02]'
                  : p.status === 'IN_PROGRESS'
                  ? 'border-blue-500/30 bg-blue-500/[0.03]'
                  : 'border-white/5 bg-white/[0.02]'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-gray-500">
                  {p.phase}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wider ${
                    p.status === 'COMPLETED'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : p.status === 'IN_PROGRESS'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-white/5 text-gray-500'
                  }`}
                >
                  {p.status}
                </span>
              </div>
              <h3 className="text-base font-semibold text-white">{p.label}</h3>
              <p className="mt-1 text-xs text-gray-400 leading-relaxed">{p.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
