export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(statusCode: number, code: string, message: string, isOperational = true) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, 'VALIDATION_ERROR', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service Unavailable') {
    super(503, 'SERVICE_UNAVAILABLE', message);
  }
}

export class LockOwnershipLostError extends AppError {
  constructor(message = 'Operation could not be completed safely. Please retry.') {
    super(409, 'LOCK_OWNERSHIP_LOST', message);
  }
}


export type PrismaUniqueClassification =
  | 'EXTERNAL_EVENT_DUPLICATE'
  | 'INCIDENT_NUMBER_CONFLICT'
  | 'UNRELATED_CONFLICT';

/**
 * Classifies a Prisma P2002 Unique Constraint Violation by exact target metadata.
 * Fails closed to 'UNRELATED_CONFLICT' on missing, ambiguous, or non-matching targets.
 *
 * Rules:
 * 1. ExternalEvent duplicate: Returns 'EXTERNAL_EVENT_DUPLICATE' ONLY when target identifies (provider + externalId).
 * 2. Incident numbering retry: Returns 'INCIDENT_NUMBER_CONFLICT' ONLY when target identifies (organizationId + number).
 * 3. Unknown or unrelated conflicts: Missing target, 'id', other model fields, etc. return 'UNRELATED_CONFLICT'.
 */
export function classifyPrismaUniqueError(err: unknown): PrismaUniqueClassification {
  if (
    typeof err !== 'object' ||
    err === null ||
    !('code' in err) ||
    err.code !== 'P2002'
  ) {
    return 'UNRELATED_CONFLICT';
  }

  const meta = (err as { meta?: { target?: unknown } }).meta;
  const target = meta?.target;
  if (!target) {
    return 'UNRELATED_CONFLICT';
  }

  // Target as string array (standard Prisma format, e.g. ['provider', 'externalId'] or ['organizationId', 'number'])
  if (Array.isArray(target)) {
    const targetStrings = target.filter((item): item is string => typeof item === 'string');

    // Reject single 'id' or primary key target explicitly
    if (targetStrings.length === 1 && targetStrings[0] === 'id') {
      return 'UNRELATED_CONFLICT';
    }

    // Check for composite provider + externalId
    const hasProvider = targetStrings.includes('provider');
    const hasExternalId = targetStrings.includes('externalId');
    if ((hasProvider && hasExternalId) || targetStrings.some((t) => t.includes('provider_externalId'))) {
      return 'EXTERNAL_EVENT_DUPLICATE';
    }

    // Check for composite organizationId + number
    const hasOrgId = targetStrings.includes('organizationId');
    const hasNumber = targetStrings.includes('number');
    if ((hasOrgId && hasNumber) || targetStrings.some((t) => t.includes('organizationId_number'))) {
      return 'INCIDENT_NUMBER_CONFLICT';
    }

    return 'UNRELATED_CONFLICT';
  }

  // Target as string (e.g. "ExternalEvent_provider_externalId_key" or "Incident_organizationId_number_key")
  if (typeof target === 'string') {
    if (target === 'id' || target.endsWith('_pkey') || target === 'PRIMARY') {
      return 'UNRELATED_CONFLICT';
    }

    const lowerTarget = target.toLowerCase();
    if (
      (lowerTarget.includes('provider') && lowerTarget.includes('externalid')) ||
      lowerTarget.includes('provider_externalid')
    ) {
      return 'EXTERNAL_EVENT_DUPLICATE';
    }

    if (
      (lowerTarget.includes('organizationid') && lowerTarget.includes('number')) ||
      lowerTarget.includes('organizationid_number')
    ) {
      return 'INCIDENT_NUMBER_CONFLICT';
    }

    return 'UNRELATED_CONFLICT';
  }

  return 'UNRELATED_CONFLICT';
}
