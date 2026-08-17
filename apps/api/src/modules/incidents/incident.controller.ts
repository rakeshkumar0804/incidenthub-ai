import type { Request, Response, NextFunction } from 'express';
import { IncidentService } from './incident.service';
import {
  createIncidentSchema,
  updateIncidentSchema,
  updateStatusSchema,
  updateSeveritySchema,
  updateAssigneeSchema,
  queryIncidentsSchema,
} from './incident.schema';
import { UnauthorizedError } from '../../utils/errors';
import type { ApiSuccess } from '@incidenthub/shared';

export class IncidentController {
  public static async createIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.orgMember?.organizationId;
      const userId = req.user?.id;
      if (!organizationId || !userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const input = createIncidentSchema.parse(req.body);
      const incident = await IncidentService.createIncident(organizationId, userId, input);

      const response: ApiSuccess<typeof incident> = {
        success: true,
        data: incident,
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async listIncidents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.orgMember?.organizationId;
      if (!organizationId) {
        throw new UnauthorizedError('Authentication required');
      }

      const query = queryIncidentsSchema.parse(req.query);
      const result = await IncidentService.listIncidents(organizationId, query);

      const response: ApiSuccess<typeof result.items> & { pagination: typeof result.pagination } = {
        success: true,
        data: result.items,
        pagination: result.pagination,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async getIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.orgMember?.organizationId;
      const incidentId = req.params['incidentId'];
      if (!organizationId || !incidentId) {
        throw new UnauthorizedError('Authentication required');
      }

      const incident = await IncidentService.getIncident(organizationId, incidentId);

      const response: ApiSuccess<typeof incident> = {
        success: true,
        data: incident,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async updateIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.orgMember?.organizationId;
      const incidentId = req.params['incidentId'];
      const userId = req.user?.id;
      if (!organizationId || !incidentId || !userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const input = updateIncidentSchema.parse(req.body);
      const incident = await IncidentService.updateIncident(organizationId, incidentId, userId, input);

      const response: ApiSuccess<typeof incident> = {
        success: true,
        data: incident,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.orgMember?.organizationId;
      const incidentId = req.params['incidentId'];
      const userId = req.user?.id;
      if (!organizationId || !incidentId || !userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const input = updateStatusSchema.parse(req.body);
      const incident = await IncidentService.updateStatus(organizationId, incidentId, userId, input);

      const response: ApiSuccess<typeof incident> = {
        success: true,
        data: incident,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async updateSeverity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.orgMember?.organizationId;
      const incidentId = req.params['incidentId'];
      const userId = req.user?.id;
      if (!organizationId || !incidentId || !userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const input = updateSeveritySchema.parse(req.body);
      const incident = await IncidentService.updateSeverity(organizationId, incidentId, userId, input);

      const response: ApiSuccess<typeof incident> = {
        success: true,
        data: incident,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async updateAssignee(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.orgMember?.organizationId;
      const incidentId = req.params['incidentId'];
      const userId = req.user?.id;
      if (!organizationId || !incidentId || !userId) {
        throw new UnauthorizedError('Authentication required');
      }

      const input = updateAssigneeSchema.parse(req.body);
      const incident = await IncidentService.updateAssignee(organizationId, incidentId, userId, input);

      const response: ApiSuccess<typeof incident> = {
        success: true,
        data: incident,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async getIncidentTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.orgMember?.organizationId;
      const incidentId = req.params['incidentId'];
      if (!organizationId || !incidentId) {
        throw new UnauthorizedError('Authentication required');
      }

      const events = await IncidentService.getIncidentTimeline(organizationId, incidentId);

      const response: ApiSuccess<typeof events> = {
        success: true,
        data: events,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  public static async getDashboardMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.orgMember?.organizationId;
      if (!organizationId) {
        throw new UnauthorizedError('Authentication required');
      }

      const metrics = await IncidentService.getDashboardMetrics(organizationId);

      const response: ApiSuccess<typeof metrics> = {
        success: true,
        data: metrics,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
}
