import { prisma } from '../../lib/prisma';
import { NotFoundError, ValidationError } from '../../utils/errors';
import {
  IncidentStatus,
  IncidentSeverity,
  EventSource,
  TimelineEventType,
  SEVERITY_LABELS,
  STATUS_LABELS,
  SocketEvent,
} from '@incidenthub/shared';
import { broadcastToIncident } from '../../lib/socket';
import { invalidateAnalyticsCache } from '../analytics/analytics.service';
import { SlackService } from '../integrations/slack/slack.service';
import type { IncidentDto, IncidentTimelineEventDto, PaginatedResponseData, IncidentEnvironment } from '@incidenthub/shared';
import type {
  CreateIncidentInput,
  UpdateIncidentInput,
  UpdateStatusInput,
  UpdateSeverityInput,
  UpdateAssigneeInput,
  QueryIncidentsInput,
} from './incident.schema';
import type { Prisma } from '@prisma/client';

export interface IncidentWithRelations {
  id: string;
  organizationId: string;
  projectId: string;
  serviceId: string | null;
  number: number;
  title: string;
  description: string | null;
  severity: string;
  status: string;
  environment: string;
  detectedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  createdById: string;
  assignedToId: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { id: string; name: string; email: string };
  assignee?: { id: string; name: string; email: string } | null;
  project?: { id: string; name: string; slug: string };
  service?: { id: string; name: string; slug: string } | null;
  events?: EventWithUser[];
}

export interface EventWithUser {
  id: string;
  incidentId: string;
  organizationId: string;
  userId: string | null;
  source: string;
  type: string;
  message: string;
  metadata: unknown;
  occurredAt: Date;
  user?: { id: string; name: string; email: string } | null;
}

export class IncidentService {
  /**
   * Formats raw incident number to user-facing string e.g. 1 -> "INC-0001"
   */
  public static formatIncidentNumber(num: number): string {
    return `INC-${String(num).padStart(4, '0')}`;
  }

  /**
   * Formats Prisma Incident model to IncidentDto
   */
  private static toDto(incident: IncidentWithRelations): IncidentDto {
    return {
      id: incident.id,
      organizationId: incident.organizationId,
      projectId: incident.projectId,
      serviceId: incident.serviceId || null,
      number: incident.number,
      incidentNumber: IncidentService.formatIncidentNumber(incident.number),
      title: incident.title,
      description: incident.description || null,
      severity: incident.severity as IncidentSeverity,
      status: incident.status as IncidentStatus,
      environment: incident.environment as unknown as IncidentEnvironment,
      detectedAt: incident.detectedAt.toISOString(),
      acknowledgedAt: incident.acknowledgedAt ? incident.acknowledgedAt.toISOString() : null,
      resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
      createdById: incident.createdById,
      assignedToId: incident.assignedToId || null,
      createdAt: incident.createdAt.toISOString(),
      updatedAt: incident.updatedAt.toISOString(),
      createdBy: incident.createdBy
        ? {
            id: incident.createdBy.id,
            name: incident.createdBy.name,
            email: incident.createdBy.email,
          }
        : undefined,
      assignee: incident.assignee
        ? {
            id: incident.assignee.id,
            name: incident.assignee.name,
            email: incident.assignee.email,
          }
        : null,
      project: incident.project
        ? {
            id: incident.project.id,
            name: incident.project.name,
            slug: incident.project.slug,
          }
        : undefined,
      service: incident.service
        ? {
            id: incident.service.id,
            name: incident.service.name,
            slug: incident.service.slug,
          }
        : null,
      events: incident.events ? incident.events.map((e) => IncidentService.toEventDto(e)) : undefined,
    };
  }

  private static toEventDto(event: EventWithUser): IncidentTimelineEventDto {
    return {
      id: event.id,
      incidentId: event.incidentId,
      organizationId: event.organizationId,
      userId: event.userId || null,
      source: event.source as EventSource,
      type: event.type,
      message: event.message,
      metadata: (event.metadata as Record<string, unknown>) || null,
      occurredAt: event.occurredAt.toISOString(),
      user: event.user
        ? {
            id: event.user.id,
            name: event.user.name,
            email: event.user.email,
          }
        : null,
    };
  }

  /**
   * Enforces valid lifecycle status transitions.
   */
  public static validateStatusTransition(currentStatus: IncidentStatus, newStatus: IncidentStatus): void {
    if (currentStatus === newStatus) return;

    const allowedTransitions: Record<IncidentStatus, IncidentStatus[]> = {
      [IncidentStatus.OPEN]: [IncidentStatus.INVESTIGATING, IncidentStatus.RESOLVED],
      [IncidentStatus.INVESTIGATING]: [IncidentStatus.MITIGATING, IncidentStatus.RESOLVED],
      [IncidentStatus.MITIGATING]: [IncidentStatus.RESOLVED],
      [IncidentStatus.RESOLVED]: [], // Terminal state
    };

    const allowed = allowedTransitions[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      throw new ValidationError(
        `Invalid status transition from ${STATUS_LABELS[currentStatus]} to ${STATUS_LABELS[newStatus]}. Allowed transitions: ${
          allowed.map((s) => STATUS_LABELS[s]).join(', ') || 'None (Terminal state)'
        }`,
      );
    }
  }

  /**
   * Create Incident (Atomic sequential numbering per organization & initial timeline event creation)
   */
  public static async createIncident(
    organizationId: string,
    createdById: string,
    input: CreateIncidentInput,
  ): Promise<IncidentDto> {
    // 1. Verify Project belongs to Organization
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
    });

    if (!project || project.organizationId !== organizationId) {
      throw new ValidationError('Selected project does not belong to this organization');
    }

    // 2. Verify Service belongs to Project if provided
    if (input.serviceId) {
      const service = await prisma.service.findUnique({
        where: { id: input.serviceId },
      });

      if (!service || service.projectId !== input.projectId) {
        throw new ValidationError('Selected service does not belong to the selected project');
      }
    }

    // 3. Verify Assignee belongs to Organization if provided
    if (input.assigneeId) {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: input.assigneeId,
          },
        },
      });

      if (!member) {
        throw new ValidationError('Assigned user is not a member of this organization');
      }
    }

    // 4. Atomic transaction with retry on unique constraint race conditions
    let attempts = 5;
    while (attempts > 0) {
      try {
        const incident = await prisma.$transaction(async (tx) => {
          // Find highest incident number in org
          const maxInc = await tx.incident.findFirst({
            where: { organizationId },
            orderBy: { number: 'desc' },
            select: { number: true },
          });

          const nextNumber = (maxInc?.number || 0) + 1;

          const created = await tx.incident.create({
            data: {
              organizationId,
              projectId: input.projectId,
              serviceId: input.serviceId || null,
              number: nextNumber,
              title: input.title,
              description: input.description || null,
              severity: input.severity || IncidentSeverity.SEV3,
              status: IncidentStatus.OPEN,
              environment: input.environment || 'PRODUCTION',
              createdById,
              assignedToId: input.assigneeId || null,
            },
            include: {
              createdBy: true,
              assignee: true,
              project: true,
              service: true,
            },
          });

          // Create initial timeline event
          const incNumFormatted = IncidentService.formatIncidentNumber(nextNumber);
          await tx.incidentEvent.create({
            data: {
              incidentId: created.id,
              organizationId,
              userId: createdById,
              source: EventSource.USER,
              type: TimelineEventType.INCIDENT_CREATED,
              message: `Incident ${incNumFormatted} declared: "${input.title}" (${SEVERITY_LABELS[created.severity as IncidentSeverity]})`,
              metadata: {
                severity: created.severity,
                environment: created.environment,
                projectId: created.projectId,
                serviceId: created.serviceId,
              },
            },
          });

          return created;
        });

        void invalidateAnalyticsCache(organizationId);
        const dto = IncidentService.toDto(incident);
        void SlackService.sendNotification(organizationId, 'INCIDENT_CREATED', {
          id: dto.id,
          number: dto.number,
          title: dto.title,
          severity: dto.severity,
          status: dto.status,
          environment: dto.environment,
        });
        return dto;
      } catch (err: unknown) {
        attempts--;
        if (
          attempts > 0 &&
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
    }

    throw new Error('Failed to generate incident number due to concurrency');
  }

  /**
   * Get Incident by ID (Enforces Organization tenant isolation)
   */
  public static async getIncident(organizationId: string, incidentId: string): Promise<IncidentDto> {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        createdBy: true,
        assignee: true,
        project: true,
        service: true,
        events: {
          include: {
            user: true,
          },
          orderBy: { occurredAt: 'asc' },
        },
      },
    });

    if (!incident || incident.organizationId !== organizationId) {
      throw new NotFoundError('Incident not found');
    }

    return IncidentService.toDto(incident);
  }

  /**
   * List Incidents for Organization (paginated, filtered, searched)
   */
  public static async listIncidents(
    organizationId: string,
    query: QueryIncidentsInput,
  ): Promise<PaginatedResponseData<IncidentDto>> {
    const where: Prisma.IncidentWhereInput = {
      organizationId,
    };

    if (query.status) {
      where.status = query.status;
    }
    if (query.severity) {
      where.severity = query.severity;
    }
    if (query.environment) {
      where.environment = query.environment;
    }
    if (query.projectId) {
      where.projectId = query.projectId;
    }
    if (query.serviceId) {
      where.serviceId = query.serviceId;
    }
    if (query.assigneeId) {
      where.assignedToId = query.assigneeId;
    }

    if (query.search && query.search.trim() !== '') {
      const searchTerm = query.search.trim();
      const numMatch = searchTerm.match(/INC-?(\d+)/i);

      if (numMatch && numMatch[1]) {
        where.number = parseInt(numMatch[1], 10);
      } else {
        where.OR = [
          { title: { contains: searchTerm, mode: 'insensitive' } },
          { description: { contains: searchTerm, mode: 'insensitive' } },
        ];
      }
    }

    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;

    const orderBy: Prisma.IncidentOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

    const [totalItems, items] = await Promise.all([
      prisma.incident.count({ where }),
      prisma.incident.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          createdBy: true,
          assignee: true,
          project: true,
          service: true,
        },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / query.pageSize) || 1;

    return {
      items: items.map((item) => IncidentService.toDto(item)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  /**
   * Update Incident Details (title, description, environment)
   */
  public static async updateIncident(
    organizationId: string,
    incidentId: string,
    userId: string,
    input: UpdateIncidentInput,
  ): Promise<IncidentDto> {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident || incident.organizationId !== organizationId) {
      throw new NotFoundError('Incident not found');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const data: Prisma.IncidentUpdateInput = {};
      const changes: string[] = [];

      if (input.title && input.title !== incident.title) {
        data.title = input.title;
        changes.push(`title changed to "${input.title}"`);
      }

      if (input.description !== undefined && input.description !== incident.description) {
        data.description = input.description;
        changes.push('description updated');
      }

      if (input.environment && (input.environment as string) !== (incident.environment as string)) {
        data.environment = input.environment;
        changes.push(`environment changed to ${input.environment}`);
      }

      if (Object.keys(data).length === 0) {
        return tx.incident.findUniqueOrThrow({
          where: { id: incidentId },
          include: { createdBy: true, assignee: true, project: true, service: true },
        });
      }

      const res = await tx.incident.update({
        where: { id: incidentId },
        data,
        include: {
          createdBy: true,
          assignee: true,
          project: true,
          service: true,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          organizationId,
          userId,
          source: EventSource.USER,
          type: TimelineEventType.DESCRIPTION_UPDATED,
          message: `Incident details updated: ${changes.join(', ')}`,
          metadata: { changes },
        },
      });

      return res;
    });

    const dto = IncidentService.toDto(updated);
    broadcastToIncident(incidentId, SocketEvent.INCIDENT_UPDATED, dto);
    return dto;
  }

  /**
   * Update Incident Lifecycle Status & Timestamps
   */
  public static async updateStatus(
    organizationId: string,
    incidentId: string,
    userId: string,
    input: UpdateStatusInput,
  ): Promise<IncidentDto> {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident || incident.organizationId !== organizationId) {
      throw new NotFoundError('Incident not found');
    }

    const currentStatus = incident.status as IncidentStatus;
    const newStatus = input.status;

    // Validate lifecycle transition
    IncidentService.validateStatusTransition(currentStatus, newStatus);

    if (currentStatus === newStatus) {
      return IncidentService.toDto(await prisma.incident.findUniqueOrThrow({
        where: { id: incidentId },
        include: { createdBy: true, assignee: true, project: true, service: true },
      }));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const data: Prisma.IncidentUpdateInput = {
        status: newStatus,
      };

      // Auto-maintain timestamps
      if (
        (newStatus === IncidentStatus.INVESTIGATING || newStatus === IncidentStatus.MITIGATING) &&
        !incident.acknowledgedAt
      ) {
        data.acknowledgedAt = new Date();
      }

      if (newStatus === IncidentStatus.RESOLVED) {
        data.resolvedAt = new Date();
      }

      const res = await tx.incident.update({
        where: { id: incidentId },
        data,
        include: {
          createdBy: true,
          assignee: true,
          project: true,
          service: true,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          organizationId,
          userId,
          source: EventSource.USER,
          type: TimelineEventType.STATUS_CHANGED,
          message: `Status changed from ${STATUS_LABELS[currentStatus]} to ${STATUS_LABELS[newStatus]}`,
          metadata: {
            previousStatus: currentStatus,
            newStatus,
          },
        },
      });

      return res;
    });

    const dto = IncidentService.toDto(updated);
    broadcastToIncident(incidentId, SocketEvent.INCIDENT_UPDATED, dto);
    void invalidateAnalyticsCache(organizationId);
    void SlackService.sendNotification(
      organizationId,
      newStatus === IncidentStatus.RESOLVED ? 'INCIDENT_RESOLVED' : 'STATUS_CHANGED',
      {
        id: dto.id,
        number: dto.number,
        title: dto.title,
        severity: dto.severity,
        status: dto.status,
        environment: dto.environment,
      },
    );
    return dto;
  }

  /**
   * Update Incident Severity Level
   */
  public static async updateSeverity(
    organizationId: string,
    incidentId: string,
    userId: string,
    input: UpdateSeverityInput,
  ): Promise<IncidentDto> {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident || incident.organizationId !== organizationId) {
      throw new NotFoundError('Incident not found');
    }

    const currentSeverity = incident.severity as IncidentSeverity;
    const newSeverity = input.severity;

    if (currentSeverity === newSeverity) {
      return IncidentService.toDto(await prisma.incident.findUniqueOrThrow({
        where: { id: incidentId },
        include: { createdBy: true, assignee: true, project: true, service: true },
      }));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.incident.update({
        where: { id: incidentId },
        data: { severity: newSeverity },
        include: {
          createdBy: true,
          assignee: true,
          project: true,
          service: true,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          organizationId,
          userId,
          source: EventSource.USER,
          type: TimelineEventType.SEVERITY_CHANGED,
          message: `Severity level changed from ${SEVERITY_LABELS[currentSeverity]} to ${SEVERITY_LABELS[newSeverity]}`,
          metadata: {
            previousSeverity: currentSeverity,
            newSeverity,
          },
        },
      });

      return res;
    });

    const dto = IncidentService.toDto(updated);
    broadcastToIncident(incidentId, SocketEvent.INCIDENT_UPDATED, dto);
    void invalidateAnalyticsCache(organizationId);
    void SlackService.sendNotification(organizationId, 'SEVERITY_CHANGED', {
      id: dto.id,
      number: dto.number,
      title: dto.title,
      severity: dto.severity,
      status: dto.status,
      environment: dto.environment,
    });
    return dto;
  }

  /**
   * Assign or Reassign Incident
   */
  public static async updateAssignee(
    organizationId: string,
    incidentId: string,
    userId: string,
    input: UpdateAssigneeInput,
  ): Promise<IncidentDto> {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { assignee: true },
    });

    if (!incident || incident.organizationId !== organizationId) {
      throw new NotFoundError('Incident not found');
    }

    // Verify Assignee belongs to Organization if provided
    let newAssigneeName = 'Unassigned';
    if (input.assigneeId) {
      const member = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: input.assigneeId,
          },
        },
        include: { user: true },
      });
      if (!member) {
        throw new ValidationError('Assigned user is not a member of this organization');
      }
      newAssigneeName = member.user.name;
    }

    const previousAssigneeId = incident.assignedToId;
    const previousAssigneeName = incident.assignee?.name || 'Unassigned';

    if (previousAssigneeId === input.assigneeId) {
      return IncidentService.toDto(await prisma.incident.findUniqueOrThrow({
        where: { id: incidentId },
        include: { createdBy: true, assignee: true, project: true, service: true },
      }));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.incident.update({
        where: { id: incidentId },
        data: { assignedToId: input.assigneeId },
        include: {
          createdBy: true,
          assignee: true,
          project: true,
          service: true,
        },
      });

      const msg = input.assigneeId
        ? `Incident assigned to ${newAssigneeName}`
        : `Incident unassigned (previously ${previousAssigneeName})`;

      await tx.incidentEvent.create({
        data: {
          incidentId,
          organizationId,
          userId,
          source: EventSource.USER,
          type: TimelineEventType.ASSIGNEE_CHANGED,
          message: msg,
          metadata: {
            previousAssigneeId,
            newAssigneeId: input.assigneeId,
          },
        },
      });

      return res;
    });

    const dto = IncidentService.toDto(updated);
    broadcastToIncident(incidentId, SocketEvent.INCIDENT_UPDATED, dto);
    return dto;
  }

  /**
   * Get Timeline Events for Incident
   */
  public static async getIncidentTimeline(
    organizationId: string,
    incidentId: string,
  ): Promise<IncidentTimelineEventDto[]> {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
    });

    if (!incident || incident.organizationId !== organizationId) {
      throw new NotFoundError('Incident not found');
    }

    const events = await prisma.incidentEvent.findMany({
      where: {
        incidentId,
        organizationId,
      },
      orderBy: { occurredAt: 'asc' },
      include: { user: true },
    });

    return events.map((event) => IncidentService.toEventDto(event));
  }

  /**
   * Get Basic Incident Dashboard Metrics
   */
  public static async getDashboardMetrics(organizationId: string): Promise<{
    openCount: number;
    criticalCount: number;
    investigatingCount: number;
    resolvedThisMonthCount: number;
  }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [openCount, criticalCount, investigatingCount, resolvedThisMonthCount] = await Promise.all([
      prisma.incident.count({
        where: { organizationId, status: { in: [IncidentStatus.OPEN, IncidentStatus.INVESTIGATING, IncidentStatus.MITIGATING] } },
      }),
      prisma.incident.count({
        where: {
          organizationId,
          severity: IncidentSeverity.SEV1,
          status: { in: [IncidentStatus.OPEN, IncidentStatus.INVESTIGATING, IncidentStatus.MITIGATING] },
        },
      }),
      prisma.incident.count({
        where: { organizationId, status: IncidentStatus.INVESTIGATING },
      }),
      prisma.incident.count({
        where: {
          organizationId,
          status: IncidentStatus.RESOLVED,
          resolvedAt: { gte: startOfMonth },
        },
      }),
    ]);

    return {
      openCount,
      criticalCount,
      investigatingCount,
      resolvedThisMonthCount,
    };
  }
}
