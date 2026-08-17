# IncidentHub AI — API Documentation

## Overview

The IncidentHub AI API is a RESTful HTTP API served at:

- **Development:** `http://localhost:4000/api/v1`
- **Production:** `https://api.yourdomain.com/api/v1`

All responses are JSON. All request bodies must use `Content-Type: application/json`.

---

## API Conventions

### Versioning

All routes are prefixed with `/api/v1`. When a breaking change is required, a new version prefix (`/api/v2`) will be added while maintaining `/api/v1` with a deprecation timeline.

### Base URL Structure

```
/api/v1/{resource}
/api/v1/{resource}/{id}
/api/v1/{resource}/{id}/{sub-resource}
```

### HTTP Methods

| Method | Usage |
|---|---|
| GET | Retrieve resources (never mutates state) |
| POST | Create a resource |
| PUT | Replace a resource entirely |
| PATCH | Partial update of a resource |
| DELETE | Remove a resource |

---

## Response Format

### Success Response

All successful responses are wrapped in a consistent envelope:

```json
{
  "success": true,
  "data": { ... }
}
```

### Paginated Response

List endpoints return paginated results:

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "meta": {
      "total": 143,
      "page": 1,
      "perPage": 25,
      "totalPages": 6,
      "hasNextPage": true,
      "hasPreviousPage": false
    }
  }
}
```

### Error Response

All errors follow this structure:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Incident with id abc123 not found"
  }
}
```

**Error codes:**

| Code | HTTP Status | Description |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body or query params failed validation |
| `UNAUTHORIZED` | 401 | Missing or invalid authentication token |
| `FORBIDDEN` | 403 | Authenticated but insufficient permissions |
| `NOT_FOUND` | 404 | Requested resource does not exist |
| `CONFLICT` | 409 | Resource already exists (e.g., duplicate slug) |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error |

---

## Authentication Strategy (Phase 2)

> Not yet implemented. Planned for Phase 3.

IncidentHub uses **JWT with refresh token rotation** via HttpOnly cookies.

### Token Flow

```
POST /api/v1/auth/login
  → Returns access token (JSON body, 15min expiry)
  → Sets HttpOnly cookie with refresh token (7 day expiry)

POST /api/v1/auth/refresh
  → Reads refresh token from HttpOnly cookie
  → Returns new access token
  → Rotates refresh token (old one invalidated)

POST /api/v1/auth/logout
  → Invalidates refresh token
  → Clears cookie
```

### Request Authentication

Include the access token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Token Payload

```json
{
  "sub": "user_cuid",
  "email": "user@example.com",
  "organizationId": "org_cuid",
  "role": "ADMIN",
  "iat": 1234567890,
  "exp": 1234568790
}
```

The `organizationId` in the token is used by all route handlers for tenant isolation.

---

## Implemented Endpoints (Phase 1)

### Health Check

```
GET /api/v1/health
```

No authentication required. Used by load balancers and CI pipelines.

**Response (200 OK):**
```json
{
  "status": "ok",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "services": {
    "database": "connected"
  }
}
```

**Response (503 Service Unavailable — database unreachable):**
```json
{
  "status": "degraded",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "services": {
    "database": "disconnected"
  }
}
```

---

## Planned Endpoints (Phase 3+)

The following endpoints are planned but not yet implemented. This list reflects the intended API surface.

### Authentication (Phase 3)

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/refresh
POST   /api/v1/auth/verify-email
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
```

### Organizations (Phase 4)

```
GET    /api/v1/organizations
POST   /api/v1/organizations
GET    /api/v1/organizations/:orgId
PATCH  /api/v1/organizations/:orgId
DELETE /api/v1/organizations/:orgId

GET    /api/v1/organizations/:orgId/members
POST   /api/v1/organizations/:orgId/members/invite
PATCH  /api/v1/organizations/:orgId/members/:userId
DELETE /api/v1/organizations/:orgId/members/:userId
```

### Teams (Phase 4)

```
GET    /api/v1/organizations/:orgId/teams
POST   /api/v1/organizations/:orgId/teams
GET    /api/v1/organizations/:orgId/teams/:teamId
PATCH  /api/v1/organizations/:orgId/teams/:teamId
DELETE /api/v1/organizations/:orgId/teams/:teamId

POST   /api/v1/organizations/:orgId/teams/:teamId/members
DELETE /api/v1/organizations/:orgId/teams/:teamId/members/:userId
```

### Projects (Phase 4)

```
GET    /api/v1/organizations/:orgId/projects
POST   /api/v1/organizations/:orgId/projects
GET    /api/v1/organizations/:orgId/projects/:projectId
PATCH  /api/v1/organizations/:orgId/projects/:projectId
DELETE /api/v1/organizations/:orgId/projects/:projectId

GET    /api/v1/organizations/:orgId/projects/:projectId/services
POST   /api/v1/organizations/:orgId/projects/:projectId/services
```

### Incidents (Phase 5)

```
GET    /api/v1/organizations/:orgId/incidents
POST   /api/v1/organizations/:orgId/incidents
GET    /api/v1/organizations/:orgId/incidents/:incidentId
PATCH  /api/v1/organizations/:orgId/incidents/:incidentId
DELETE /api/v1/organizations/:orgId/incidents/:incidentId

GET    /api/v1/organizations/:orgId/incidents/:incidentId/timeline
POST   /api/v1/organizations/:orgId/incidents/:incidentId/timeline

GET    /api/v1/organizations/:orgId/incidents/:incidentId/comments
POST   /api/v1/organizations/:orgId/incidents/:incidentId/comments
PATCH  /api/v1/organizations/:orgId/incidents/:incidentId/comments/:commentId
DELETE /api/v1/organizations/:orgId/incidents/:incidentId/comments/:commentId

GET    /api/v1/organizations/:orgId/incidents/:incidentId/evidence
POST   /api/v1/organizations/:orgId/incidents/:incidentId/evidence
DELETE /api/v1/organizations/:orgId/incidents/:incidentId/evidence/:evidenceId
```

### Integrations (Phase 7)

```
GET    /api/v1/organizations/:orgId/integrations
GET    /api/v1/organizations/:orgId/integrations/:provider
DELETE /api/v1/organizations/:orgId/integrations/:provider

# GitHub OAuth
GET    /api/v1/integrations/github/oauth/connect
GET    /api/v1/integrations/github/oauth/callback

# Webhooks (no auth — verified by HMAC)
POST   /api/v1/webhooks/github
POST   /api/v1/webhooks/sentry
```

### AI Investigation (Phase 10)

```
POST   /api/v1/organizations/:orgId/incidents/:incidentId/investigate
GET    /api/v1/organizations/:orgId/incidents/:incidentId/investigation

POST   /api/v1/organizations/:orgId/incidents/:incidentId/postmortem/generate
GET    /api/v1/organizations/:orgId/incidents/:incidentId/postmortem
PATCH  /api/v1/organizations/:orgId/incidents/:incidentId/postmortem
```

---

## Input Validation

All API inputs are validated with **Zod** schemas on the server before any business logic runs.

Validation errors return:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "title": ["String must contain at least 1 character(s)"],
      "severity": ["Invalid enum value. Expected 'SEV_1' | 'SEV_2' | 'SEV_3' | 'SEV_4'"]
    }
  }
}
```

---

## Pagination

List endpoints support pagination via query parameters:

```
GET /api/v1/organizations/:orgId/incidents?page=2&perPage=50
```

| Parameter | Default | Max | Description |
|---|---|---|---|
| `page` | 1 | — | Page number (1-indexed) |
| `perPage` | 25 | 100 | Items per page |

---

## Rate Limiting (Phase 2+)

| Scope | Limit |
|---|---|
| Unauthenticated | 30 requests / 15 minutes |
| Authenticated | 500 requests / 15 minutes |
| AI endpoints | 10 requests / 15 minutes |

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 497
X-RateLimit-Reset: 1234567890
```

---

## CORS

The API accepts requests from `CLIENT_URL` (configured via environment variable). Wildcard origins are never allowed. Credentials (cookies) are supported.

---

## Webhook Security

Inbound webhooks from GitHub and Sentry are verified using HMAC signatures before any processing occurs:

- **GitHub:** `X-Hub-Signature-256` header, `sha256=` prefixed HMAC-SHA256
- **Sentry:** `sentry-hook-signature` header, hex-encoded HMAC-SHA256

Webhooks that fail signature verification are rejected with `401 Unauthorized`. Raw webhook payloads are stored in the `ExternalEvent` table before entering the processing queue.
