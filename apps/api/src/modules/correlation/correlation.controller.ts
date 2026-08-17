import type { Request, Response, NextFunction } from 'express';
import { CorrelationService } from './correlation.service';
import { triggerCorrelationSchema, updateEvidenceStatusSchema } from './correlation.schema';
import { ValidationError, UnauthorizedError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import type { ApiSuccess } from '@incidenthub/shared';

export class CorrelationController {
  public static async triggerCorrelation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId } = req.params;
      if (!organizationId || !incidentId) throw new ValidationError('Missing organizationId or incidentId');
      if (!req.user) throw new UnauthorizedError('Authentication required');

      const body = (req.body as Record<string, unknown> | undefined) ?? {};
      const parseResult = triggerCorrelationSchema.safeParse(body);
      if (!parseResult.success) throw new ValidationError('Invalid request body');

      const t0 = Date.now();
      logger.info({ organizationId, incidentId, userId: req.user.id }, '[CORRELATION] triggerCorrelation → service entered');

      const result = await CorrelationService.runCorrelation(
        organizationId,
        incidentId,
        req.user.id,
        parseResult.data.triggerType,
      );

      logger.info(
        { organizationId, incidentId, userId: req.user.id, status: result.status, correlatedCount: result.correlatedCount, durationMs: Date.now() - t0 },
        '[CORRELATION] triggerCorrelation → completed',
      );

      const response: ApiSuccess<typeof result> = {
        success: true,
        data: result,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async getCorrelationEvidence(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId } = req.params;
      if (!organizationId || !incidentId) throw new ValidationError('Missing organizationId or incidentId');

      const data = await CorrelationService.getCorrelationEvidence(organizationId, incidentId);
      const response: ApiSuccess<typeof data> = {
        success: true,
        data,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async getCorrelationRuns(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId } = req.params;
      if (!organizationId || !incidentId) throw new ValidationError('Missing organizationId or incidentId');

      const data = await CorrelationService.getCorrelationRuns(organizationId, incidentId);
      const response: ApiSuccess<typeof data> = {
        success: true,
        data,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async updateEvidenceStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId, evidenceId } = req.params;
      if (!organizationId || !incidentId || !evidenceId) throw new ValidationError('Missing required parameter');
      if (!req.user) throw new UnauthorizedError('Authentication required');

      const body = (req.body as Record<string, unknown> | undefined) ?? {};
      const parseResult = updateEvidenceStatusSchema.safeParse(body);
      if (!parseResult.success) throw new ValidationError('Invalid action input');

      const updated = await CorrelationService.updateEvidenceStatus(
        organizationId,
        incidentId,
        evidenceId,
        parseResult.data.action,
        req.user.id,
      );

      const response: ApiSuccess<typeof updated> = {
        success: true,
        data: updated,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}
