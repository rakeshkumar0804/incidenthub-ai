/**
 * @incidenthub/config
 *
 * Shared application constants that are safe to use in both
 * the frontend and backend.
 *
 * Rules:
 * - No secrets (no keys, tokens, passwords)
 * - No framework imports
 * - Only truly shared constants — not just any constant
 */

// =============================================================================
// API
// =============================================================================

/// Current API version prefix used in all routes.
export const API_VERSION = 'v1' as const;

/// Base path for all API routes.
export const API_BASE_PATH = `/api/${API_VERSION}` as const;

// =============================================================================
// Pagination defaults
// =============================================================================

export const DEFAULT_PAGE = 1;
export const DEFAULT_PER_PAGE = 25;
export const MAX_PER_PAGE = 100;

// =============================================================================
// Incident constants
// =============================================================================

/// Minimum minutes between a deployment and an incident for the
/// correlation engine to consider them related (Phase 9).
export const CORRELATION_DEPLOYMENT_WINDOW_MINUTES = 60;

/// Minimum score for the correlation engine to surface evidence automatically.
export const CORRELATION_MIN_CONFIDENCE = 0.4;

// =============================================================================
// Rate limiting (Phase 2+)
// =============================================================================

/// Max API requests per window per IP (unauthenticated).
export const RATE_LIMIT_UNAUTHENTICATED_MAX = 30;

/// Max API requests per window per user (authenticated).
export const RATE_LIMIT_AUTHENTICATED_MAX = 500;

/// Rate limit window duration in milliseconds.
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
