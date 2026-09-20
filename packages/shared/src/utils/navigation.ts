/**
 * Validates and sanitizes internal navigation targets to prevent Open Redirect
 * vulnerabilities (e.g., CVE-2025-68470 / GHSA-wrjc-x8rr-h8h6 / GHSA-jjmj-jmhj-qwj2).
 */

function isCandidateSafe(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') {
    return false;
  }

  let current = candidate.trim();
  if (!current) {
    return false;
  }

  // Multi-pass validation: original string + up to 3 decode passes
  const MAX_PASSES = 3;
  for (let pass = 0; pass <= MAX_PASSES; pass++) {
    // 1. Must start with exactly one leading slash and not protocol-relative '//'
    if (!current.startsWith('/') || current.startsWith('//')) {
      return false;
    }

    // 2. Reject ANY single backslash in current representation
    if (current.includes('\\')) {
      return false;
    }

    // 3. Reject scheme indicators (e.g., javascript:, http:, data:, vbscript:)
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(current)) {
      return false;
    }

    // 4. Reject protocol-relative / origin escapes after leading slash (e.g. /\ or //)
    if (/^\/[\\/]/.test(current)) {
      return false;
    }

    // 5. Reject ASCII control characters (0x00-0x1F, 0x7F)
    for (let i = 0; i < current.length; i++) {
      const code = current.charCodeAt(i);
      if ((code >= 0 && code <= 31) || code === 127) {
        return false;
      }
    }

    // Attempt decode for next pass if percent-encoded characters remain
    if (pass < MAX_PASSES) {
      if (!current.includes('%')) {
        break; // No further percent decoding needed
      }
      try {
        const decoded = decodeURIComponent(current);
        if (decoded === current) {
          break;
        }
        current = decoded;
      } catch {
        // Malformed percent encoding -> fail closed
        return false;
      }
    }
  }

  try {
    // Final URL origin verification against dummy base
    const rawTrimmed = candidate.trim();
    const parsed = new URL(rawTrimmed, 'https://incidenthub.internal');
    if (parsed.origin !== 'https://incidenthub.internal') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function getSafeInternalPath(
  value: unknown,
  fallback = '/',
): string {
  const safeFallback = isCandidateSafe(fallback) ? fallback.trim() : '/';

  if (!isCandidateSafe(value)) {
    return safeFallback;
  }

  try {
    const rawTrimmed = value.trim();
    const parsed = new URL(rawTrimmed, 'https://incidenthub.internal');
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return safeFallback;
  }
}
