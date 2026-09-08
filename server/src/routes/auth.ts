import { Hono } from 'hono';
import { z } from 'zod';
import { query, withTx, type QueryParam } from '../db.js';
import { AppError } from '../lib/errors.js';
import { hashPassword, verifyPassword, newRefreshToken, hashRefreshToken } from '../lib/password.js';
import { issueAccessToken, requireAuth } from '../lib/auth.js';
import { env } from '../env.js';

const auth = new Hono();

// ---- tiny in-memory rate limiter (per IP+email, sliding window) ------------
const WINDOW_MS = 5 * 60_000;
const MAX_ATTEMPTS = 20;
const attempts = new Map<string, number[]>();

function rateLimit(key: string): void {
  const now = Date.now();
  const arr = (attempts.get(key) ?? []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= MAX_ATTEMPTS) {
    throw new AppError('RATE_LIMITED', 'Too many attempts — try again in a few minutes');
  }
  arr.push(now);
  attempts.set(key, arr);
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (v.every(t => now - t > WINDOW_MS)) attempts.delete(k);
  }
}

const clientKey = (ip: string, extra: string) => `${ip}:${extra}`;
const ipOf = (header: string | undefined) => (header ?? 'local').split(',')[0]!.trim();

// ---- validation ------------------------------------------------------------

const credentialsSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80).optional(),
  deviceName: z.string().max(80).optional()
});

type Credentials = z.infer<typeof credentialsSchema>;

async function parseBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new AppError('VALIDATION', 'JSON body required');
  return body as Record<string, unknown>;
}

function validate(body: Record<string, unknown>): Credentials {
  const res = credentialsSchema.safeParse(body);
  if (!res.success) {
    throw new AppError('VALIDATION', res.error.issues[0]?.message ?? 'Invalid input');
  }
  return res.data;
}

// ---- session issuance ------------------------------------------------------

interface UserRow { id: string; email: string; display_name: string }

async function issueSession(user: UserRow, deviceName: string) {
  const refreshToken = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.refreshTtlDays * 86_400_000);
  await query(
    'insert into devices (user_id, refresh_hash, device_name, expires_at) values ($1, $2, $3, $4)',
    [user.id, hashRefreshToken(refreshToken), deviceName, expiresAt]
  );
  const accessToken = await issueAccessToken(user.id);
  return {
    user: { id: user.id, email: user.email, displayName: user.display_name },
    tokens: { accessToken, refreshToken }
  };
}

// ---- routes ----------------------------------------------------------------

auth.post('/register', async c => {
  const ip = ipOf(c.req.header('x-forwarded-for'));
  rateLimit(clientKey(ip, 'register'));
  const input = validate(await parseBody(c));

  const existing = await query('select id from users where email = $1', [input.email.toLowerCase()]);
  if (existing.length) throw new AppError('EMAIL_TAKEN', 'Email already registered');

  let user: UserRow[];
  try {
    user = await query(
      'insert into users (email, password_hash, display_name) values ($1, $2, $3) returning id, email, display_name',
      [input.email.toLowerCase(), hashPassword(input.password), input.displayName ?? input.email.split('@')[0]!]
    );
  } catch (e: unknown) {
    // unique_violation on email (race)
    if ((e as { code?: string }).code === '23505') throw new AppError('EMAIL_TAKEN', 'Email already registered');
    throw e;
  }
  return c.json(await issueSession(user[0]!, input.deviceName ?? 'Unknown'), 201);
});

auth.post('/login', async c => {
  const input = validate(await parseBody(c));
  const ip = ipOf(c.req.header('x-forwarded-for'));
  rateLimit(clientKey(ip, input.email.toLowerCase()));

  const rows = await query<UserRow & { password_hash: string }>(
    'select id, email, display_name, password_hash from users where email = $1',
    [input.email.toLowerCase()]
  );
  const user = rows[0];
  if (!user || !verifyPassword(input.password, user.password_hash)) {
    throw new AppError('BAD_CREDENTIALS', 'Invalid email or password');
  }
  return c.json(await issueSession(user, input.deviceName ?? 'Unknown'));
});

auth.post('/refresh', async c => {
  const body = await parseBody(c);
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
  if (!refreshToken) throw new AppError('VALIDATION', 'refreshToken required');

  const rows = await query<{ id: string; user_id: string; email: string; display_name: string }>(
    `select d.id, d.user_id, u.email, u.display_name
     from devices d join users u on u.id = d.user_id
     where d.refresh_hash = $1 and d.revoked_at is null and d.expires_at > now()`,
    [hashRefreshToken(refreshToken)]
  );
  const session = rows[0];
  if (!session) throw new AppError('INVALID_TOKEN', 'Refresh token unknown or expired');

  // Rotation: revoke the old row, issue a fresh pair.
  await query('update devices set revoked_at = now() where id = $1', [session.id]);
  const tokens = await issueSession(
    { id: session.user_id, email: session.email, display_name: session.display_name },
    'rotated'
  );
  return c.json(tokens);
});

auth.post('/logout', requireAuth, async c => {
  const body = await parseBody(c).catch(() => ({}) as Record<string, unknown>);
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
  if (refreshToken) {
    await query(
      'update devices set revoked_at = now() where refresh_hash = $1 and user_id = $2',
      [hashRefreshToken(refreshToken), c.get('userId')]
    );
  }
  return c.body(null, 204);
});

export default auth;
