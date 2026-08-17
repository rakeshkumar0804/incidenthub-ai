import type { Request, Response, NextFunction } from 'express';
import { OrganizationService } from './organization.service';
import { createOrganizationSchema, updateOrganizationSchema, deleteOrganizationSchema } from './organization.schema';
import { UnauthorizedError } from '../../utils/errors';

export class OrganizationController {
  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const input = createOrganizationSchema.parse(req.body);
      const result = await OrganizationService.createOrganization(req.user.id, input);

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
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const orgs = await OrganizationService.getUserOrganizations(req.user.id);

      res.status(200).json({
        success: true,
        data: orgs,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const orgId = req.params['organizationId'];
      if (!orgId) return;
      const details = await OrganizationService.getOrganizationDetails(orgId);

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
      const orgId = req.params['organizationId'];
      if (!orgId) return;
      const input = updateOrganizationSchema.parse(req.body);
      const updated = await OrganizationService.updateOrganization(orgId, input);

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
      const orgId = req.params['organizationId'];
      if (!orgId) return;
      const { confirmSlug } = deleteOrganizationSchema.parse(req.body);

      const result = await OrganizationService.deleteOrganization(orgId, req.user.id, confirmSlug);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
