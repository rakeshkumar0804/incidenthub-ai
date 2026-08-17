/**
 * Express Request type augmentations for IncidentHub AI.
 *
 * Phase 2: Authenticated user context will be added here once JWT auth is implemented.
 * This file intentionally has an empty interface to reserve the namespace.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export {};

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
      };
      orgMember?: {
        organizationId: string;
        role: import('@incidenthub/shared').OrgRole;
      };
    }
  }
}
