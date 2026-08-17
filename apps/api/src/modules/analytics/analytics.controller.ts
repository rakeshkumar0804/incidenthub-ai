import type { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from './analytics.service';
import { analyticsQuerySchema, analyticsDrilldownQuerySchema } from './analytics.schema';
import { ValidationError } from '../../utils/errors';

export class AnalyticsController {
  public static getOverview = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId } = req.params;
      if (!organizationId) {
        throw new ValidationError('Organization ID is required');
      }

      const parseResult = analyticsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid analytics query');
      }

      const data = await AnalyticsService.getOverview(organizationId, parseResult.data);

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getServices = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId } = req.params;
      if (!organizationId) {
        throw new ValidationError('Organization ID is required');
      }

      const parseResult = analyticsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid analytics query');
      }

      const data = await AnalyticsService.getServiceMetrics(organizationId, parseResult.data);

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getDeployments = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId } = req.params;
      if (!organizationId) {
        throw new ValidationError('Organization ID is required');
      }

      const parseResult = analyticsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid analytics query');
      }

      const data = await AnalyticsService.getDeploymentCorrelations(organizationId, parseResult.data);

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getSignals = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId } = req.params;
      if (!organizationId) {
        throw new ValidationError('Organization ID is required');
      }

      const parseResult = analyticsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid analytics query');
      }

      const overview = await AnalyticsService.getOverview(organizationId, parseResult.data);

      res.status(200).json({
        success: true,
        data: overview.signals,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getDrilldown = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId } = req.params;
      if (!organizationId) {
        throw new ValidationError('Organization ID is required');
      }

      const parseResult = analyticsDrilldownQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid drilldown query');
      }

      const overview = await AnalyticsService.getOverview(organizationId, {
        window: parseResult.data.window,
        startDate: parseResult.data.startDate,
        endDate: parseResult.data.endDate,
        refresh: parseResult.data.refresh,
      });
      const incidentIds = overview.signals.flatMap((s) => s.provenance.incidentIds);

      res.status(200).json({
        success: true,
        data: {
          metric: parseResult.data.metric,
          totalCount: incidentIds.length,
          incidentIds,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
