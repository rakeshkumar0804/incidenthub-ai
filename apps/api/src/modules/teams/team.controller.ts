import type { Request, Response, NextFunction } from 'express';
import { TeamService } from './team.service';
import { createTeamSchema, updateTeamSchema, addTeamMemberSchema } from './team.schema';
import { UnauthorizedError } from '../../utils/errors';

export class TeamController {
  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      if (!orgId) return;
      const input = createTeamSchema.parse(req.body);

      const team = await TeamService.createTeam(orgId, input);

      res.status(201).json({
        success: true,
        data: team,
      });
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      if (!orgId) return;

      const teams = await TeamService.getTeams(orgId);

      res.status(200).json({
        success: true,
        data: teams,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const teamId = req.params['teamId'];
      if (!teamId) return;

      const details = await TeamService.getTeamDetails(teamId, req.user.id);

      res.status(200).json({
        success: true,
        data: details,
      });
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const teamId = req.params['teamId'];
      if (!teamId) return;

      const input = updateTeamSchema.parse(req.body);
      const updated = await TeamService.updateTeam(teamId, req.user.id, input);

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const teamId = req.params['teamId'];
      if (!teamId) return;

      const result = await TeamService.deleteTeam(teamId, req.user.id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async addMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const teamId = req.params['teamId'];
      if (!teamId) return;

      const { userId } = addTeamMemberSchema.parse(req.body);
      const result = await TeamService.addTeamMember(teamId, userId, req.user.id);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async removeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const teamId = req.params['teamId'];
      const targetUserId = req.params['userId'];
      if (!teamId || !targetUserId) return;

      const result = await TeamService.removeTeamMember(teamId, targetUserId, req.user.id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
