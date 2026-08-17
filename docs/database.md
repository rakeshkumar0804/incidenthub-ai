# IncidentHub AI — Database Documentation

## Overview

The database is **PostgreSQL 15** managed by **Prisma ORM**. The schema is defined in `prisma/schema.prisma` at the monorepo root.

The schema is designed around two goals:
1. **Complete multi-tenant isolation** — Organization data cannot bleed across tenant boundaries
2. **Future-proof structure** — The Phase 1 schema supports the full product vision without forcing a rewrite

---

## Naming Conventions

| Convention | Example |
|---|---|
| Table names | `snake_case` via `@@map` |
| Column names | `camelCase` in Prisma, `snake_case` in PostgreSQL |
| ID type | CUID string (`@default(cuid())`) |
| Timestamps | `createdAt`, `updatedAt` on all mutable entities |
| Join tables | Named `entity_a_entity_b` (e.g., `organization_members`) |

---

## Entity Reference

### User

**Purpose:** A human user of the platform. Not tied to any specific organization at the model level — membership is expressed through `OrganizationMember`.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `email` | String | Unique — used for login |
| `emailVerified` | Boolean | Email verification state (Phase 3) |
| `name` | String | Display name |
| `avatarUrl` | String? | Optional profile image URL |
| `passwordHash` | String? | Null for OAuth-only users. bcrypt hash (Phase 3) |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | Auto-updated |

**Indexes:** `email` (unique)

**Relationships:**
- Has many `OrganizationMember` (a user can be in multiple organizations)
- Has many `TeamMember`
- Has many `Incident` via `IncidentAssignee` relation
- Has many `IncidentEvent` (events they created)
- Has many `Comment`

---

### Organization

**Purpose:** The primary tenant boundary. All data belongs to an organization. No cross-org data access is possible at the database level through correct use of `organizationId` filtering.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `name` | String | Display name |
| `slug` | String | Unique — used in URLs |
| `logoUrl` | String? | Optional logo URL |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | Auto-updated |

**Unique constraints:** `slug`
**Indexes:** `slug`

**Relationships:**
- Has many `OrganizationMember`
- Has many `Team`
- Has many `Project`
- Has many `Integration`
- Has many `ExternalEvent`

---

### OrganizationMember

**Purpose:** Join table expressing User ↔ Organization membership with a role. A user can hold **different roles in different organizations simultaneously**.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `organizationId` | String | FK → Organization (Cascade delete) |
| `userId` | String | FK → User (Cascade delete) |
| `role` | OrgRole enum | OWNER, ADMIN, RESPONDER, VIEWER |
| `joinedAt` | DateTime | When membership was created |

**Unique constraints:** `(organizationId, userId)` — one membership per user per org
**Indexes:** `userId`, `organizationId`

> **Design note:** The role is on the membership, NOT on the User model. This is essential for multi-organization support.

---

### Team

**Purpose:** A functional group within an organization. Examples: SRE, Backend, DevOps, QA.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `organizationId` | String | FK → Organization (Cascade delete) |
| `name` | String | Team name |
| `description` | String? | Optional description |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Unique constraints:** `(organizationId, name)` — team names unique within an org
**Indexes:** `organizationId`

---

### TeamMember

**Purpose:** Join table for User ↔ Team membership. A user can be in multiple teams.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `teamId` | String | FK → Team (Cascade delete) |
| `userId` | String | FK → User (Cascade delete) |
| `joinedAt` | DateTime | |

**Unique constraints:** `(teamId, userId)`
**Indexes:** `userId`, `teamId`

---

### Project

**Purpose:** A product or system being monitored. Examples: "Payment API", "Website", "Mobile App".

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `organizationId` | String | FK → Organization (Cascade delete) |
| `name` | String | Display name |
| `slug` | String | URL-safe identifier |
| `description` | String? | |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Unique constraints:** `(organizationId, slug)` — slugs unique per org
**Indexes:** `organizationId`

---

### Service

**Purpose:** A deployable unit within a project. Examples: "payment-service", "auth-api", "frontend-cdn". Incidents and external events will eventually be associated with specific services.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `projectId` | String | FK → Project (Cascade delete) |
| `name` | String | Display name |
| `slug` | String | URL-safe identifier |
| `description` | String? | |
| `repositoryUrl` | String? | GitHub repo URL (Phase 7) |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Unique constraints:** `(projectId, slug)` — slugs unique per project
**Indexes:** `projectId`

---

### Incident

**Purpose:** The central entity of the platform. Represents a production incident from creation to resolution.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `organizationId` | String | **Denormalized** — for fast tenant filtering |
| `projectId` | String | FK → Project (Cascade delete) |
| `serviceId` | String? | FK → Service (SetNull on delete) |
| `assigneeId` | String? | FK → User (SetNull on delete) |
| `title` | String | Short description |
| `description` | String? | Markdown-formatted detail |
| `severity` | IncidentSeverity | SEV_1, SEV_2, SEV_3, SEV_4 |
| `status` | IncidentStatus | INVESTIGATING, IDENTIFIED, MONITORING, RESOLVED |
| `startedAt` | DateTime? | When the incident actually began |
| `resolvedAt` | DateTime? | When the incident was resolved |
| `createdAt` | DateTime | When the record was created |
| `updatedAt` | DateTime | |

**Indexes:**
- `organizationId` — tenant boundary filtering
- `projectId` — project-scoped queries
- `status` — status filtering
- `severity` — severity filtering
- `(organizationId, status)` — dashboard filtered list
- `(organizationId, createdAt DESC)` — dashboard recent list

> **Design note on `organizationId` denormalization:**
> `organizationId` is reachable via `Incident → Project → Organization`, but that requires a join. Since "list all incidents for this organization" is the most frequent query in the system, we denormalize `organizationId` onto `Incident` to make it O(1). The application layer must keep this consistent when creating incidents.

---

### IncidentEvent

**Purpose:** A discrete event that occurred during an incident. This is the **unified timeline system**.

Events from GitHub, Sentry, Slack, human actions, and the AI engine all produce `IncidentEvent` records. This ensures a coherent chronological timeline regardless of event source.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `incidentId` | String | FK → Incident (Cascade delete) |
| `userId` | String? | FK → User (SetNull); null for system events |
| `source` | EventSource | USER, GITHUB, SENTRY, SLACK, SYSTEM, AI |
| `type` | String | Semantic event type (e.g., `status_changed`, `deployment_detected`) |
| `message` | String | Human-readable description |
| `metadata` | Json? | Flexible extra data (previous/new values, IDs, etc.) |
| `occurredAt` | DateTime | When the event happened |

**Indexes:**
- `incidentId` — incident-scoped queries
- `(incidentId, occurredAt ASC)` — timeline reconstruction

> **Design note:** Do NOT create separate timeline tables for GitHub events, Sentry events, etc. All events flow into `IncidentEvent` through normalization in the integration processors (Phase 7/8). This is critical for coherent incident replay and postmortem generation.

---

### Comment

**Purpose:** A comment on an incident. Supports threaded replies via `parentId`.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `incidentId` | String | FK → Incident (Cascade delete) |
| `userId` | String | FK → User (Cascade delete) |
| `parentId` | String? | FK → Comment self-reference (SetNull) |
| `content` | String | Markdown content |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Indexes:** `incidentId`, `parentId`

---

### Integration

**Purpose:** An organization's connection to an external service. Sensitive credentials are encrypted at the application layer — this record is never returned raw to the frontend.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `organizationId` | String | FK → Organization (Cascade delete) |
| `provider` | IntegrationProvider | GITHUB, SENTRY, SLACK, JIRA |
| `status` | IntegrationStatus | CONNECTED, DISCONNECTED, ERROR |
| `encryptedConfig` | String? | AES-256-GCM encrypted JSON blob |
| `metadata` | Json? | Non-sensitive display data |
| `lastSyncAt` | DateTime? | Last successful sync |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Unique constraints:** `(organizationId, provider)` — one integration per provider per org
**Indexes:** `organizationId`

> **Security:** `encryptedConfig` must only be decrypted inside `integrations.service.ts`. Route handlers and controllers must never access or return it.

---

### ExternalEvent

**Purpose:** A raw event received from an external provider (GitHub webhook, Sentry webhook, etc.). Raw payloads are stored intact for reprocessing. The `@@unique([provider, externalId])` constraint enforces idempotency.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `organizationId` | String | FK → Organization (Cascade delete) |
| `integrationId` | String? | FK → Integration (SetNull) |
| `provider` | String | "github", "sentry", "slack", "jira" |
| `externalId` | String | Provider's unique event ID |
| `eventType` | String | "push", "pull_request", "error", etc. |
| `payload` | Json | Complete raw webhook payload |
| `occurredAt` | DateTime | Event time from provider |
| `receivedAt` | DateTime | When IncidentHub received it |
| `processedAt` | DateTime? | Set by BullMQ worker on completion; null = pending |

**Unique constraints:** `(provider, externalId)` — idempotency
**Indexes:** `organizationId`, `(provider, eventType)`, `occurredAt DESC`, `processedAt`

> **Idempotency:** A duplicate webhook delivery for the same event will violate the unique constraint and be discarded before entering the queue. The BullMQ worker also uses `externalId` as the job ID for a second layer of deduplication.

---

### IncidentEvidence

**Purpose:** Represents a piece of information supporting an incident investigation. The correlation engine (Phase 9) automatically populates this; team members can also link evidence manually.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `incidentId` | String | FK → Incident (Cascade delete) |
| `externalEventId` | String? | FK → ExternalEvent (SetNull) |
| `type` | EvidenceType | GITHUB_COMMIT, GITHUB_PR, SENTRY_ERROR, etc. |
| `source` | EvidenceSource | CORRELATION_ENGINE, AI_SUGGESTED, MANUAL |
| `title` | String | Brief description |
| `description` | String? | Detailed explanation |
| `url` | String? | Deep link to external resource |
| `confidence` | Float? | 0.0–1.0 correlation signal strength |
| `metadata` | Json? | Structured context (PR number, SHA, error count) |
| `addedAt` | DateTime | |

**Indexes:** `incidentId`, `(incidentId, type)`, `type`

> **Important:** `confidence` is a system-generated signal. It must **never** be displayed as absolute truth. It represents the correlation engine's estimate, not a guarantee of causality.

---

### Postmortem

**Purpose:** An incident postmortem document. One per resolved incident. AI generates an initial draft; humans review and approve.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `incidentId` | String | Unique FK → Incident (Cascade) |
| `status` | PostmortemStatus | DRAFT, IN_REVIEW, APPROVED, PUBLISHED |
| `aiGenerated` | Boolean | True if AI wrote the initial draft |
| `summary` | String? | Executive summary |
| `customerImpact` | String? | |
| `incidentTimeline` | String? | Chronological reconstruction |
| `rootCause` | String? | |
| `contributingFactors` | String? | |
| `detection` | String? | How was the incident detected |
| `resolution` | String? | What fixed it |
| `wentWell` | String? | |
| `wentWrong` | String? | |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Unique constraints:** `incidentId` — one postmortem per incident

---

### ActionItem

**Purpose:** A remediation task derived from a postmortem. Future: can be exported to Jira.

| Field | Type | Notes |
|---|---|---|
| `id` | String (CUID) | Primary key |
| `postmortemId` | String | FK → Postmortem (Cascade delete) |
| `title` | String | |
| `description` | String? | |
| `status` | ActionItemStatus | OPEN, IN_PROGRESS, COMPLETED, CANCELLED |
| `priority` | ActionItemPriority | LOW, MEDIUM, HIGH, CRITICAL |
| `assigneeId` | String? | User ID (no FK — flexible) |
| `dueDate` | DateTime? | |
| `jiraIssueId` | String? | Phase 2+ |
| `jiraIssueUrl` | String? | Phase 2+ |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

**Indexes:** `postmortemId`, `status`

---

## Tenant Boundary Summary

The following query pattern MUST be followed for all incident-related API endpoints:

```typescript
// ALWAYS include organizationId in the where clause
await prisma.incident.findMany({
  where: {
    organizationId: req.user.organizationId, // From verified JWT
    // ... other filters
  },
});
```

The `organizationId` on `Incident` is the **enforcement point** for tenant isolation. The auth middleware (Phase 3) will populate `req.user.organizationId` from the verified JWT. Route handlers must never accept `organizationId` from the request body — it must always come from the authenticated session.

---

## Enum Reference

| Enum | Values |
|---|---|
| `OrgRole` | OWNER, ADMIN, RESPONDER, VIEWER |
| `IncidentSeverity` | SEV_1, SEV_2, SEV_3, SEV_4 |
| `IncidentStatus` | INVESTIGATING, IDENTIFIED, MONITORING, RESOLVED |
| `EventSource` | USER, GITHUB, SENTRY, SLACK, SYSTEM, AI |
| `IntegrationProvider` | GITHUB, SENTRY, SLACK, JIRA |
| `IntegrationStatus` | CONNECTED, DISCONNECTED, ERROR |
| `EvidenceType` | GITHUB_COMMIT, GITHUB_PR, GITHUB_DEPLOYMENT, GITHUB_WORKFLOW_RUN, SENTRY_ERROR, SLACK_MESSAGE, TIMELINE_EVENT, HISTORICAL_INCIDENT, MANUAL |
| `EvidenceSource` | CORRELATION_ENGINE, AI_SUGGESTED, MANUAL |
| `PostmortemStatus` | DRAFT, IN_REVIEW, APPROVED, PUBLISHED |
| `ActionItemStatus` | OPEN, IN_PROGRESS, COMPLETED, CANCELLED |
| `ActionItemPriority` | LOW, MEDIUM, HIGH, CRITICAL |

---

## Entity Relationship Diagram

```
User ──────────────────────────────────────────┐
 │                                             │
 ├── OrganizationMember ── Organization        │
 │                          │                  │
 ├── TeamMember ──── Team   ├── Project         │
 │                          │   ├── Service     │
 │                          │   └── Incident ◄─┘ (assignee)
 │                          │       ├── IncidentEvent
 │                          │       ├── Comment
 │                          │       │   └── Comment (replies)
 │                          │       ├── IncidentEvidence ── ExternalEvent
 │                          │       └── Postmortem
 │                          │           └── ActionItem
 │                          │
 │                          └── Integration ── ExternalEvent
 │
 └── (comments, events via FK)
```
