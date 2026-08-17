# IncidentHub AI — System Architecture

## Overview

IncidentHub AI is an **Engineering Incident Intelligence Platform** built as a multi-tenant SaaS application. It correlates GitHub activity, Sentry errors, and team actions to produce evidence-backed root-cause analysis and AI-generated postmortems.

---

## System Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser Client (React + TypeScript + Vite)                        │
│  Tailwind CSS · TanStack Query · React Router · Axios             │
│  Socket.io-client (Phase 6) · Framer Motion (Phase 12)           │
└────────────────────────────┬──────────────────────────────────────┘
                             │ REST API (HTTP/HTTPS)
                             │ WebSocket (Phase 6 — Socket.io)
┌────────────────────────────▼──────────────────────────────────────┐
│  API Server (Express + TypeScript)                                 │
│  Zod validation · Pino logging · Helmet · JWT (Phase 3)          │
└──────┬──────────────────────┬─────────────────────────────────────┘
       │                      │
┌──────▼──────┐   ┌───────────▼──────────┐   ┌──────────────────────┐
│ PostgreSQL   │   │  Redis               │   │  OpenAI API (Phs 10) │
│ (Prisma ORM) │   │  BullMQ (Phase 6+)  │   │  Provider abstraction│
└─────────────┘   └──────────────────────┘   └──────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────────┐
│  External Integrations (future phases)                           │
│  GitHub OAuth · GitHub Webhooks · Sentry Webhooks · Slack       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
incidenthub-ai/                  # Monorepo root
├── apps/
│   ├── api/                     # Express + TypeScript backend
│   └── web/                     # React + Vite + TypeScript frontend
├── packages/
│   ├── shared/                  # Shared types and enums
│   └── config/                  # Shared constants
├── prisma/
│   ├── schema.prisma            # Single PostgreSQL schema
│   └── seed.ts                  # Development seed script
├── docs/                        # Architecture documentation
├── .github/workflows/           # CI pipeline
├── docker-compose.yml           # Local infrastructure
└── .env.example                 # Environment variable template
```

The repository uses **npm workspaces** for monorepo management. This provides:
- Shared `node_modules` hoisting (one install for all packages)
- Cross-package dependencies using `*` version references
- Unified scripts runnable from root

---

## Frontend / Backend Separation

### Philosophy

The backend owns all business logic. The frontend is a rendering layer.

**Never implement in the frontend:**
- Authorization checks
- Business rules
- Data validation that matters (validation in React is UX only)
- Sensitive credential handling

**Backend responsibilities:**
- All authorization (RBAC enforced via middleware)
- Data validation (Zod schemas on every API input)
- Business logic (in service layer, not controllers)
- Tenant isolation (every query scoped to organizationId)

### Communication

- REST API at `http://localhost:4000/api/v1`
- WebSocket at `ws://localhost:4000` (Phase 6)
- Frontend proxies `/api` to the backend in development (configured in `vite.config.ts`)
- In production, a reverse proxy (nginx/Caddy) handles this

---

## Multi-Tenancy Architecture

### Tenant Boundary

**Organization** is the primary tenant boundary. Every user belongs to an organization via `OrganizationMember`. Every piece of data (projects, incidents, integrations) belongs to an organization.

### Enforcement Strategy

**`organizationId` is denormalized onto `Incident`** — even though the organizational context is reachable through `Project`. This avoids an extra join on the most frequent query in the system.

Every API route that accesses incident data **must** filter by `organizationId`. Example:

```typescript
// Correct: tenant-isolated query
const incidents = await prisma.incident.findMany({
  where: {
    organizationId: req.user.organizationId, // From JWT
    projectId: req.params.projectId,
  },
});

// WRONG: missing tenant filter
const incidents = await prisma.incident.findMany({
  where: { projectId: req.params.projectId },
});
```

### Middleware Strategy (Phase 3+)

The authentication middleware (`requireAuth`) will:
1. Verify the JWT access token
2. Extract `userId` and `organizationId` from the token payload
3. Attach `req.user` with the verified context
4. All subsequent route handlers use `req.user.organizationId` — never trust the client

The authorization middleware (`requireRole`) will:
1. Check `req.user.role` against the required role for the route
2. Return 403 Forbidden if insufficient

---

## Database Architecture

See [database.md](./database.md) for full entity documentation.

Key decisions:
- **PostgreSQL** — relational data, strong consistency, ACID transactions
- **Prisma ORM** — type-safe queries, migration management
- **CUID identifiers** — URL-safe, collision-resistant, non-sequential (avoids enumeration attacks)
- **`@@map`** — all tables use `snake_case` names in PostgreSQL
- **Soft deletes** — not implemented in Phase 1; Cascade/SetNull used instead

---

## Real-Time Architecture (Phase 6)

Socket.io with authenticated WebSocket connections.

```
Client connects → JWT verified in Socket.io handshake middleware
                → Socket joins org room: org:{organizationId}
                → Socket joins incident room on open: incident:{incidentId}

Server emits events to rooms:
  incident:{id} → status_changed, severity_changed, timeline_event, comment_added
  org:{id}      → new_incident, incident_resolved
```

**No Socket.io functionality is implemented in Phase 1.** The architecture is designed so Socket.io can be layered on top of the existing Express server without refactoring.

---

## Background Jobs Architecture (Phase 6+)

BullMQ with Redis.

```
Webhook received (GitHub/Sentry)
  → Signature verified (HMAC)
  → Raw payload stored in ExternalEvent table
  → Job enqueued in BullMQ with externalId as jobId (idempotency)
  → Worker processes job:
      → Deduplication check
      → Parse and normalize payload
      → Run correlation engine
      → Emit Socket.io events
```

**No BullMQ workers are implemented in Phase 1.** The database schema (`ExternalEvent.processedAt`) and architecture are designed to support this pattern.

---

## AI Architecture (Phase 10)

The AI module is completely isolated from business logic.

```
modules/ai/
├── providers/         # AIProvider interface + OpenAIProvider
├── prompts/           # Prompt builder functions
├── schemas/           # Zod schemas validating AI JSON output
└── ai.service.ts      # Public interface consumed by other modules
```

### Key principles

1. **Evidence-based only**: AI receives structured evidence from the database. It never has direct database access.
2. **Validated output**: All AI responses are validated against Zod schemas. Unvalidated responses are rejected.
3. **No auto-mutation**: AI investigation results are saved as a draft. No AI response directly modifies incident status, severity, or any other field without explicit user action.
4. **Uncertainty is explicit**: If evidence is insufficient, the AI must return "Insufficient evidence" — not a fabricated hypothesis.
5. **Provider abstraction**: `AIProvider` interface means switching from OpenAI to Anthropic or Gemini requires only adding a new provider class.

---

## Integration Architecture (Phase 7+)

Each integration is isolated in `modules/integrations/` with a clean boundary:

```
modules/integrations/
├── github/
│   ├── github.webhook.ts      # Webhook receiver + HMAC verification
│   ├── github.service.ts      # GitHub API client
│   └── github.processor.ts    # BullMQ worker logic
├── sentry/
│   ├── sentry.webhook.ts
│   └── sentry.processor.ts
└── base/
    └── integration.interface.ts  # Common interface
```

This means adding Jira, Slack, or GitLab later follows the same pattern and requires no changes to core modules.

---

## Security Principles

1. **No secrets in source code** — All secrets via environment variables
2. **No secrets in frontend** — `VITE_*` env vars only for non-sensitive configuration
3. **Webhook HMAC verification** — Every inbound webhook verified before processing
4. **Integration credentials encrypted** — Stored as AES-256-GCM encrypted blobs, decrypted only in service layer
5. **No stack traces in production** — Error handler strips internals from production responses
6. **CORS configured** — Only `CLIENT_URL` is allowed, no wildcard origins
7. **HttpOnly cookies** — JWT refresh tokens stored in HttpOnly cookies (Phase 3)

---

## Development Workflow

```bash
# Start infrastructure (PostgreSQL + Redis)
npm run docker:up

# Install all dependencies
npm install

# Generate Prisma client
npm run db:generate

# Run database migration
npm run db:migrate

# Seed the database (optional, for validation)
npm run db:seed

# Start both apps in dev mode
npm run dev

# Run tests
npm run test

# Typecheck everything
npm run typecheck

# Lint everything
npm run lint
```

---

## Phase Roadmap

| Phase | Description | Status |
|---|---|---|
| 1 | Architecture, DB schema, API foundation | ✅ Complete |
| 2–3 | Authentication (JWT, RBAC, email verification) | Planned |
| 4 | Organizations, Teams, Projects, RBAC | Planned |
| 5 | Incident CRUD | Planned |
| 6 | Real-time collaboration (Socket.io) | Planned |
| 7 | GitHub integration | Planned |
| 8 | Sentry integration | Planned |
| 9 | Correlation engine | Planned |
| 10 | AI investigation engine | Planned |
| 11 | AI postmortem generation | Planned |
| 12 | Full frontend application | Planned |
| 13 | Dashboard and analytics | Planned |
| 14 | Polish, testing, documentation | Planned |
