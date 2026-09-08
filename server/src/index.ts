import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { env } from './env.js';
import { runMigrations, pool } from './db.js';
import { AppError, errorBody } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import scriptRoutes from './routes/scripts.js';

const app = new Hono();

app.use('*', cors({
  origin: env.corsOrigins,
  allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86400
}));

// Screenplay docs can carry graybox payloads — allow generous but bounded bodies.
app.use('*', bodyLimit({
  maxSize: 8 * 1024 * 1024,
  onError: c => c.json({ error: { code: 'VALIDATION', message: 'Body too large (8 MB limit)' } }, 413)
}));

app.get('/health', c => c.json({ ok: true, service: 'storyflow-gallery' }));

app.route('/auth', authRoutes);
app.route('/scripts', scriptRoutes);

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(errorBody(err), err.status as 400);
  }
  console.error('[unhandled]', err);
  return c.json({ error: { code: 'SERVER' as const, message: 'Internal server error' } }, 500);
});

app.notFound(c => c.json({ error: { code: 'NOT_FOUND' as const, message: 'No such route' } }, 404));

const migrated = await runMigrations();
if (migrated.length) console.log(`[db] applied migrations: ${migrated.join(', ')}`);

const server = serve({ fetch: app.fetch, port: env.port }, info => {
  console.log(`[gallery] listening on http://localhost:${info.port} (cors: ${env.corsOrigins.join(', ')})`);
});

const shutdown = (signal: string) => {
  console.log(`[gallery] ${signal} — shutting down`);
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
