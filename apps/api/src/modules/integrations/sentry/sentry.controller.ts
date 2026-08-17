import type { Request, Response, NextFunction } from 'express';
import { SentryService } from './sentry.service';
import {
  connectSentryOAuthSchema,
  connectSentryTokenSchema,
  createSentryRuleSchema,
  linkSentryIssueSchema,
} from './sentry.schema';
import { ValidationError, UnauthorizedError } from '../../../utils/errors';
import type { ApiSuccess } from '@incidenthub/shared';

export class SentryController {
  public static async getIntegrationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      const status = await SentryService.getIntegration(organizationId);
      const response: ApiSuccess<typeof status> = {
        success: true,
        data: status,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static authorizeOAuth(req: Request, res: Response, next: NextFunction): void {
    try {
      const { organizationId } = req.params;
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const userId = req.user.id;
      const body = (req.body as Record<string, unknown> | undefined) ?? {};
      const redirectUri =
        (req.query['redirectUri'] as string) ||
        (body['redirectUri'] as string) ||
        `${process.env['CLIENT_URL'] || 'http://localhost:5173'}/settings/sentry/callback`;
      const sentryOrgSlug = (req.query['sentryOrgSlug'] as string) || (body['sentryOrgSlug'] as string);

      const dto = SentryService.generateOAuthAuthorizeUrl(organizationId, userId, redirectUri, sentryOrgSlug);
      const response: ApiSuccess<typeof dto> = {
        success: true,
        data: dto,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async connectOAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const userId = req.user.id;

      const parsed = connectSentryOAuthSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid OAuth payload');
      }

      const dto = await SentryService.connectOAuth(organizationId, parsed.data, userId);
      const response: ApiSuccess<typeof dto> = {
        success: true,
        data: dto,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async connectToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const userId = req.user.id;

      const parsed = connectSentryTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid Sentry token payload');
      }

      const dto = await SentryService.connectToken(
        organizationId,
        parsed.data.sentryToken,
        parsed.data.sentryOrgSlug,
        userId,
      );
      const response: ApiSuccess<typeof dto> = {
        success: true,
        data: dto,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async disconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      const dto = await SentryService.disconnect(organizationId);
      const response: ApiSuccess<typeof dto> = {
        success: true,
        data: dto,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const headerResource = req.headers['sentry-hook-resource'];
      const headerDelivery = req.headers['x-sentry-delivery'];
      const deliveryId =
        (typeof headerResource === 'string' ? headerResource : undefined) ||
        (typeof headerDelivery === 'string' ? headerDelivery : undefined) ||
        `deliv-${Date.now()}`;

      const headerSentrySig = req.headers['sentry-hook-signature'];
      const headerXSig = req.headers['x-sentry-signature'];
      const signature =
        (typeof headerSentrySig === 'string' ? headerSentrySig : undefined) ||
        (typeof headerXSig === 'string' ? headerXSig : undefined);

      const result = await SentryService.handleWebhookEvent(deliveryId, signature, req.body);
      const response: ApiSuccess<typeof result> = {
        success: true,
        data: result,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async listIssues(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      const issues = await SentryService.listIssues(organizationId);
      const response: ApiSuccess<typeof issues> = {
        success: true,
        data: issues,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async listRules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      const rules = await SentryService.listRules(organizationId);
      const response: ApiSuccess<typeof rules> = {
        success: true,
        data: rules,
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async createRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId } = req.params;
      const parsed = createSentryRuleSchema.safeParse(req.body);

      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid Sentry rule payload');
      }

      const rule = await SentryService.createRule(organizationId, parsed.data);
      const response: ApiSuccess<typeof rule> = {
        success: true,
        data: rule,
      };
      res.status(201).json(response);
    } catch (err) {
      next(err);
    }
  }

  public static async deleteRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, ruleId } = req.params;
      await SentryService.deleteRule(organizationId, ruleId);
      res.status(200).json({ success: true, data: { message: 'Rule deleted successfully' } });
    } catch (err) {
      next(err);
    }
  }

  public static async linkIssueToIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { organizationId, incidentId } = req.params;
      if (!req.user) throw new UnauthorizedError('Authentication required');
      const userId = req.user.id;

      const parsed = linkSentryIssueSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message || 'Invalid link issue payload');
      }

      const result = await SentryService.linkIssueToIncident(
        organizationId,
        incidentId,
        parsed.data.sentryIssueId,
        userId,
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
}
