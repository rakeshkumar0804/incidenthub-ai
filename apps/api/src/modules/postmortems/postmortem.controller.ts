import type { Request, Response, NextFunction } from 'express';
import { PostmortemService } from './postmortem.service';
import {
  generatePostmortemSchema,
  updatePostmortemSchema,
  createActionItemSchema,
  updateActionItemSchema,
} from './postmortem.schema';
import { ValidationError } from '../../utils/errors';
import type { PostmortemTriggerType } from '@prisma/client';

export class PostmortemController {
  public static generatePostmortem = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;
      if (!organizationId || !incidentId) {
        throw new ValidationError('Organization ID and Incident ID are required');
      }

      const parseResult = generatePostmortemSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid generate input');
      }

      const triggerType: PostmortemTriggerType = parseResult.data.triggerType;
      const result = await PostmortemService.generatePostmortem(
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

  public static getPostmortem = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;
      if (!organizationId || !incidentId) {
        throw new ValidationError('Organization ID and Incident ID are required');
      }

      const result = await PostmortemService.getPostmortem(organizationId, incidentId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  public static updatePostmortem = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;
      if (!organizationId || !incidentId || !req.user?.id) {
        throw new ValidationError('Organization ID, Incident ID, and User ID are required');
      }

      const parseResult = updatePostmortemSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid update payload');
      }

      const version = await PostmortemService.updatePostmortemVersion(
        organizationId,
        incidentId,
        parseResult.data,
        req.user.id,
      );

      res.status(200).json({
        success: true,
        data: version,
      });
    } catch (error) {
      next(error);
    }
  };

  public static createActionItem = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;
      if (!organizationId || !incidentId || !req.user?.id) {
        throw new ValidationError('Organization ID, Incident ID, and User ID are required');
      }

      const parseResult = createActionItemSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid action item payload');
      }

      const item = await PostmortemService.createActionItem(
        organizationId,
        incidentId,
        parseResult.data,
        req.user.id,
      );

      res.status(201).json({
        success: true,
        data: item,
      });
    } catch (error) {
      next(error);
    }
  };

  public static updateActionItem = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { organizationId, actionItemId } = req.params;
      if (!organizationId || !actionItemId) {
        throw new ValidationError('Organization ID and Action Item ID are required');
      }

      const parseResult = updateActionItemSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid action item payload');
      }

      const updated = await PostmortemService.updateActionItem(
        organizationId,
        actionItemId,
        parseResult.data,
      );

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  };
}
