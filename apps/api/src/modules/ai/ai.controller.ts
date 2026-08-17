import type { Request, Response, NextFunction } from 'express';
import { AIService } from './ai.service';
import { triggerInvestigationSchema } from './ai.schema';
import { ValidationError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import type { InvestigationTriggerType } from '@prisma/client';

export class AIController {
  public static triggerInvestigation = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;

      if (!organizationId || !incidentId) {
        throw new ValidationError('Organization ID and Incident ID are required');
      }

      const parseResult = triggerInvestigationSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid trigger input');
      }

      const triggerType: InvestigationTriggerType = parseResult.data.triggerType;
      const t0 = Date.now();
      logger.info({ organizationId, incidentId, userId: req.user?.id }, '[AI-INVESTIGATION] triggerInvestigation → service entered');

      const result = await AIService.runInvestigation(
        organizationId,
        incidentId,
        req.user?.id,
        triggerType,
      );

      logger.info(
        { organizationId, incidentId, userId: req.user?.id, status: result.status, durationMs: Date.now() - t0 },
        '[AI-INVESTIGATION] triggerInvestigation → completed',
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getLatestInvestigation = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;

      if (!organizationId || !incidentId) {
        throw new ValidationError('Organization ID and Incident ID are required');
      }

      const result = await AIService.getLatestInvestigation(organizationId, incidentId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getInvestigationRuns = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;

      if (!organizationId || !incidentId) {
        throw new ValidationError('Organization ID and Incident ID are required');
      }

      const runs = await AIService.getInvestigationRuns(organizationId, incidentId);

      res.status(200).json({
        success: true,
        data: runs,
      });
    } catch (error) {
      next(error);
    }
  };
}
