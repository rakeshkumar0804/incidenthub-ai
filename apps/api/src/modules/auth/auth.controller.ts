import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { UnauthorizedError } from '../../utils/errors';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
} from './auth.schema';
import { isProduction } from '../../config/env';

const REFRESH_COOKIE_NAME = 'refreshToken';

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
}

export class AuthController {
  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = registerSchema.parse(req.body);
      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await AuthService.register(input, userAgent, ipAddress);
      setRefreshCookie(res, result.refreshToken);

      const data: Record<string, unknown> = {
        ...result.authData,
      };
      const isProd = isProduction || process.env['NODE_ENV'] === 'production';
      if (!isProd) {
        data['verificationToken'] = result.verificationToken;
      }

      res.status(201).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = loginSchema.parse(req.body);
      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await AuthService.login(input, userAgent, ipAddress);
      setRefreshCookie(res, result.refreshToken);

      res.status(200).json({
        success: true,
        data: result.authData,
      });
    } catch (error) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cookies = (req.cookies && typeof req.cookies === 'object' ? req.cookies : {}) as Record<string, string>;
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
      const token = cookies[REFRESH_COOKIE_NAME] || body['refreshToken'];
      await AuthService.logout(token);
      clearRefreshCookie(res);

      res.status(200).json({
        success: true,
        data: { message: 'Logged out successfully' },
      });
    } catch (error) {
      next(error);
    }
  }

  static async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cookies = (req.cookies && typeof req.cookies === 'object' ? req.cookies : {}) as Record<string, string>;
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
      const rawToken = cookies[REFRESH_COOKIE_NAME] || body['refreshToken'];
      if (!rawToken) {
        throw new UnauthorizedError('Refresh token cookie or body missing');
      }

      const userAgent = req.headers['user-agent'];
      const ipAddress = req.ip;

      const result = await AuthService.refreshTokens(rawToken, userAgent, ipAddress);
      setRefreshCookie(res, result.refreshToken);

      res.status(200).json({
        success: true,
        data: { accessToken: result.accessToken },
      });
    } catch (error) {
      clearRefreshCookie(res);
      next(error);
    }
  }

  static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const data = await AuthService.getMe(req.user.id);
      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  static async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = forgotPasswordSchema.parse(req.body);
      const result = await AuthService.forgotPassword(input.email);

      const data: Record<string, unknown> = {
        message: 'If an account exists, a password reset link has been generated.',
      };
      const isProd = isProduction || process.env['NODE_ENV'] === 'production';
      if (!isProd && result.resetToken) {
        data['resetToken'] = result.resetToken;
      }

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = resetPasswordSchema.parse(req.body);
      const result = await AuthService.resetPassword(input);
      clearRefreshCookie(res);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = verifyEmailSchema.parse(req.body);
      const result = await AuthService.verifyEmail(input.token);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async resendVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = resendVerificationSchema.parse(req.body);
      const result = await AuthService.resendVerification(input.email);

      const isProd = isProduction || process.env['NODE_ENV'] === 'production';
      const data: Record<string, unknown> = {
        message: result.message,
      };
      if (!isProd && 'verificationToken' in result && result.verificationToken) {
        data['verificationToken'] = result.verificationToken;
      }

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }
}

