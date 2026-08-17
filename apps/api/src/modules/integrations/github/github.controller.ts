import type { Request, Response, NextFunction } from 'express';
import { GitHubService } from './github.service';
import {
  connectGitHubAppSchema,
  connectGitHubPatSchema,
  linkRepoSchema,
  linkIncidentActivitySchema,
} from './github.schema';
import { ValidationError, UnauthorizedError } from '../../../utils/errors';
import type { ApiSuccess } from '@incidenthub/shared';

export class GitHubController {
  public static async getIntegration(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      const integration = await GitHubService.getIntegration(organizationId);
      const response: ApiSuccess<typeof integration> = {
        success: true,
        data: integration,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async connectApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      if (!req.user) throw new UnauthorizedError('Authentication required');

      const parseResult = connectGitHubAppSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid input');
      }

      const integration = await GitHubService.connectGitHubApp(
        organizationId,
        parseResult.data,
        req.user.id,
      );

      // Auto-sync repositories after connecting
      void GitHubService.syncRepositories(organizationId);

      const response: ApiSuccess<typeof integration> = {
        success: true,
        data: integration,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async connectPat(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      if (!req.user) throw new UnauthorizedError('Authentication required');

      const parseResult = connectGitHubPatSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid input');
      }

      const integration = await GitHubService.connectGitHubPat(
        organizationId,
        parseResult.data,
        req.user.id,
      );

      void GitHubService.syncRepositories(organizationId);

      const response: ApiSuccess<typeof integration> = {
        success: true,
        data: integration,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      const integration = await GitHubService.disconnectGitHub(organizationId);
      const response: ApiSuccess<typeof integration> = {
        success: true,
        data: integration,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async syncRepos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      const repos = await GitHubService.syncRepositories(organizationId);
      const response: ApiSuccess<typeof repos> = {
        success: true,
        data: repos,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async getRepositories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      const repos = await GitHubService.getRepositories(organizationId);
      const response: ApiSuccess<typeof repos> = {
        success: true,
        data: repos,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async linkRepository(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, repositoryId } = req.params;
      const parseResult = linkRepoSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid input');
      }

      const repo = await GitHubService.linkRepository(organizationId, repositoryId, parseResult.data);
      void GitHubService.syncRepoActivity(repositoryId);

      const response: ApiSuccess<typeof repo> = {
        success: true,
        data: repo,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async getCommits(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, repositoryId } = req.params;
      const commits = await GitHubService.getCommits(organizationId, repositoryId);
      const response: ApiSuccess<typeof commits> = {
        success: true,
        data: commits,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async getPullRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, repositoryId } = req.params;
      const prs = await GitHubService.getPullRequests(organizationId, repositoryId);
      const response: ApiSuccess<typeof prs> = {
        success: true,
        data: prs,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async getDeployments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, repositoryId } = req.params;
      const deployments = await GitHubService.getDeployments(organizationId, repositoryId);
      const response: ApiSuccess<typeof deployments> = {
        success: true,
        data: deployments,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async getWorkflowRuns(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, repositoryId } = req.params;
      const runs = await GitHubService.getWorkflowRuns(organizationId, repositoryId);
      const response: ApiSuccess<typeof runs> = {
        success: true,
        data: runs,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async linkIncidentActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId } = req.params;
      if (!req.user) throw new UnauthorizedError('Authentication required');

      const parseResult = linkIncidentActivitySchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(parseResult.error.errors[0]?.message || 'Invalid activity input');
      }

      const result = await GitHubService.linkActivityToIncident(
        organizationId,
        incidentId,
        parseResult.data,
        req.user.id,
      );

      const response: ApiSuccess<typeof result> = {
        success: true,
        data: result,
      };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const signatureHeader = (req.headers['x-hub-signature-256'] as string) || undefined;
      const deliveryId = (req.headers['x-github-delivery'] as string) || `delivery-${Date.now()}-${Math.random()}`;
      const eventType = (req.headers['x-github-event'] as string) || 'push';

      const rawBody = (req as Request & { rawBody?: Buffer | string }).rawBody || JSON.stringify(req.body);

      const result = await GitHubService.handleWebhookEvent(
        rawBody,
        signatureHeader,
        deliveryId,
        eventType,
        req.body,
      );

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}
