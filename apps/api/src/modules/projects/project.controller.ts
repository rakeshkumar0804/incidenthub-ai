import type { Request, Response, NextFunction } from 'express';
import { ProjectService } from './project.service';
import { createProjectSchema, updateProjectSchema } from './project.schema';
import { ProjectStatus } from '@incidenthub/shared';
import { UnauthorizedError } from '../../utils/errors';

export class ProjectController {
  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      if (!orgId) return;
      const input = createProjectSchema.parse(req.body);

      const project = await ProjectService.createProject(orgId, input);

      res.status(201).json({
        success: true,
        data: project,
      });
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      if (!orgId) return;
      const statusStr = req.query['status'] as string | undefined;
      const statusFilter = statusStr && Object.values(ProjectStatus).includes(statusStr as ProjectStatus)
        ? (statusStr as ProjectStatus)
        : undefined;

      const projects = await ProjectService.getProjects(orgId, statusFilter);

      res.status(200).json({
        success: true,
        data: projects,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const projectId = req.params['projectId'];
      if (!projectId) return;

      const details = await ProjectService.getProjectDetails(projectId, req.user.id);

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
      const projectId = req.params['projectId'];
      if (!projectId) return;

      const input = updateProjectSchema.parse(req.body);
      const updated = await ProjectService.updateProject(projectId, req.user.id, input);

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
      const projectId = req.params['projectId'];
      if (!projectId) return;

      const result = await ProjectService.deleteProject(projectId, req.user.id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
