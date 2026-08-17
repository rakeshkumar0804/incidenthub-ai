import { useHealth } from '../hooks/useHealth';

interface Capability {
  title: string;
  category: string;
  description: string;
  icon: string;
}

const CORE_CAPABILITIES: Capability[] = [
  {
    title: 'Incident Lifecycle Management',
    category: 'Core Operations',
    description: 'End-to-end incident management with SEV-1 to SEV-4 classification, state transitions, timeline auditing, and service ownership mapping.',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    title: 'GitHub & Sentry Correlation',
    category: 'Signal Processing',
    description: 'Real-time ingestion and correlation of commit history, pull requests, production deployments, and Sentry error spikes.',
    icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    title: 'AI Root-Cause Investigation',
    category: 'Intelligence',
    description: 'Automated hypothesis generation and evidence-backed root-cause analysis with explicit confidence tiering and uncertainty boundaries.',
    icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  },
  {
    title: 'Evidence-Grounded Postmortems',
    category: 'Knowledge Base',
    description: 'AI-assisted postmortem synthesis with version-controlled revisions, anti-hallucination citation checks, and Jira action item tracking.',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  {
    title: 'RBAC & Multi-Tenant Organizations',
    category: 'Security & Access',
    description: 'Strict tenant isolation, token-based invitation workflows, and granular role-based access control (Owner, Admin, Responder, Viewer).',
    icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  },
  {
    title: 'Real-Time Collaboration',
    category: 'Team Workspace',
    description: 'WebSocket-powered incident command rooms with live status broadcasts, threaded responder comments, presence detection, and Slack notifications.',
    icon: 'M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z',
  },
  {
    title: 'Analytics & Incident Replay',
    category: 'Observability',
    description: 'High-precision chronological incident reconstruction, MTTR/MTTD reliability metrics, and deployment risk correlation analytics.',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
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
        {/* Architecture & Infrastructure Card */}
        <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Platform Architecture</h2>
            <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
              PRODUCTION READY
            </span>
          </div>
          <ul className="space-y-2.5">
            {[
              'Enterprise multi-tenant PostgreSQL 15 schema',
              'Distributed Redis cache with fallback resilience',
              'High-throughput WebSocket event broadcast engine',
              'OpenAI GPT-4o root-cause investigation pipeline',
              'Strict role-based access control & tenant isolation',
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
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Service Connectivity</h2>
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
              <span className="text-gray-400">Database (PostgreSQL)</span>
              <span className="font-mono text-xs text-emerald-400">{health?.services.database ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span className="text-gray-400">Cache / Queue (Redis)</span>
              <span className="font-mono text-xs text-emerald-400">{health?.services.redis ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-gray-300">
              <span className="text-gray-400">Engine Telemetry</span>
              <span className="font-mono text-xs text-gray-400">
                {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Core Capabilities Section */}
      <div className="mt-12 w-full max-w-5xl">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white">Core Capabilities</h2>
          <p className="text-sm text-gray-400">Enterprise engineering incident intelligence and automated root-cause analysis.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {CORE_CAPABILITIES.map((cap) => (
            <div
              key={cap.title}
              className="rounded-2xl border border-white/5 bg-white/[0.03] p-5 shadow-lg transition-all hover:border-white/10 hover:bg-white/[0.04]"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={cap.icon} />
                  </svg>
                </div>
                <span className="rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                  {cap.category}
                </span>
              </div>
              <h3 className="text-base font-semibold text-white">{cap.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-400">{cap.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
