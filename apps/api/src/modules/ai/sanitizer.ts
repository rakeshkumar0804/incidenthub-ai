/**
 * Recursive Secret and Credential Sanitizer for AI Investigation and Telemetry.
 *
 * Implements non-destructive deep cloning with bounded recursion depth,
 * collection size caps, circular reference detection, regex token redaction,
 * and key-based credential scrubbing.
 */

const SENSITIVE_KEY_REGEX =
  /^(password|passwd|secret|token|api[_-]?key|auth|authorization|cookie|session|signature|private[_-]?key|client[_-]?secret|jwt|credential|credentials|webhook_secret)$/i;

const GITHUB_TOKEN_REGEX = /gh[pousr]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{36,}/g;
const OPENAI_KEY_REGEX = /sk-(?:proj-)?[a-zA-Z0-9_-]{32,}/g;
const SENTRY_TOKEN_REGEX = /sentry_[a-zA-Z0-9]{32,}/g;
const SENTRY_DSN_REGEX = /https?:\/\/[a-f0-9]+(?::[a-f0-9]+)?@o[0-9]+\.ingest(?:\.[a-z0-9-]+)?\.sentry\.io\/[0-9]+/g;
const SLACK_TOKEN_REGEX = /xox[baprs]-[a-zA-Z0-9-]+/g;
const BEARER_REGEX = /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi;
const JWT_REGEX = /eyJ[a-zA-Z0-9_-]{8,}\.eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]+/g;
const DB_URL_CREDS_REGEX = /(postgres|postgresql|mysql|mongodb|redis|rediss):\/\/[^:\s/@]+:[^@\s/]+@/gi;
const HTTP_AUTH_REGEX = /https?:\/\/[^:\s/@]+:[^@\s/]+@/gi;
const QUERY_PARAM_SECRET_REGEX = /([?&](?:token|key|secret|signature|auth|api_key|access_token|client_secret)=)[^&#\s]+/gi;

/**
 * Redacts recognized secret patterns from a string.
 */
export function sanitizeString(text: string): string {
  if (!text || typeof text !== 'string') return text;

  return text
    .replace(GITHUB_TOKEN_REGEX, '[REDACTED_GITHUB_TOKEN]')
    .replace(OPENAI_KEY_REGEX, '[REDACTED_OPENAI_KEY]')
    .replace(SENTRY_TOKEN_REGEX, '[REDACTED_SENTRY_KEY]')
    .replace(SENTRY_DSN_REGEX, 'https://[REDACTED_SENTRY_DSN]')
    .replace(SLACK_TOKEN_REGEX, '[REDACTED_SLACK_TOKEN]')
    .replace(BEARER_REGEX, 'Bearer [REDACTED_TOKEN]')
    .replace(JWT_REGEX, '[REDACTED_JWT]')
    .replace(DB_URL_CREDS_REGEX, '$1://[REDACTED_CREDS]@')
    .replace(HTTP_AUTH_REGEX, 'https://[REDACTED_CREDS]@')
    .replace(QUERY_PARAM_SECRET_REGEX, '$1[REDACTED]');
}

const MAX_DEPTH = 15;
const MAX_COLLECTION_SIZE = 500;

function internalSanitize<T>(
  val: T,
  depth: number,
  visited: WeakSet<object>,
): T {
  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === 'string') {
    return sanitizeString(val) as unknown as T;
  }

  if (typeof val !== 'object') {
    return val;
  }

  if (depth > MAX_DEPTH) {
    return '[MAX_DEPTH_EXCEEDED]' as unknown as T;
  }

  if (visited.has(val)) {
    return '[CIRCULAR_REFERENCE]' as unknown as T;
  }

  visited.add(val);

  if (Array.isArray(val)) {
    const arr: unknown[] = [];
    const len = Math.min(val.length, MAX_COLLECTION_SIZE);
    for (let i = 0; i < len; i++) {
      arr.push(internalSanitize(val[i], depth + 1, visited));
    }
    return arr as unknown as T;
  }

  if (val instanceof Date) {
    return new Date(val.getTime()) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(val as Record<string, unknown>);
  const len = Math.min(entries.length, MAX_COLLECTION_SIZE);

  for (let i = 0; i < len; i++) {
    const entry = entries[i];
    if (entry) {
      const [k, v] = entry;
      if (SENSITIVE_KEY_REGEX.test(k)) {
        result[k] = '[REDACTED_SECRET]';
      } else {
        result[k] = internalSanitize(v, depth + 1, visited);
      }
    }
  }

  return result as unknown as T;
}

/**
 * Returns a sanitized, deep copy of the input without mutating the original.
 */
export function sanitizeRecursive<T>(val: T): T {
  const visited = new WeakSet<object>();
  return internalSanitize(val, 0, visited);
}
