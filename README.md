# IncidentHub AI

> **Engineering Incident Intelligence Platform**

IncidentHub AI helps engineering teams answer three questions during and after a production incident:

1. **What changed?** — Recent deployments, PRs, commits
2. **Why did this happen?** — AI-generated root-cause analysis with evidence
3. **What exactly happened?** — Chronological incident replay

---

## Architecture

```
GitHub / Sentry / Team Activity
          ↓
    Incident Detection
          ↓
    Evidence Collection
          ↓
   Correlation Engine
          ↓
     AI Investigation
          ↓
        Resolution
          ↓
     Incident Replay
          ↓
      AI Postmortem
          ↓
       Action Items
```

**Tech stack:**
- **Frontend:** React + TypeScript + Vite + Tailwind CSS + TanStack Query
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL + Prisma ORM
- **Cache / Queue:** Redis + BullMQ
- **Real-time:** Socket.io
- **AI:** OpenAI GPT-4o (provider abstraction)

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Docker + Docker Compose

### 1. Clone and install

```bash
git clone <repo-url> incidenthub-ai
cd incidenthub-ai
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in required values
```

Minimum required for local development:
```env
NODE_ENV=development
PORT=4000
API_PORT=4000
API_URL=http://localhost:4000
VITE_API_URL=http://localhost:4000
CLIENT_URL=http://localhost:5173
DATABASE_URL=postgresql://incidenthub:change_me@localhost:5432/incidenthub_dev
REDIS_URL=redis://localhost:6379
```


---

## Phase Roadmap

| Phase | Title | Description | Status |
|---|---|---|---|
| **Phase 1** | Foundation | Architecture, database, API foundation, infrastructure | ✅ COMPLETED |
| **Phase 2** | Authentication + RBAC | JWT, refresh tokens, secure cookies, sessions, RBAC (OWNER, ADMIN, RESPONDER, VIEWER) | ✅ COMPLETED |
| **Phase 3** | Organizations + Teams + Projects | Multi-tenant hierarchy: Org → Teams / Projects → Services, tenant isolation & switching | ✅ COMPLETED |
| **Phase 4** | Incident Management | Incident lifecycle (SEV-1..4, INVESTIGATING..RESOLVED), filtering, search, timeline foundation | ✅ COMPLETED |
| **Phase 5** | Real-Time Collaboration | Socket.io incident rooms, live timeline updates, comments, replies, presence & assignment sync | ✅ COMPLETED |
| **Phase 6** | GitHub Integration | OAuth, webhooks, repo metadata, commits, PRs, deployments, workflow runs & incident linking | ✅ COMPLETED |
| **Phase 7** | Sentry Integration | Webhook handling, error events, stack traces, spike detection & incident triggers | ✅ COMPLETED |
| **Phase 8** | Correlation Engine | Signal correlation across GitHub, Sentry, timeline & historical data with evidence confidence scores | ✅ COMPLETED |
| **Phase 9** | AI Investigation Engine | Evidence-backed root cause analysis, risk assessments & explicit uncertainty reporting | ✅ COMPLETED |
| **Phase 10** | Incident Replay | Automated chronological incident timeline reconstruction from detection to recovery | ✅ COMPLETED |
| **Phase 11** | AI Postmortems | AI-generated postmortem versions with human review, editing & action item tracking | ✅ COMPLETED |
| **Phase 12** | Analytics + Engineering Intelligence | Incident trends, MTTR/MTTD, candidate deployment correlations & engineering signals | ✅ COMPLETED |
| **Phase 13** | Slack + Jira Integrations | Slack incident channels/notifications and Jira action item issue creation/syncing | ✅ COMPLETED |
| **Phase 14** | Production Hardening + Polish | Tiered rate limiting, security headers, request correlation tracing, health probes, Redis resilience & polish | ✅ COMPLETED |

---

## License

Private — IncidentHub AI
