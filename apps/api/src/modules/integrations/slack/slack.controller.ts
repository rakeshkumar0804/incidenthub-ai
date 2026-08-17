import type { Request, Response, NextFunction } from 'express';
import { SlackService } from './slack.service';
import { ValidationError } from '../../../utils/errors';
import type { SlackInteractivePayload } from './slack.types';

export class SlackController {
  public static initiateOAuth = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const { organizationId } = req.params;
      const userId = (req as unknown as { user: { id: string } }).user.id;
      if (!organizationId) throw new ValidationError('Organization ID is required');

      const authorizeUrl = SlackService.getSlackAuthorizeUrl(organizationId, userId);
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

      const { organizationId } = await SlackService.handleOAuthCallback(codeStr, stateStr);
      res.redirect(`${process.env['CLIENT_URL'] || 'http://localhost:5173'}/settings/integrations?connected=slack&orgId=${organizationId}`);
    } catch (error) {
      next(error);
    }
  };

  public static disconnect = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId } = req.params;
      if (!organizationId) throw new ValidationError('Organization ID is required');

      await SlackService.disconnectSlack(organizationId);
      res.status(200).json({ success: true, data: { message: 'Slack integration disconnected successfully' } });
    } catch (error) {
      next(error);
    }
  };

  public static createChannel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId, incidentId } = req.params;
      if (!organizationId || !incidentId) throw new ValidationError('Organization ID and Incident ID are required');

      const result = await SlackService.createIncidentChannel(organizationId, incidentId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  public static handleWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const signature = typeof req.headers['x-slack-signature'] === 'string' ? req.headers['x-slack-signature'] : undefined;
      const timestamp = typeof req.headers['x-slack-request-timestamp'] === 'string' ? req.headers['x-slack-request-timestamp'] : undefined;

      if (process.env['NODE_ENV'] !== 'test' && signature) {
        const rawBody: Buffer = typeof req.body === 'string' ? Buffer.from(req.body, 'utf8') : Buffer.from(JSON.stringify(req.body));
        const isValid = SlackService.verifySlackSignature(rawBody, timestamp, signature);
        if (!isValid) {
          res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid Slack signature' } });
          return;
        }
      }

      const bodyObj = req.body as Record<string, unknown>;
      let parsedPayload: unknown = bodyObj;
      if (bodyObj && typeof bodyObj['payload'] === 'string') {
        parsedPayload = JSON.parse(bodyObj['payload']);
      }

      const payloadRecord = parsedPayload as Record<string, unknown>;

      if (payloadRecord && payloadRecord['type'] === 'interactive') {
        const reply = await SlackService.handleInteractivePayload(parsedPayload as SlackInteractivePayload);
        res.status(200).json(reply);
        return;
      }

      res.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  };
}
