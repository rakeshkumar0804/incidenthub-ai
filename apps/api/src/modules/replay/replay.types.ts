import type { EventSource, ReplayCategory } from '@prisma/client';

export interface NormalizedReplayEventInput {
  category: ReplayCategory;
  categoryWeight: number;
  eventType: string;
  source: EventSource;
  sourceEventId: string; // sourceTable:sourceId:eventType:subIndex
  timestamp: Date;
  actorName: string | null;
  actorEmail: string | null;
  title: string;
  description: string | null;
  externalUrl: string | null;
  evidenceId: string | null;
  metadata: Record<string, unknown> | null;
}
