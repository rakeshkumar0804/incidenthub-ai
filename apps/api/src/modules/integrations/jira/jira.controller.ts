import type { Request, Response, NextFunction } from 'express';
import { JiraService } from './jira.service';
import { ValidationError } from '../../../utils/errors';
import type { JiraWebhookPayload } from './jira.types';

export class JiraController {
  public static initiateOAuth = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const { organizationId } = req.params;
      const userId = (req as unknown as { user: { id: string } }).user.id;
      if (!organizationId) throw new ValidationError('Organization ID is required');

      const authorizeUrl = JiraService.getJiraAuthorizeUrl(organizationId, userId);
      res.status(200).json({ success: true, data: { authorizeUrl } });
    } catch (error) {
      next(error);
    }
  };

  public static handleCallback = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const codeStr = typeof req.query['code'] === 'string' ? req.query['code'] : '';
      const stateStr = typeof req.query['state'] === 'string' ? req.query['state'] : '';
      if (!codeStr || !stateStr) throw new ValidationError('Code and state query parameters required');

      const { organizationId } = await JiraService.handleOAuthCallback(codeStr, stateStr);
      res.redirect(`${process.env['CLIENT_URL'] || 'http://localhost:5173'}/settings/integrations?connected=jira&orgId=${organizationId}`);
    } catch (error) {
      next(error);
    }
  };

  public static connectApiToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId } = req.params;
      const userId = (req as unknown as { user: { id: string } }).user.id;
      const body = req.body as { siteUrl: string; email: string; apiToken: string; defaultProjectKey?: string };

      if (!organizationId) throw new ValidationError('Organization ID is required');
      await JiraService.connectApiToken(organizationId, userId, body);

      res.status(200).json({ success: true, data: { message: 'Jira API Token connected successfully' } });
    } catch (error) {
      next(error);
    }
  };

  public static disconnect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId } = req.params;
      if (!organizationId) throw new ValidationError('Organization ID is required');

      await JiraService.disconnectJira(organizationId);
      res.status(200).json({ success: true, data: { message: 'Jira integration disconnected successfully' } });
    } catch (error) {
      next(error);
    }
  };

  public static createJiraIssue = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId, incidentId, actionItemId } = req.params;
      const body = req.body as { projectKey?: string };

      if (!organizationId || !incidentId || !actionItemId) {
        throw new ValidationError('organizationId, incidentId, and actionItemId are required');
      }

      const result = await JiraService.createJiraIssueFromActionItem(organizationId, incidentId, actionItemId, body.projectKey);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  public static handleWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const secretHeader = typeof req.headers['x-atlassian-webhook-secret'] === 'string' ? req.headers['x-atlassian-webhook-secret'] : undefined;
      const result = await JiraService.handleWebhook(secretHeader, req.body as JiraWebhookPayload);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}
