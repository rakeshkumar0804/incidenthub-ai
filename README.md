# IncidentHub AI

<div align="center">

**Engineering Incident Intelligence & Automated Root-Cause Analysis Platform**

*Correlating GitHub deployments, Sentry error spikes, and team telemetry into deterministic, evidence-backed root-cause analysis and verifiable postmortems.*

[![CI](https://github.com/rakeshkumar0804/incidenthub-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/rakeshkumar0804/incidenthub-ai/actions)
[![Tests](https://img.shields.io/badge/tests-615%2F615%20passing-brightgreen)](https://github.com/rakeshkumar0804/incidenthub-ai)
[![TypeScript](https://img.shields.io/badge/typescript-v5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/frontend-React%2018%20%7C%20Vite%20%7C%20Tailwind-61dafb?logo=react)](https://react.dev/)
[![Node](https://img.shields.io/badge/backend-Node.js%20%7C%20Express-339933?logo=nodedotjs)](https://nodejs.org/)
[![Database](https://img.shields.io/badge/database-PostgreSQL%20%7C%20Prisma-336791?logo=postgresql)](https://www.prisma.io/)
[![Cache](https://img.shields.io/badge/cache-Redis%20%7C%20Distributed%20Locks-DC382D?logo=redis)](https://redis.io/)
[![Deployment](https://img.shields.io/badge/deployment-Vercel%20%2B%20Render-black)](https://incidenthub-ai-web.vercel.app)

[Live Demo](https://incidenthub-ai-web.vercel.app) • [Architecture](#system-architecture) • [Key Features](#key-features) • [Testing & Quality](#testing--code-quality) • [Local Setup](#getting-started-locally)

</div>

---

## Overview

### The Problem
During production outages, on-call engineers face an overwhelming influx of disparate data: deployment pipelines, git commit histories, error monitoring streams, service dependencies, and chat threads. Manually cross-referencing this telemetry under high pressure is slow, error-prone, and leads to delayed mitigation (MTTR) and low-fidelity postmortems.

### The Solution
**IncidentHub AI** bridges telemetry and incident response through a two-stage intelligence pipeline:
1. **Deterministic Correlation Engine**: Automatically ingests and indexes time-series signals from GitHub (commits, PRs, deployments, workflow runs) and Sentry (error spikes, user impact, fatal traces). It evaluates temporal proximity, service topology, and deployment deltas to score and rank correlated evidence with zero hallucinations.
2. **Evidence-Grounded AI Investigation**: Feeds structured correlation evidence into an AI reasoning layer (OpenAI GPT-4o with deterministic fallback heuristics) to generate hypotheses, identify contributing factors, validate against contradictory data, and synthesize immutable, citation-backed postmortems.

> **Design Principle: Correlation Over Causation**
> IncidentHub AI employs strict correlation language (*"preceding," "temporally correlated," "associated"*) rather than asserting unverified causation, preserving engineering judgment while drastically reducing triage time.

---

## Live Demo & Interactive Walkthrough

🔗 **Web Application**: [https://incidenthub-ai-web.vercel.app](https://incidenthub-ai-web.vercel.app)
⚡ **Production Backend API**: [https://incidenthub-ai.onrender.com](https://incidenthub-ai.onrender.com)

### Exploring the Pre-Seeded Workspace
When you log in or create an account, you can access the pre-configured showcase organization from the top-left workspace switcher:

> **Organization**: `Acme Engineering`
> Pre-populated with production scenarios, live analytics, team hierarchies, and linked GitHub/Sentry telemetry.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          DEMO FLOW HIGHLIGHTS                          │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Workspace Switcher ──▶ Switch to "Acme Engineering"                 │
│ 2. Incident Triage    ──▶ Open INC-0101 (Payment Gateway 500 Spike)    │
│ 3. Signal Correlation ──▶ Inspect correlated Sentry spikes & PR diffs  │
│ 4. AI Investigation   ──▶ Review hypothesis, confidence & contradictions│
│ 5. Postmortem Hub     ──▶ View versioned postmortems & action items    │
│ 6. Reliability Metrics──▶ Explore MTTR, MTTD, and service health graphs│
│ 7. RBAC in Action     ──▶ View Owner, Admin, Responder & Viewer roles  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### 1. Incident Lifecycle & Collaboration War Rooms
- **Severity-Tiered Management**: SEV-1 (Critical Outage) to SEV-4 (Minor Degraded) classification.
- **State Machine Workflow**: Enforces valid state transitions (`OPEN` $\rightarrow$ `INVESTIGATING` $\rightarrow$ `MITIGATING` $\rightarrow$ `RESOLVED`).
- **Real-Time War Rooms**: Socket.io live incident room broadcasts, real-time activity timelines, threaded incident comments, and participant presence.
- **Service & Team Ownership**: Maps incidents to distinct teams (`SRE & Platform`, `Core Backend & Payments`) and service tiers (`payment-gateway`, `auth-service`, `checkout-api`).

### 2. Deterministic Signal Correlation Engine
- **Multi-Source Ingestion**: Ingests GitHub webhooks (commits, PRs, deployments, GitHub Actions) and Sentry webhook alerts.
- **Scoring & Ranking**: Multi-factor scoring model based on:
  - **Temporal Proximity** (e.g., deployment executed within 15 minutes of error spike).
  - **Service Topology** (direct service match vs. project-level association).
  - **Change Impact** (lines changed, merged author, Sentry affected-user count).
- **Audit-Ready Evidence**: Every correlation item links directly to git commits, deployment runs, or Sentry issue IDs.

### 3. Evidence-Grounded AI Investigation
- **Root-Cause Hypothesis**: Generates structured hypotheses with explicit confidence scoring (`HIGH`, `MEDIUM`, `LOW`).
- **Uncertainty & Contradictions**: Surfacing counter-evidence or disproven hypotheses to avoid confirmation bias.
- **Safety & Privacy**: Full client-side and server-side secret/token redaction before sending payloads to LLM providers.
- **Offline / Resilient Fallback**: Graceful fallback to deterministic rule-based analysis if AI provider rate limits or network issues occur.

### 4. Versioned Postmortems & Action Item Tracking
- **Automated Postmortem Synthesis**: Generates comprehensive incident postmortems complete with summary, timeline, root cause, impact assessment, and prevention steps.
- **Immutable Versioning**: Publishing a postmortem creates an immutable version snapshot; subsequent edits create branched draft revisions.
- **Action Items & Integrations**: Extracts preventative tasks, validates assignees against organization members, and syncs bidirectionally with Jira and Slack.

### 5. Multi-Tenant Architecture & Strict RBAC
- **Tenant Isolation**: Every database query is strictly scoped by `organizationId`. Cross-tenant resource queries fail closed with `403 Forbidden`.
- **Role-Based Access Control**:
  - `OWNER`: Full organization administration, billing, team creation, and deletion.
  - `ADMIN`: Service management, team configuration, integrations setup.
  - `RESPONDER`: Incident creation, status progression, triage, commenting, postmortem editing.
  - `VIEWER`: Read-only access to dashboards, timelines, and postmortems (mutations blocked at API level).

### 6. Engineering Reliability Analytics
- **Live MTTR & MTTD**: Real-time calculation of Mean Time to Detect and Mean Time to Resolve across rolling windows (7d, 30d, 90d).
- **Service Reliability Breakdown**: Visual incident distribution by severity, failure frequency, and impacted services.
- **Replay & Timeline Reconstruction**: Deterministic multi-key chronological incident replay.

---

## System Architecture

```
                                  ┌─────────────────────────────┐
                                  │      Client (Browser)       │
                                  │  React 18 + Vite + Tailwind │
                                  └──────────────┬──────────────┘
                                                 │ HTTPS / WSS
                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                Express + TypeScript API Server                              │
│                                                                                             │
│  ┌──────────────────────┐   ┌──────────────────────┐   ┌────────────────────────────────┐  │
│  │   Auth & RBAC Layer  │   │  Incident Controller │   │   Webhook Receivers (HMAC)     │  │
│  │  JWT + Refresh Cookie│   │  State Machine & Room│   │  GitHub App  │  Sentry Alerts  │  │
│  └──────────┬───────────┘   └──────────┬───────────┘   └──────────────┬─────────────────┘  │
│             │                          │                              │                     │
│             ▼                          ▼                              ▼                     │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                            Deterministic Correlation Engine                           │  │
│  │                Temporal Windowing • Service Matching • Confidence Scoring             │  │
│  └─────────────────────────────────────────┬─────────────────────────────────────────────┘  │
│                                            │                                                │
│                                            ▼                                                │
│  ┌───────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                          Evidence-Grounded AI Engine (OpenAI)                         │  │
│  │            Secret Redactor • Hypothesis Generator • Postmortem Synthesizer            │  │
│  └─────────────────────────────────────────┬─────────────────────────────────────────────┘  │
└────────────────────────────────────────────┼────────────────────────────────────────────────┘
                                             │
                     ┌───────────────────────┴───────────────────────┐
                     ▼                                               ▼
      ┌─────────────────────────────┐                 ┌─────────────────────────────┐
      │     PostgreSQL Database     │                 │      Redis Cache & Lock     │
      │   Neon Serverless / Prisma  │                 │  Distributed Concurrency    │
      │   Multi-Tenant Schemas      │                 │  Pub/Sub Realtime Sync      │
      └─────────────────────────────┘                 └─────────────────────────────┘
```

---

## Repository Structure

```
incidenthub-ai/
├── apps/
│   ├── api/                     # Express + TypeScript Backend API
│   │   ├── src/
│   │   │   ├── config/          # Environment configuration & validation
│   │   │   ├── middleware/      # Auth, RBAC, tenant isolation, tracing, error handling
│   │   │   ├── modules/         # Domain modules (auth, incidents, correlation, AI, etc.)
│   │   │   ├── routes/          # API v1 route definitions
│   │   │   ├── scripts/         # Production demo restore & maintenance operators
│   │   │   └── server.ts        # Express app & Socket.io server entry point
│   │   └── tests/               # 28 Vitest integration & security test suites (615 tests)
│   │
│   └── web/                     # React 18 + Vite Frontend Application
│       ├── src/
│       │   ├── components/      # UI component library (Tailwind CSS, Lucide icons)
│       │   ├── features/        # Feature slices (auth, incidents, analytics, settings)
│       │   ├── lib/             # Axios client, Socket.io client, queryClient
│       │   └── routes/          # React Router v6 guarded route definitions
│
├── packages/
│   ├── shared/                  # Shared DTOs, Enums, Zod schemas, and TypeScript types
│   └── config/                  # Shared ESLint, Prettier, and TypeScript configurations
│
├── prisma/
│   ├── schema.prisma            # Prisma schema with multi-tenant relations
│   └── seed-demo.ts             # Local development seed script
│
├── .github/workflows/ci.yml     # GitHub Actions CI pipeline (Typecheck, Lint, Tests, Build)
└── docker-compose.yml           # Local PostgreSQL & Redis container stack
```

---

## Production Hardening & Reliability

- **Resilient Auth Bootstrap**: Client-side authentication initialization utilizes single-flight deduplication via `inFlightPromiseRef`, bounded 15-second timeouts with `AbortController`, and retryable fallback UI states.
- **Fail-Closed Distributed Locking**: Redis-backed concurrency locks (`acquireDistributedLock`) prevent race conditions and duplicate AI investigation runs during concurrent triage.
- **HMAC Webhook Verification**: GitHub and Sentry webhooks are signature-verified (SHA-256 HMAC) with timestamp drift protection and idempotent replay deduplication.
- **Security Headers & Tracing**: Hardened with Helmet middleware, CORS domain restriction, and distributed `X-Request-ID` request tracing across all API logs.
- **Graceful Cache Degradation**: Safe Redis wrapper utilities ensure that transient cache connection interruptions never crash or block core database operations.

---

## Testing & Code Quality

The codebase is backed by a test suite validating domain logic, security boundaries, and concurrency handling.

```bash
# Run all unit, integration, and security test suites
npm run test

# Run strict TypeScript type verification across all workspaces
npm run typecheck

# Run ESLint across frontend, backend, and shared packages
npm run lint

# Build production bundles
npm run build
```

### Verified Test Matrix (615 Tests Across 28 Suites)

| Test Suite Category | Key Coverage Areas | Status |
|---|---|:---:|
| **RBAC & Tenant Isolation** | Cross-tenant rejection, role hierarchy (Owner/Admin/Responder/Viewer), invite escalation guards | `PASS` |
| **Incident Management** | State machine validation, severity transitions, nested resource integrity, race condition handling | `PASS` |
| **Correlation Engine** | Temporal scoring, service topology hierarchy, Sentry spike thresholds, non-causal evidence ranking | `PASS` |
| **AI Investigation & Safety** | Secret redaction, prompt bounds, schema validation, lock safety, deterministic offline fallback | `PASS` |
| **Postmortem Integrity** | Immutable version snapshots, draft branching, citation validation, action item member verification | `PASS` |
| **Webhook Integrations** | GitHub App & Sentry HMAC validation, replay protection, Slack & Jira sync loops prevention | `PASS` |
| **Auth Resilience** | Single-flight bootstrap deduplication, session rotation, token reuse detection, timeout recovery | `PASS` |

---

## Getting Started Locally

### Prerequisites
- **Node.js**: `v20.x` or `v22.x`
- **Docker & Docker Compose**: For local PostgreSQL and Redis instances
- **npm**: `v10.x` or higher

### 1. Clone & Install
```bash
git clone https://github.com/rakeshkumar0804/incidenthub-ai.git
cd incidenthub-ai
npm install
```

### 2. Start Infrastructure
Start the local PostgreSQL and Redis containers:
```bash
npm run docker:up
```

### 3. Configure Environment Variables
Copy the example environment configuration:
```bash
cp .env.example .env
```

*The default `.env.example` comes pre-configured with working local credentials for database, Redis, and JWT.*

### 4. Initialize Database
Generate Prisma client artifacts, run migrations, and seed initial development data:
```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

### 5. Start Development Servers
Start both the API server and Vite frontend concurrently:
```bash
npm run dev
```

- **Frontend App**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:4000](http://localhost:4000)
- **API Health Check**: [http://localhost:4000/health/readiness](http://localhost:4000/health/readiness)

---

## Environment Variables Reference

| Variable | Description | Default / Example |
|---|---|---|
| `NODE_ENV` | Application environment mode | `development` / `production` |
| `PORT` | API server listen port | `4000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/incidenthub_dev` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | Secret key for signing access tokens | *32+ char random string* |
| `JWT_REFRESH_SECRET` | Secret key for signing refresh tokens | *32+ char random string* |
| `CLIENT_URL` | Allowed client origin for CORS | `http://localhost:5173` |
| `API_URL` | Canonical API URL | `http://localhost:4000` |
| `VITE_API_URL` | API endpoint used by React frontend | `http://localhost:4000/api/v1` |
| `OPENAI_API_KEY` | *(Optional)* OpenAI API Key for GPT-4o root-cause investigation | `sk-...` |
| `GITHUB_WEBHOOK_SECRET` | *(Optional)* Secret for verifying GitHub webhook HMAC | `gh_webhook_secret_...` |
| `SENTRY_WEBHOOK_SECRET` | *(Optional)* Secret for verifying Sentry webhook HMAC | `sentry_webhook_secret_...` |

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons, TanStack Query, React Router v6
- **Backend**: Node.js, Express, TypeScript, Socket.io, Zod, Pino Logger, Helmet
- **Database & Cache**: PostgreSQL, Prisma ORM, Redis (ioredis, distributed locking)
- **AI & Reasoning**: OpenAI GPT-4o API (provider-abstracted), deterministic rule-based fallback engine
- **Testing & Tooling**: Vitest, Supertest, ESLint, Prettier, Docker Compose, GitHub Actions CI
- **Cloud Deployments**: Vercel (Frontend SPA), Render (API & WebSockets), Neon (Serverless PostgreSQL)

---

## Author

**Rakesh Kumar**
- GitHub: [@rakeshkumar0804](https://github.com/rakeshkumar0804)
- Repository: [incidenthub-ai](https://github.com/rakeshkumar0804/incidenthub-ai)

---

<div align="center">
  <sub>Built as a production-grade full-stack engineering portfolio demonstrating resilient architecture, deterministic correlation, strict RBAC, and evidence-grounded AI systems.</sub>
</div>
