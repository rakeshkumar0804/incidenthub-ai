import { ReplayCategory, EventSource } from '@prisma/client';
import { sanitizeString } from '../ai/sanitizer';
import type { NormalizedReplayEventInput } from './replay.types';

export const MAX_REPLAY_EVENTS = 500;

export const CATEGORY_WEIGHTS: Record<ReplayCategory, number> = {
  STATE_CHANGE: 10,
  TELEMETRY: 20,
  CORRELATION: 30,
  INVESTIGATION: 30,
  COMMUNICATION: 40,
};

export interface ReplayWindow {
  windowStart: Date;
  windowEnd: Date;
  isSnapshot: boolean;
}

/**
 * Calculates the exact immutable replay window boundaries.
 * Resolved incident: [detectedAt - 2h, resolvedAt + 30m]
 * Unresolved incident: [detectedAt - 2h, executionCutoff]
 */
export function calculateReplayWindow(
  incident: { detectedAt: Date; resolvedAt: Date | null },
  executionCutoff: Date,
): ReplayWindow {
  const windowStart = new Date(incident.detectedAt.getTime() - 2 * 60 * 60 * 1000);

  if (incident.resolvedAt) {
    const windowEnd = new Date(incident.resolvedAt.getTime() + 30 * 60 * 1000);
    return { windowStart, windowEnd, isSnapshot: false };
  }

  return { windowStart, windowEnd: executionCutoff, isSnapshot: true };
}

/**
 * Resolves authoritative source timestamp with honest timestampBasis metadata.
 */
export function resolveEvidenceTimestamp(ev: {
  addedAt: Date;
  metadata?: unknown;
}): { timestamp: Date; timestampBasis: 'source_occurred_at' | 'evidence_added_at' } {
  const meta = ev.metadata;
  if (meta && typeof meta === 'object') {
    const record = meta as Record<string, unknown>;
    const candidateTimestamp =
      record['occurredAt'] ||
      record['detectedAt'] ||
      record['timestamp'] ||
      record['commitTimestamp'] ||
      record['deploymentTimestamp'];

    if (candidateTimestamp && (typeof candidateTimestamp === 'string' || typeof candidateTimestamp === 'number' || candidateTimestamp instanceof Date)) {
      const parsed = new Date(candidateTimestamp);
      if (!isNaN(parsed.getTime())) {
        return { timestamp: parsed, timestampBasis: 'source_occurred_at' };
      }
    }
  }

  return { timestamp: ev.addedAt, timestampBasis: 'evidence_added_at' };
}

/**
 * Deterministic 3-key comparator:
 * 1. Timestamp ASC
 * 2. Category weight ASC
 * 3. sourceEventId ASC
 */
export function replayEventComparator(
  a: NormalizedReplayEventInput,
  b: NormalizedReplayEventInput,
): number {
  const timeDiff = a.timestamp.getTime() - b.timestamp.getTime();
  if (timeDiff !== 0) return timeDiff;

  const weightDiff = a.categoryWeight - b.categoryWeight;
  if (weightDiff !== 0) return weightDiff;

  return a.sourceEventId.localeCompare(b.sourceEventId);
}

export const PROTECTED_EVENT_TYPES = new Set<string>([
  'INCIDENT_DETECTED',
  'STATUS_CHANGED',
  'SEVERITY_CHANGED',
  'INCIDENT_RESOLVED',
  'RESOLVED',
  'ACKNOWLEDGED',
  'ASSIGNED',
  'UNASSIGNED',
  'CORRELATION_STARTED',
  'CORRELATION_COMPLETED',
  'CORRELATION_FAILED',
  'INVESTIGATION_STARTED',
  'INVESTIGATION_COMPLETED',
  'INVESTIGATION_FAILED',
]);

export const TERMINAL_ANCHOR_EVENT_TYPES = new Set<string>([
  'RESOLVED',
  'CLOSED',
  'INCIDENT_RESOLVED',
  'INCIDENT_CLOSED',
  'STATUS_CHANGE_RESOLVED',
  'STATUS_CHANGE_CLOSED',
  'STATE_CHANGE_RESOLVED',
  'STATE_CHANGE_CLOSED',
]);

export const MANDATORY_ANCHOR_EVENT_TYPES = new Set<string>([
  'INCIDENT_DETECTED',
  ...TERMINAL_ANCHOR_EVENT_TYPES,
]);

/**
 * Reusable predicate to recognize terminal incident lifecycle transitions.
 * Recognizes direct terminal event types and production STATUS_CHANGED metadata shapes.
 * Handles absent/malformed metadata safely and rejects arbitrary substring matches.
 */
export function isTerminalAnchorEvent(event: NormalizedReplayEventInput): boolean {
  const upperType = (event.eventType || '').toUpperCase();

  if (TERMINAL_ANCHOR_EVENT_TYPES.has(upperType)) {
    return true;
  }

  if (event.category === ReplayCategory.STATE_CHANGE) {
    if (upperType === 'RESOLVED' || upperType === 'CLOSED' || upperType === 'RESOLVE' || upperType === 'CLOSE') {
      return true;
    }
  }

  const meta = event.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const newStatus = typeof meta['newStatus'] === 'string' ? meta['newStatus'].toUpperCase() : undefined;
    const toStatus = typeof meta['toStatus'] === 'string' ? meta['toStatus'].toUpperCase() : undefined;
    const targetStatus = typeof meta['targetStatus'] === 'string' ? meta['targetStatus'].toUpperCase() : undefined;

    const transitionStatus = newStatus || toStatus || targetStatus;

    if (
      upperType === 'STATUS_CHANGED' ||
      upperType === 'STATUS_CHANGE' ||
      upperType === 'STATE_CHANGE' ||
      event.category === ReplayCategory.STATE_CHANGE
    ) {
      if (transitionStatus === 'RESOLVED' || transitionStatus === 'CLOSED') {
        return true;
      }
    }
  }

  return false;
}

export function isMandatoryAnchorEvent(ev: NormalizedReplayEventInput): boolean {
  const upper = (ev.eventType || '').toUpperCase();
  if (upper === 'INCIDENT_DETECTED') {
    return true;
  }
  return isTerminalAnchorEvent(ev);
}

export function isProtectedLifecycleEvent(ev: NormalizedReplayEventInput): boolean {
  if (isMandatoryAnchorEvent(ev)) {
    return true;
  }
  if (PROTECTED_EVENT_TYPES.has(ev.eventType)) {
    return true;
  }
  if (
    ev.category === ReplayCategory.STATE_CHANGE ||
    ev.category === ReplayCategory.CORRELATION ||
    ev.category === ReplayCategory.INVESTIGATION
  ) {
    return true;
  }
  return false;
}

export function isTier2ProtectedLifecycleEvent(ev: NormalizedReplayEventInput): boolean {
  if (isMandatoryAnchorEvent(ev)) {
    return false;
  }
  return isProtectedLifecycleEvent(ev);
}

/**
 * Deduplicates exact sourceEventIds, enforces strict three-tier retention policy,
 * applies the global cap, and returns deterministically sorted events.
 *
 * Tier 1 — Mandatory anchors (Incident detection, terminal resolution/closed)
 * Tier 2 — Other protected lifecycle events (State changes, correlation runs, investigation runs)
 * Tier 3 — Auxiliary events (Telemetry, communication, comments)
 */
export function deduplicateAndRetainEvents(
  candidates: NormalizedReplayEventInput[],
  maxCap: number = MAX_REPLAY_EVENTS,
): { retained: NormalizedReplayEventInput[]; isTruncated: boolean } {
  // 1. Exact deduplication by sourceEventId
  const uniqueMap = new Map<string, NormalizedReplayEventInput>();
  for (const item of candidates) {
    if (!uniqueMap.has(item.sourceEventId)) {
      uniqueMap.set(item.sourceEventId, item);
    }
  }

  const uniqueEvents = Array.from(uniqueMap.values());

  if (uniqueEvents.length <= maxCap) {
    const sorted = [...uniqueEvents].sort(replayEventComparator);
    return { retained: sorted, isTruncated: false };
  }

  // 2. Partition into explicit 3 tiers
  const tier1Anchors: NormalizedReplayEventInput[] = [];
  const tier2Protected: NormalizedReplayEventInput[] = [];
  const tier3Auxiliary: NormalizedReplayEventInput[] = [];

  for (const evt of uniqueEvents) {
    if (isMandatoryAnchorEvent(evt)) {
      tier1Anchors.push(evt);
    } else if (isTier2ProtectedLifecycleEvent(evt)) {
      tier2Protected.push(evt);
    } else {
      tier3Auxiliary.push(evt);
    }
  }

  // Deterministically sort each tier
  tier1Anchors.sort(replayEventComparator);
  tier2Protected.sort(replayEventComparator);
  tier3Auxiliary.sort(replayEventComparator);

  let selected: NormalizedReplayEventInput[] = [];

  if (tier1Anchors.length >= maxCap) {
    // If mandatory anchors alone exceed maxCap, preserve at least one canonical detection
    // and the latest canonical terminal resolution/closed event, filling remainder with anchors
    const detectionEvents = tier1Anchors.filter((e) => (e.eventType || '').toUpperCase() === 'INCIDENT_DETECTED');
    const terminalEvents = tier1Anchors.filter((e) => isTerminalAnchorEvent(e));
    const guaranteed: NormalizedReplayEventInput[] = [];
    const guaranteedIds = new Set<string>();

    if (detectionEvents.length > 0 && detectionEvents[0]) {
      guaranteed.push(detectionEvents[0]);
      guaranteedIds.add(detectionEvents[0].sourceEventId);
    }
    if (terminalEvents.length > 0) {
      const sortedTerminal = [...terminalEvents].sort(replayEventComparator);
      const latestTerminal = sortedTerminal[sortedTerminal.length - 1];
      if (latestTerminal && !guaranteedIds.has(latestTerminal.sourceEventId)) {
        guaranteed.push(latestTerminal);
        guaranteedIds.add(latestTerminal.sourceEventId);
      }
    }

    const remainingQuota = maxCap - guaranteed.length;
    const remainingAnchors = tier1Anchors.filter((e) => !guaranteedIds.has(e.sourceEventId));
    const filledAnchors = remainingAnchors.slice(0, remainingQuota);

    selected = [...guaranteed, ...filledAnchors];
  } else {
    // Retain all Tier 1 mandatory anchors first
    selected = [...tier1Anchors];

    // Fill with Tier 2 protected lifecycle events
    const remainingAfterTier1 = maxCap - selected.length;
    const filledTier2 = tier2Protected.slice(0, remainingAfterTier1);
    selected.push(...filledTier2);

    // Fill remaining space with Tier 3 auxiliary events
    if (selected.length < maxCap) {
      const remainingAfterTier2 = maxCap - selected.length;
      const filledTier3 = tier3Auxiliary.slice(0, remainingAfterTier2);
      selected.push(...filledTier3);
    }
  }

  selected.sort(replayEventComparator);
  return { retained: selected, isTruncated: true };
}

/**
 * Normalization helper for Incident Detection event.
 */
export function createIncidentDetectedEvent(incident: {
  id: string;
  number: number;
  title: string;
  description: string | null;
  severity: string;
  environment: string;
  status: string;
  detectedAt: Date;
  createdBy?: { name: string | null } | null;
}): NormalizedReplayEventInput {
  return {
    category: ReplayCategory.STATE_CHANGE,
    categoryWeight: CATEGORY_WEIGHTS[ReplayCategory.STATE_CHANGE],
    eventType: 'INCIDENT_DETECTED',
    source: EventSource.SYSTEM,
    sourceEventId: `incident:${incident.id}:INCIDENT_DETECTED:0`,
    timestamp: incident.detectedAt,
    actorName: incident.createdBy?.name ? sanitizeString(incident.createdBy.name) : 'Automated Detection',
    actorEmail: null,
    title: sanitizeString(`Incident INC-${String(incident.number).padStart(4, '0')} Detected: ${incident.title}`),
    description: incident.description
      ? sanitizeString(incident.description)
      : sanitizeString(`Severity: ${incident.severity}, Environment: ${incident.environment}`),
    externalUrl: null,
    evidenceId: null,
    metadata: {
      number: incident.number,
      severity: incident.severity,
      environment: incident.environment,
      status: incident.status,
    },
  };
}

/**
 * Sanitizes and formats an event message removing obsolete internal phase labels.
 */
export function cleanReplayText(text: string): string {
  const sanitized = sanitizeString(text);
  return sanitized
    .replace(/Phase\s*8\s*Correlation/gi, 'Correlation Engine')
    .replace(/Phase\s*9\s*AI\s*Investigation/gi, 'AI Investigation')
    .replace(/Phase\s*10\s*Incident\s*Replay/gi, 'Incident Replay');
}

/**
 * Formats a signed relative time offset against an anchor timestamp with exact second fidelity.
 * - Exact detection anchor: T+0s
 * - 42 seconds before: T−42s
 * - 42 seconds after: T+42s
 * - 15 minutes before: T−15m
 * - 15 minutes after: T+15m
 * - 1 hour 15 minutes after: T+1h 15m
 */
export function formatSignedRelativeTime(
  targetTime: Date | number | string,
  anchorTime: Date | number | string,
): string {
  const targetMs = typeof targetTime === 'number' ? targetTime : new Date(targetTime).getTime();
  const anchorMs = typeof anchorTime === 'number' ? anchorTime : new Date(anchorTime).getTime();

  if (isNaN(targetMs) || isNaN(anchorMs)) {
    return 'T+0s';
  }

  const diffMs = targetMs - anchorMs;
  if (diffMs === 0) {
    return 'T+0s';
  }

  const isNegative = diffMs < 0;
  const sign = isNegative ? 'T−' : 'T+';
  const absDiffSec = Math.floor(Math.abs(diffMs) / 1000);

  if (absDiffSec === 0) {
    return isNegative ? 'T−1s' : 'T+1s';
  }

  if (absDiffSec < 60) {
    return `${sign}${absDiffSec}s`;
  }

  const absDiffMin = Math.floor(absDiffSec / 60);
  const remSec = absDiffSec % 60;

  if (absDiffMin < 60) {
    if (remSec > 0) {
      return `${sign}${absDiffMin}m ${remSec}s`;
    }
    return `${sign}${absDiffMin}m`;
  }

  const absDiffHours = Math.floor(absDiffMin / 60);
  const remMin = absDiffMin % 60;

  if (remMin > 0) {
    return `${sign}${absDiffHours}h ${remMin}m`;
  }
  return `${sign}${absDiffHours}h`;
}

