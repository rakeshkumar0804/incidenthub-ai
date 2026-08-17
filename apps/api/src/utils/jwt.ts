import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenPayload {
  userId: string;
  email: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  userId: string;
  sessionId: string;
  family: string;
  type: 'refresh';
}

export function signAccessToken(userId: string, email: string): string {
  const payload: AccessTokenPayload = { userId, email, type: 'access' };
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as unknown as number };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function signRefreshToken(userId: string, sessionId: string, family: string): string {
  const payload: RefreshTokenPayload = { userId, sessionId, family, type: 'refresh' };
  const options: SignOptions = { expiresIn: env.JWT_REFRESH_EXPIRES_IN as unknown as number };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
    if (decoded.type !== 'access') return null;
    return decoded;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') return null;
    return decoded;
  } catch {
    return null;
  }
}
