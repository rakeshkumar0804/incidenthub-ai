/**
 * Dependency-neutral numeric sanitization utility for postmortem metrics.
 * Ensures numbers are finite, non-negative, floored integers with optional upper bounds.
 *
 * This module has ZERO dependencies on services, providers, database, or socket layers.
 */
export function toFiniteNonNegativeInteger(
  value: unknown,
  fallback = 0,
  max?: number,
): number {
  const sanitize = (n: number): number => {
    const floored = Math.max(0, Math.floor(n));
    if (typeof max === 'number' && Number.isFinite(max) && !Number.isNaN(max) && max >= 0) {
      return Math.min(floored, Math.floor(max));
    }
    return floored;
  };

  const safeFallback = (typeof fallback === 'number' && Number.isFinite(fallback) && !Number.isNaN(fallback) && fallback >= 0)
    ? sanitize(fallback)
    : 0;

  if (typeof value !== 'number' || !Number.isFinite(value) || Number.isNaN(value)) {
    return safeFallback;
  }

  return sanitize(value);
}
