import type { Request, Response, NextFunction } from 'express';
import { CommentService } from './comment.service';
import { createCommentSchema, updateCommentSchema } from './comment.schema';
import { ValidationError, UnauthorizedError, ForbiddenError } from '../../utils/errors';
import type { ApiSuccess } from '@incidenthub/shared';

export class CommentController {
  public static async getComments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId } = req.params;
      const comments = await CommentService.getComments(organizationId, incidentId);

      const response: ApiSuccess<typeof comments> = {
        success: true,
        data: comments,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async createComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId } = req.params;
      if (!req.user) {
        throw new UnauthorizedError('User authentication required');
      }
      const userId = req.user.id;

      const parseResult = createCommentSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid comment input');
      }

      const comment = await CommentService.createComment(
        organizationId,
        incidentId,
        userId,
        parseResult.data,
      );

      const response: ApiSuccess<typeof comment> = {
        success: true,
        data: comment,
      };

      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async updateComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId, commentId } = req.params;
      if (!req.user) {
        throw new UnauthorizedError('User authentication required');
      }
      const userId = req.user.id;

      const parseResult = updateCommentSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid comment input');
      }

      const comment = await CommentService.updateComment(
        organizationId,
        incidentId,
        commentId,
        userId,
        parseResult.data,
      );

      const response: ApiSuccess<typeof comment> = {
        success: true,
        data: comment,
      };

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async deleteComment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId, commentId } = req.params;
      if (!req.user) {
        throw new UnauthorizedError('User authentication required');
      }
      if (!req.orgMember) {
        throw new ForbiddenError('Organization member context required');
      }

      const userId = req.user.id;
      const userRole = req.orgMember.role;

      await CommentService.deleteComment(organizationId, incidentId, commentId, userId, userRole);

      res.status(200).json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  }
}
