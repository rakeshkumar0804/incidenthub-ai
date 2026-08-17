import type { AnalyticsTimeWindow } from '@incidenthub/shared';

export interface TimeWindowBounds {
  window: AnalyticsTimeWindow;
  periodStart: Date;
  periodEnd: Date;
  prevPeriodStart: Date;
  prevPeriodEnd: Date;
  bucketSizeMs: number;
}
