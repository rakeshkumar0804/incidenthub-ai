import type { Request, Response, NextFunction } from 'express';
import { ServiceService } from './service.service';
import { createServiceSchema, updateServiceSchema } from './service.schema';
import { UnauthorizedError } from '../../utils/errors';

export class ServiceController {
  static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const projectId = req.params['projectId'];
      if (!projectId) return;

      const input = createServiceSchema.parse(req.body);
      const service = await ServiceService.createService(projectId, req.user.id, input);

      res.status(201).json({
        success: true,
        data: service,
      });
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const projectId = req.params['projectId'];
      if (!projectId) return;

      const services = await ServiceService.getServices(projectId, req.user.id);

      res.status(200).json({
        success: true,
        data: services,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const serviceId = req.params['serviceId'];
      if (!serviceId) return;

      const details = await ServiceService.getServiceDetails(serviceId, req.user.id);

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
      const serviceId = req.params['serviceId'];
      if (!serviceId) return;

      const input = updateServiceSchema.parse(req.body);
      const updated = await ServiceService.updateService(serviceId, req.user.id, input);

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
      const serviceId = req.params['serviceId'];
      if (!serviceId) return;

      const result = await ServiceService.deleteService(serviceId, req.user.id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
