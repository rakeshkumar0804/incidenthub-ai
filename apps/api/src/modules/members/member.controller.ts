import type { Request, Response, NextFunction } from 'express';
import { MemberService } from './member.service';
import { updateMemberRoleSchema } from './member.schema';
import { UnauthorizedError } from '../../utils/errors';

export class MemberController {
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      if (!orgId) return;
      const members = await MemberService.getMembers(orgId);

      res.status(200).json({
        success: true,
        data: members,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const orgId = req.params['organizationId'];
      const memberId = req.params['memberId'];
      if (!orgId || !memberId) return;

      const input = updateMemberRoleSchema.parse(req.body);
      const updated = await MemberService.updateMemberRole(orgId, memberId, req.user.id, input);

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      const memberId = req.params['memberId'];
      if (!orgId || !memberId) return;

      const result = await MemberService.removeMember(orgId, memberId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
