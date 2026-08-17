# IncidentHub AI

**Engineering Incident Intelligence Platform** — correlates GitHub activity, Sentry errors, and team actions to deliver evidence-backed root-cause analysis and AI-generated postmortems.

![CI](https://github.com/rakeshkumar0804/incidenthub-ai/actions/workflows/ci.yml/badge.svg)
![Stack](https://img.shields.io/badge/stack-React%20%7C%20Node%20%7C%20PostgreSQL%20%7C%20Redis-blue)
![Tests](https://img.shields.io/badge/tests-236%2F236%20passing-brightgreen)

---

## Problem

When a production incident happens, engineers manually stitch together evidence from multiple disconnected sources — deployment logs, recent commits, Sentry error spikes, service ownership, and incident timelines — to figure out what actually broke and why. This manual correlation is slow, error-prone, and rarely produces a documented, evidence-backed record afterward.

## Solution

IncidentHub AI combines a **deterministic correlation engine** with an **AI investigation layer** to speed up root-cause analysis without replacing engineering judgment:

1. Ingests signals from GitHub (commits, PRs, deployments, Actions runs) and Sentry (error spikes, affected users, event counts).
2. Deterministically correlates these signals against incident timing, service ownership, and deployment relationships — producing ranked, confidence-scored evidence.
3. Feeds that evidence to an AI investigation engine that generates a grounded root-cause hypothesis, explicitly separating supporting evidence from contradictory factors.
4. Produces versioned, citation-backed postmortems with extractable action items.

The system uses **correlation language, not causal language** — evidence is described as "preceding," "correlated," or "associated," never asserted as proven causation unless directly demonstrable.

## Key Features

- **Incident Lifecycle Management** — SEV-1 to SEV-4 classification, state transitions (Open → Investigating → Mitigating → Resolved), timeline auditing, service ownership mapping.
- **GitHub & Sentry Correlation** — real-time ingestion and correlation of commit history, pull requests, deployments, and error spikes.
- **AI Root-Cause Investigation** — evidence-grounded hypothesis generation with explicit confidence tiering and uncertainty boundaries. Secrets/tokens are redacted before any AI processing.
- **Evidence-Grounded Postmortems** — AI-assisted synthesis with version-controlled drafts, citation tracking, anti-hallucination validation, and immutable published versions.
- **RBAC & Multi-Tenant Organizations** — strict tenant isolation with Owner / Admin / Responder / Viewer roles enforced across every mutation path.
- **Real-Time Collaboration** — WebSocket-powered incident rooms with live status broadcasts, threaded comments, and presence detection.
- **Analytics & Incident Replay** — deterministic MTTR/MTTD calculation, service reliability rankings, deployment-failure correlation, and chronological incident reconstruction.

## Architecture

```
User
 │
 ▼
React 18 + Vite + TypeScript (apps/web)
 │
 ▼
Express + TypeScript API (apps/api)
 │
 ├──▶ PostgreSQL (Prisma ORM) — incidents, orgs, RBAC, evidence
 ├──▶ Redis — caching, distributed locks, concurrency control
 │
 ├──▶ GitHub App — commits, PRs, deployments, Actions
 ├──▶ Sentry OAuth — error signals, issue ingestion
 ├──▶ Slack — incident channels, interactive actions
 ├──▶ Jira — action item sync
 │
 ▼
Deterministic Correlation Engine
 │
 ▼
AI Investigation Engine (OpenAI, evidence-grounded)
 │
 ▼
Postmortem Engine (versioned, citation-backed)
```

Monorepo layout (npm workspaces):

```
apps/
  api/       — Express backend
  web/       — React frontend
packages/
  shared/    — shared types/utilities
  config/    — shared config
prisma/      — schema & migrations
docs/
.github/workflows/
docker-compose.yml
```

## Core Engineering

- **Multi-tenancy** — every query path is scoped to organization; cross-tenant access is rejected at the API layer, not just hidden in the UI.
- **RBAC enforcement** — verified with tests confirming Viewer roles cannot trigger mutations (e.g., repository sync, incident resolution) and cross-org access returns explicit rejections.
- **Correlation engine** — combines temporal proximity, project/service matching, deployment relationships, and commit inclusion into ranked, confidence-scored evidence.
- **Redis-backed concurrency control** — distributed locks prevent duplicate AI investigation runs and race conditions during concurrent incident updates.
- **Idempotent webhook processing** — GitHub and Sentry webhooks are signature-verified (HMAC) and safe to replay without creating duplicate records.
- **Incident replay engine** — deterministic multi-key chronological ordering across state changes, evidence, comments, and investigation runs.
- **Postmortem versioning** — editing a published postmortem creates a new draft version rather than mutating the published record; action-item deduplication prevents Jira sync loops.
- **Production hardening** — Helmet security headers, request-ID tracing, health/readiness endpoints, and graceful Redis degradation.

## AI Investigation — What It Does and Doesn't Do

**Does:**
- Synthesizes correlation evidence into a structured root-cause hypothesis with confidence scoring.
- Explicitly surfaces contradictory or disproven factors alongside supporting evidence.
- Cites the specific evidence (commit, deployment, error spike) behind each claim in generated postmortems.
- Redacts secrets/tokens from any data sent to the AI provider.

**Does not:**
- Autonomously resolve or mitigate incidents.
- Claim proven causation — it works with correlated, non-causal evidence unless causality is explicitly established.
- Replace engineering judgment; every AI output is meant to accelerate investigation, not substitute for it.

## Integrations

| Integration | Capabilities |
|---|---|
| **GitHub** | App-based install, PAT fallback for local dev, commit/PR/deployment/Actions sync, idempotent webhooks |
| **Sentry** | OAuth 2.0, error/issue ingestion, spike detection, trigger rules, optional auto-incident creation |
| **Slack** | OAuth, incident channel creation, interactive acknowledgment actions |
| **Jira** | OAuth + API token fallback, bi-directional action item sync with loop prevention |

## Testing

Validated locally at the current baseline:

```
npm run typecheck   → PASS
npm run lint         → PASS (0 warnings, --max-warnings 0)
npm run test          → PASS (17/17 suites, 236/236 tests)
npm run build         → PASS
```

Test coverage includes RBAC boundary tests, cross-tenant isolation checks, webhook idempotency, correlation-engine determinism, and Redis lock/concurrency behavior.

## Local Development

```bash
# install dependencies
npm install

# start PostgreSQL + Redis via Docker
npm run docker:up

# generate Prisma client and run migrations
npm run db:generate
npm run db:migrate

# start API + web in dev mode
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env` and configure. Core variables:

```
NODE_ENV, PORT, API_URL, CLIENT_URL
DATABASE_URL, REDIS_URL
JWT_SECRET, JWT_REFRESH_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN
VITE_API_URL
```

Optional (only required if enabling that integration):

```
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_WEBHOOK_SECRET
SENTRY_CLIENT_ID / SENTRY_CLIENT_SECRET / SENTRY_WEBHOOK_SECRET / SENTRY_AUTH_TOKEN
OPENAI_API_KEY, AI_PROVIDER, AI_MODEL
SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET
JIRA_CLIENT_ID / JIRA_CLIENT_SECRET
RESEND_API_KEY, EMAIL_FROM
```

No real secrets are committed to this repository. `.env`, `.env.*`, and local database contents are gitignored — only `.env.example` with placeholder values is tracked.

## Live Demo

🔗 **[incidenthub-ai-web.vercel.app](https://incidenthub-ai-web.vercel.app)**

The default workspace is empty by design (a real, unseeded tenant). To see the platform populated with sample data, switch workspaces from the org selector (top-left dropdown) to:

> **"Acme Engineering"**

This demo organization includes seeded incidents across severities and statuses, sample team members with different RBAC roles, and correlated GitHub/Sentry evidence so you can explore the full incident lifecycle, analytics, and AI investigation flow without setting anything up.

### Demo Flow

1. Switch to the **Acme Engineering** workspace.
2. Open **Incidents** → select an incident (e.g. a Payment API 500-error incident) to view its timeline.
3. Check the **correlation evidence** panel — Sentry spike, preceding deployment, and the specific commit involved.
4. Open the **AI Investigation** tab to see the evidence-grounded root-cause hypothesis and confidence tiering.
5. View the generated **postmortem** with citations and extracted action items.
6. Check **Analytics** for MTTR/MTTD and service reliability rankings computed from the seeded incidents.
7. Visit **Teams/Members** to see RBAC roles (Owner, Admin, Responder, Viewer) in action.

## Limitations

- **Deployment status**: The frontend is deployed on Vercel. The backend (API, WebSocket, Redis-dependent services) requires a host suited for long-running processes and WebSocket connections — Vercel's serverless model is not ideal for this, and backend hosting is being finalized separately from static frontend deployment.
- Integrations (GitHub App, Sentry OAuth, Slack, Jira) are fully implemented and tested but require the respective OAuth apps to be registered per-deployment; they are not pre-connected out of the box.
- AI investigation quality depends on the configured AI provider and the completeness of correlated evidence — it is an assistive tool, not an autonomous fix engine.

## Future Improvements

- Dedicated backend hosting (Railway/Render/Fly.io) to properly support WebSockets and Redis-backed locking in production.
- Expanded correlation signal types (e.g., infrastructure/config change tracking).
- Public API documentation (OpenAPI spec).

## Tech Stack

**Frontend:** React 18, Vite, TypeScript
**Backend:** Node.js, Express, TypeScript
**Database:** PostgreSQL, Prisma ORM
**Cache/Coordination:** Redis (ioredis)
**Real-time:** WebSocket / Socket.io
**AI:** OpenAI (provider-abstracted)
**Testing:** Vitest, integration & RBAC/security test suites
**Infra:** Docker Compose, npm workspaces, GitHub Actions CI

---

Built by [Rakesh Kumar](https://github.com/rakeshkumar0804) as a full-stack portfolio project demonstrating multi-tenant SaaS architecture, RBAC, real-time systems, and evidence-grounded AI integration.
