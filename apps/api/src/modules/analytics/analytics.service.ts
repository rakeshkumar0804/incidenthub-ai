import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import { logger } from '../../utils/logger';
import { NotFoundError, ValidationError } from '../../utils/errors';
import type {
  AnalyticsTimeWindow,
  KpiOverviewDto,
  TimeSeriesBucketDto,
  ServiceRankingDto,
  DeploymentCorrelationDto,
  EngineeringSignalDto,
  AnalyticsOverviewResponseDto,
} from '@incidenthub/shared';
import type { AnalyticsQueryInput } from './analytics.schema';

export const MTTD_DOCUMENTATION_LABEL =
  'Time from monitoring-source anomaly detection to IncidentHub incident creation.';

export async function invalidateAnalyticsCache(organizationId: string): Promise<void> {
  try {
    if (redis.status === 'ready' || redis.status === 'connecting') {
      const keys = await redis.keys(`cache:analytics:${organizationId}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.debug({ organizationId, count: keys.length }, 'Flushed analytics Redis cache keys');
      }
    }
  } catch (err) {
    logger.warn({ err, organizationId }, 'Failed to flush analytics Redis cache');
  }
}

export class AnalyticsService {
  public static calculateWindowBounds(
    window: AnalyticsTimeWindow = '30d',
    customStart?: string,
    customEnd?: string,
  ) {
    const now = new Date();
    let periodEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let periodStart: Date;
    let bucketSizeMs: number;

    if (window === 'custom' && customStart && customEnd) {
      periodStart = new Date(customStart);
      periodEnd = new Date(customEnd);
      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
        throw new ValidationError('Invalid custom startDate or endDate');
      }
      if (periodStart >= periodEnd) {
        throw new ValidationError('startDate must be before endDate');
      }
      const rangeDays = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 3600 * 24);
      if (rangeDays > 365) {
        throw new ValidationError('Maximum supported custom date range is 365 days');
      }
      bucketSizeMs = rangeDays <= 2 ? 3600 * 1000 : 24 * 3600 * 1000;
    } else if (window === '24h') {
      periodStart = new Date(periodEnd.getTime() - 24 * 3600 * 1000);
      bucketSizeMs = 3600 * 1000; // 1 hour buckets
    } else if (window === '7d') {
      periodStart = new Date(periodEnd.getTime() - 7 * 24 * 3600 * 1000);
      bucketSizeMs = 24 * 3600 * 1000; // 1 day buckets
    } else if (window === '90d') {
      periodStart = new Date(periodEnd.getTime() - 90 * 24 * 3600 * 1000);
      bucketSizeMs = 7 * 24 * 3600 * 1000; // 1 week buckets
    } else {
      // Default: 30d
      periodStart = new Date(periodEnd.getTime() - 30 * 24 * 3600 * 1000);
      bucketSizeMs = 24 * 3600 * 1000; // 1 day buckets
    }

    const durationMs = periodEnd.getTime() - periodStart.getTime();
    const prevPeriodStart = new Date(periodStart.getTime() - durationMs);
    const prevPeriodEnd = new Date(periodStart.getTime());

    return {
      window,
      periodStart,
      periodEnd,
      prevPeriodStart,
      prevPeriodEnd,
      bucketSizeMs,
    };
  }

  public static async getOverview(
    organizationId: string,
    query: Partial<AnalyticsQueryInput> = {},
  ): Promise<AnalyticsOverviewResponseDto> {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const bounds = this.calculateWindowBounds(query.window, query.startDate, query.endDate);
    const scopeHash = `${query.projectId || 'all'}:${query.serviceId || 'all'}`;
    const cacheKey = `cache:analytics:${organizationId}:${bounds.window}:${bounds.periodStart.toISOString()}:${bounds.periodEnd.toISOString()}:${scopeHash}`;

    if (query.refresh !== 'true') {
      try {
        if (redis.status === 'ready') {
          const cached = await redis.get(cacheKey);
          if (cached) {
            return JSON.parse(cached) as AnalyticsOverviewResponseDto;
          }
        }
      } catch {
        // Cache fallback
      }
    }

    // 1. Fetch Incidents in Half-Open Interval [periodStart, periodEnd)
    const incidentWhere = {
      organizationId,
      createdAt: {
        gte: bounds.periodStart,
        lt: bounds.periodEnd,
      },
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
    };

    const incidents = await prisma.incident.findMany({
      where: incidentWhere,
      include: {
        service: true,
        project: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // 2. Compute KPI Metrics
    const totalIncidents = incidents.length;
    let activeIncidents = 0;
    let resolvedIncidents = 0;
    let sev1Count = 0;
    let sev2Count = 0;
    let sev3Count = 0;
    let sev4Count = 0;
    let missingDataCount = 0;
    let anomalyCount = 0;

    const validTtdsMs: number[] = [];
    const validTtrsMs: number[] = [];

    for (const inc of incidents) {
      if (inc.status === 'RESOLVED') {
        resolvedIncidents++;
      } else {
        activeIncidents++;
      }

      if (inc.severity === 'SEV1') sev1Count++;
      else if (inc.severity === 'SEV2') sev2Count++;
      else if (inc.severity === 'SEV3') sev3Count++;
      else if (inc.severity === 'SEV4') sev4Count++;

      // MTTD Calculation (Option B: createdAt - detectedAt)
      if (!inc.detectedAt) {
        missingDataCount++;
      } else if (inc.detectedAt.getTime() > inc.createdAt.getTime()) {
        anomalyCount++;
      } else {
        const ttd = inc.createdAt.getTime() - inc.detectedAt.getTime();
        validTtdsMs.push(ttd);
      }

      // MTTR Calculation (resolvedAt - effectiveDetectionAt)
      const effectiveDetectionAt = inc.detectedAt ?? inc.createdAt;
      if (inc.status === 'RESOLVED' && inc.resolvedAt) {
        if (inc.resolvedAt.getTime() >= effectiveDetectionAt.getTime()) {
          const ttr = inc.resolvedAt.getTime() - effectiveDetectionAt.getTime();
          validTtrsMs.push(ttr);
        } else {
          anomalyCount++;
        }
      }
    }

    // MTTD Metric Status
    const mttd = validTtdsMs.length > 0
      ? {
          status: 'OK' as const,
          value: Math.round(validTtdsMs.reduce((a, b) => a + b, 0) / validTtdsMs.length),
          sampleCount: validTtdsMs.length,
        }
      : {
          status: totalIncidents === 0 ? ('NO_DATA' as const) : ('UNAVAILABLE' as const),
          value: null,
          sampleCount: 0,
          message: totalIncidents === 0 ? 'No incidents recorded in window' : 'Missing detectedAt timestamps',
        };

    // MTTR Metric Status
    const mttr = validTtrsMs.length > 0
      ? {
          status: 'OK' as const,
          value: Math.round(validTtrsMs.reduce((a, b) => a + b, 0) / validTtrsMs.length),
          sampleCount: validTtrsMs.length,
        }
      : {
          status: resolvedIncidents === 0 ? ('NO_RESOLVED_INCIDENTS' as const) : ('NO_DATA' as const),
          value: null,
          sampleCount: 0,
          message: resolvedIncidents === 0 ? 'No resolved incidents in window' : 'Insufficient resolution timestamps',
        };

    // 3. Fetch GitHub Deployments & Candidate Correlation
    const repos = await prisma.gitHubRepository.findMany({
      where: {
        organizationId,
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      },
      select: { id: true },
    });
    const repoIds = repos.map((r) => r.id);

    const deployments = repoIds.length > 0
      ? await prisma.gitHubDeployment.findMany({
          where: {
            repositoryId: { in: repoIds },
            createdAt: { gte: bounds.periodStart, lt: bounds.periodEnd },
          },
        })
      : [];

    // Deduplicate deployments by (repositoryId, commitSha, environment)
    const uniqueDeploymentMap = new Map<string, typeof deployments[0]>();
    deployments.forEach((d) => {
      const key = `${d.repositoryId}:${d.commitSha}:${d.environment}`;
      if (!uniqueDeploymentMap.has(key)) {
        uniqueDeploymentMap.set(key, d);
      }
    });
    const uniqueDeployments = Array.from(uniqueDeploymentMap.values());
    const totalDeployments = uniqueDeployments.length;

    // Check candidate deployment associations with incidents
    let associatedDeploymentsCount = 0;
    if (totalDeployments > 0 && incidents.length > 0) {
      const associatedSet = new Set<string>();
      for (const d of uniqueDeployments) {
        const dTime = d.createdAt.getTime();
        for (const inc of incidents) {
          const effectiveDet = (inc.detectedAt ?? inc.createdAt).getTime();
          // Candidate window: [effectiveDet - 2h, effectiveDet + 30m]
          if (dTime >= effectiveDet - 2 * 3600 * 1000 && dTime <= effectiveDet + 30 * 60 * 1000) {
            associatedSet.add(`${d.repositoryId}:${d.commitSha}:${d.environment}`);
            break;
          }
        }
      }
      associatedDeploymentsCount = associatedSet.size;
    }

    const cfr = totalDeployments > 0
      ? {
          status: 'OK' as const,
          value: Number(((associatedDeploymentsCount / totalDeployments) * 100).toFixed(2)),
          sampleCount: totalDeployments,
        }
      : {
          status: 'INSUFFICIENT_DATA' as const,
          value: null,
          sampleCount: 0,
          message: 'No deployments recorded in selected window',
        };

    const overview: KpiOverviewDto = {
      totalIncidents,
      activeIncidents,
      resolvedIncidents,
      sev1Count,
      sev2Count,
      sev3Count,
      sev4Count,
      mttd,
      mttr,
      cfr,
      totalDeployments,
      associatedDeploymentsCount,
      missingDataCount,
      anomalyCount,
      mttdDocumentationLabel: MTTD_DOCUMENTATION_LABEL,
    };

    // 4. Generate Time-Series Buckets
    const timeSeries: TimeSeriesBucketDto[] = [];
    let currentBucketStart = bounds.periodStart.getTime();

    while (currentBucketStart < bounds.periodEnd.getTime()) {
      const currentBucketEnd = Math.min(
        currentBucketStart + bounds.bucketSizeMs,
        bounds.periodEnd.getTime(),
      );
      const bStart = new Date(currentBucketStart);
      const bEnd = new Date(currentBucketEnd);

      const bucketIncidents = incidents.filter(
        (i) => i.createdAt.getTime() >= currentBucketStart && i.createdAt.getTime() < currentBucketEnd,
      );

      timeSeries.push({
        bucketStart: bStart.toISOString(),
        bucketEnd: bEnd.toISOString(),
        label: bounds.bucketSizeMs >= 24 * 3600 * 1000 ? bStart.toLocaleDateString() : bStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        count: bucketIncidents.length,
        sev1Count: bucketIncidents.filter((i) => i.severity === 'SEV1').length,
        sev2Count: bucketIncidents.filter((i) => i.severity === 'SEV2').length,
        sev3Count: bucketIncidents.filter((i) => i.severity === 'SEV3').length,
        sev4Count: bucketIncidents.filter((i) => i.severity === 'SEV4').length,
      });

      currentBucketStart = currentBucketEnd;
    }

    // 5. Engineering Intelligence Signals
    const signals: EngineeringSignalDto[] = [];

    // Service concentration signal
    const serviceIncCountMap = new Map<string, { name: string; count: number; ids: string[] }>();
    incidents.forEach((inc) => {
      if (inc.service) {
        const entry = serviceIncCountMap.get(inc.service.id) || { name: inc.service.name, count: 0, ids: [] };
        entry.count++;
        entry.ids.push(inc.id);
        serviceIncCountMap.set(inc.service.id, entry);
      }
    });

    serviceIncCountMap.forEach((entry, serviceId) => {
      if (entry.count >= 3) {
        signals.push({
          id: `signal-freq-${serviceId}`,
          type: 'HIGH_INCIDENT_FREQUENCY',
          severity: 'HIGH',
          title: `High Incident Frequency on ${entry.name}`,
          description: `Service ${entry.name} experienced ${entry.count} incidents within the selected window.`,
          entityId: serviceId,
          entityName: entry.name,
          provenance: { incidentIds: entry.ids.slice(0, 10) },
        });
      }
    });

    if (totalDeployments > 0 && cfr.value !== null && cfr.value > 30) {
      signals.push({
        id: 'signal-cfr-high',
        type: 'CHANGE_SENSITIVE_SERVICE',
        severity: 'MEDIUM',
        title: 'Elevated Candidate Rollout Correlation',
        description: `${cfr.value}% of rollouts in window are temporally associated with production incidents.`,
        entityId: null,
        entityName: null,
        provenance: { incidentIds: incidents.map((i) => i.id).slice(0, 10) },
      });
    }

    const responseData: AnalyticsOverviewResponseDto = {
      window: bounds.window,
      periodStart: bounds.periodStart.toISOString(),
      periodEnd: bounds.periodEnd.toISOString(),
      overview,
      timeSeries,
      signals,
    };

    // 6. Update Derived AnalyticsSnapshot Read-Model
    try {
      await prisma.analyticsSnapshot.upsert({
        where: {
          organizationId_timeWindow_periodStart_periodEnd: {
            organizationId,
            timeWindow: bounds.window,
            periodStart: bounds.periodStart,
            periodEnd: bounds.periodEnd,
          },
        },
        create: {
          organizationId,
          timeWindow: bounds.window,
          periodStart: bounds.periodStart,
          periodEnd: bounds.periodEnd,
          totalIncidents,
          sev1Count,
          sev2Count,
          sev3Count,
          sev4Count,
          mttdMs: mttd.value,
          mttrMs: mttr.value,
          cfrPercent: cfr.value,
          metricsJson: JSON.parse(JSON.stringify(responseData)) as Prisma.InputJsonValue,
        },
        update: {
          totalIncidents,
          sev1Count,
          sev2Count,
          sev3Count,
          sev4Count,
          mttdMs: mttd.value,
          mttrMs: mttr.value,
          cfrPercent: cfr.value,
          metricsJson: JSON.parse(JSON.stringify(responseData)) as Prisma.InputJsonValue,
          calculatedAt: new Date(),
        },
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to persist derived AnalyticsSnapshot read-model');
    }

    // Cache in Redis for 300s
    try {
      if (redis.status === 'ready') {
        await redis.set(cacheKey, JSON.stringify(responseData), 'EX', 300);
      }
    } catch {
      // Ignore
    }

    return responseData;
  }

  public static async getServiceMetrics(
    organizationId: string,
    query: Partial<AnalyticsQueryInput> = {},
  ): Promise<ServiceRankingDto[]> {
    const bounds = this.calculateWindowBounds(query.window, query.startDate, query.endDate);

    const services = await prisma.service.findMany({
      where: {
        project: { organizationId },
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.serviceId ? { id: query.serviceId } : {}),
      },
      include: {
        project: true,
        incidents: {
          where: {
            createdAt: { gte: bounds.periodStart, lt: bounds.periodEnd },
          },
        },
      },
    });

    const rankings: ServiceRankingDto[] = services.map((svc) => {
      const incs = svc.incidents;
      const totalIncidents = incs.length;
      const sev1Count = incs.filter((i) => i.severity === 'SEV1').length;

      const ttrs = incs
        .filter((i): i is typeof i & { resolvedAt: Date } => i.status === 'RESOLVED' && Boolean(i.resolvedAt))
        .map((i) => {
          const effDet = (i.detectedAt ?? i.createdAt).getTime();
          return i.resolvedAt.getTime() - effDet;
        })
        .filter((ttr) => ttr >= 0);

      const ttds = incs
        .filter((i): i is typeof i & { detectedAt: Date } => i.detectedAt !== null && i.detectedAt.getTime() <= i.createdAt.getTime())
        .map((i) => i.createdAt.getTime() - i.detectedAt.getTime());

      const mttrMs = ttrs.length > 0 ? Math.round(ttrs.reduce((a, b) => a + b, 0) / ttrs.length) : null;
      const mttdMs = ttds.length > 0 ? Math.round(ttds.reduce((a, b) => a + b, 0) / ttds.length) : null;

      return {
        serviceId: svc.id,
        serviceName: svc.name,
        projectId: svc.project.id,
        projectName: svc.project.name,
        totalIncidents,
        sev1Count,
        mttrMs,
        mttdMs,
        cfrPercent: null, // Computed at organization level
      };
    });

    // Deterministic 4-tier tie-breaking order:
    // 1. totalIncidents DESC
    // 2. sev1Count DESC
    // 3. mttrMs DESC
    // 4. serviceId ASC
    rankings.sort((a, b) => {
      if (b.totalIncidents !== a.totalIncidents) return b.totalIncidents - a.totalIncidents;
      if (b.sev1Count !== a.sev1Count) return b.sev1Count - a.sev1Count;
      const mttrA = a.mttrMs ?? 0;
      const mttrB = b.mttrMs ?? 0;
      if (mttrB !== mttrA) return mttrB - mttrA;
      return a.serviceId.localeCompare(b.serviceId);
    });

    // Persist derived ServiceReliabilityMetric records
    for (const item of rankings) {
      try {
        await prisma.serviceReliabilityMetric.upsert({
          where: {
            organizationId_serviceId_timeWindow_periodStart_periodEnd: {
              organizationId,
              serviceId: item.serviceId,
              timeWindow: bounds.window,
              periodStart: bounds.periodStart,
              periodEnd: bounds.periodEnd,
            },
          },
          create: {
            organizationId,
            serviceId: item.serviceId,
            timeWindow: bounds.window,
            periodStart: bounds.periodStart,
            periodEnd: bounds.periodEnd,
            totalIncidents: item.totalIncidents,
            sev1Count: item.sev1Count,
            mttrMs: item.mttrMs,
            mttdMs: item.mttdMs,
            cfrPercent: item.cfrPercent,
          },
          update: {
            totalIncidents: item.totalIncidents,
            sev1Count: item.sev1Count,
            mttrMs: item.mttrMs,
            mttdMs: item.mttdMs,
            cfrPercent: item.cfrPercent,
            calculatedAt: new Date(),
          },
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to persist derived ServiceReliabilityMetric read-model');
      }
    }

    return rankings;
  }

  public static async getDeploymentCorrelations(
    organizationId: string,
    query: Partial<AnalyticsQueryInput> = {},
  ): Promise<DeploymentCorrelationDto[]> {
    const bounds = this.calculateWindowBounds(query.window, query.startDate, query.endDate);

    const repos = await prisma.gitHubRepository.findMany({
      where: {
        organizationId,
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      },
      include: {
        deployments: {
          where: {
            createdAt: { gte: bounds.periodStart, lt: bounds.periodEnd },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const incidents = await prisma.incident.findMany({
      where: {
        organizationId,
        createdAt: { gte: new Date(bounds.periodStart.getTime() - 4 * 3600 * 1000), lt: new Date(bounds.periodEnd.getTime() + 4 * 3600 * 1000) },
      },
      select: {
        id: true,
        number: true,
        title: true,
        severity: true,
        status: true,
        detectedAt: true,
        createdAt: true,
        serviceId: true,
        projectId: true,
      },
    });

    const results: DeploymentCorrelationDto[] = [];

    for (const repo of repos) {
      for (const dep of repo.deployments) {
        const depTime = dep.createdAt.getTime();
        const candidateAssociatedIncidents = incidents
          .filter((inc) => {
            const effDet = (inc.detectedAt ?? inc.createdAt).getTime();
            // Candidate window: [effDet - 2h, effDet + 30m]
            return depTime >= effDet - 2 * 3600 * 1000 && depTime <= effDet + 30 * 60 * 1000;
          })
          .map((inc) => ({
            id: inc.id,
            number: inc.number,
            title: inc.title,
            severity: inc.severity,
            status: inc.status,
            detectedAt: (inc.detectedAt ?? inc.createdAt).toISOString(),
          }));

        results.push({
          deploymentId: dep.id,
          repositoryId: repo.id,
          repositoryName: repo.fullName,
          commitSha: dep.commitSha,
          environment: dep.environment,
          deployedAt: dep.createdAt.toISOString(),
          creator: dep.creator,
          candidateAssociatedIncidentsCount: candidateAssociatedIncidents.length,
          candidateAssociatedIncidents,
        });
      }
    }

    return results;
  }
}
