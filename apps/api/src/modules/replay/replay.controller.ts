import type { Request, Response, NextFunction } from 'express';
import { ReplayService } from './replay.service';
import { triggerReplaySchema } from './replay.schema';
import { ValidationError } from '../../utils/errors';
import type { ReplayTriggerType } from '@prisma/client';

export class ReplayController {
  public static triggerReplay = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;

      if (!organizationId || !incidentId) {
        throw new ValidationError('Organization ID and Incident ID are required');
      }

      const parseResult = triggerReplaySchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid trigger input');
      }

      const triggerType: ReplayTriggerType = parseResult.data.triggerType;
      const result = await ReplayService.runReplay(
        organizationId,
        incidentId,
        req.user?.id,
        triggerType,
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getLatestReplay = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;

      if (!organizationId || !incidentId) {
        throw new ValidationError('Organization ID and Incident ID are required');
      }

      const result = await ReplayService.getLatestReplay(organizationId, incidentId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  public static getReplayRuns = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;

      if (!organizationId || !incidentId) {
        throw new ValidationError('Organization ID and Incident ID are required');
      }

      const runs = await ReplayService.getReplayRuns(organizationId, incidentId);

      res.status(200).json({
        success: true,
        data: runs,
      });
    } catch (error) {
      next(error);
    }
  };
}
