import { sign, verify } from 'hono/jwt';
import { createMiddleware } from 'hono/factory';
import { env } from '../env.js';
import { AppError } from './errors.js';

export const ACCESS_TTL_SEC = 15 * 60; // 15 minutes

export interface AccessClaims {
  sub: string;   // user id
  exp: number;
  iat: number;
}

export async function issueAccessToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, iat: now, exp: now + ACCESS_TTL_SEC }, env.jwtSecret, 'HS256');
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const payload = await verify(token, env.jwtSecret, 'HS256');
    if (typeof payload.sub !== 'string') throw new Error('bad claims');
    return payload as unknown as AccessClaims;
  } catch {
    throw new AppError('INVALID_TOKEN', 'Invalid or expired access token');
  }
}

/** Extract + verify the Bearer token; exposes the verified claims as c.userId. */
export const requireAuth = createMiddleware<{ Variables: { userId: string } }>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) throw new AppError('AUTH_REQUIRED', 'Missing Authorization header');
  const claims = await verifyAccessToken(token);
  c.set('userId', claims.sub);
  await next();
});
