import type { Request, Response, NextFunction } from 'express';
import { InvitationService } from './invitation.service';
import { createInvitationSchema, acceptInvitationSchema } from './invitation.schema';
import { UnauthorizedError } from '../../utils/errors';

export class InvitationController {
  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const orgId = req.params['organizationId'];
      if (!orgId) return;

      const input = createInvitationSchema.parse(req.body);
      const result = await InvitationService.createInvitation(orgId, req.user.id, input);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      if (!orgId) return;

      const invitations = await InvitationService.getInvitations(orgId);

      res.status(200).json({
        success: true,
        data: invitations,
      });
    } catch (error) {
      next(error);
    }
  }

  static async accept(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const tokenParam = req.params['token'];
      const bodyObj = req.body as Record<string, unknown> | undefined;
      const bodyToken = typeof bodyObj?.['token'] === 'string' ? bodyObj['token'] : undefined;
      const tokenStr = tokenParam || bodyToken || '';

      const { token: validatedToken } = acceptInvitationSchema.parse({ token: tokenStr });
      const acceptingUserId = req.user?.id;

      const result = await InvitationService.acceptInvitation(validatedToken, acceptingUserId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async resend(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      const invitationId = req.params['invitationId'];
      if (!orgId || !invitationId) return;

      const result = await InvitationService.resendInvitation(orgId, invitationId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getDevUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      const invitationId = req.params['invitationId'];
      if (!orgId || !invitationId) return;

      const result = await InvitationService.getDevInvitationUrl(orgId, invitationId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async revoke(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      const invitationId = req.params['invitationId'];
      if (!orgId || !invitationId) return;

      const result = await InvitationService.revokeInvitation(orgId, invitationId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
