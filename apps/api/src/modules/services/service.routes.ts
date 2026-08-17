import { Router } from 'express';
import { ServiceController } from './service.controller';
import { authenticate, requireAuth } from '../../middleware/auth';

const projectServicesRouter = Router({ mergeParams: true });
const rootServicesRouter = Router();

// GET /api/v1/projects/:projectId/services
projectServicesRouter.get(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void ServiceController.list(req, res, next);
  },
);

// POST /api/v1/projects/:projectId/services
projectServicesRouter.post(
  '/',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void ServiceController.create(req, res, next);
  },
);

// GET /api/v1/services/:serviceId
rootServicesRouter.get(
  '/:serviceId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void ServiceController.getById(req, res, next);
  },
);

// PATCH /api/v1/services/:serviceId
rootServicesRouter.patch(
  '/:serviceId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void ServiceController.update(req, res, next);
  },
);

// DELETE /api/v1/services/:serviceId
rootServicesRouter.delete(
  '/:serviceId',
  (req, res, next) => {
    void authenticate(req, res, next);
  },
  requireAuth,
  (req, res, next) => {
    void ServiceController.delete(req, res, next);
  },
);

export { projectServicesRouter, rootServicesRouter };
