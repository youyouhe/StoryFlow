import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): void {
  // Minimal .env loader (no dependency): KEY=VALUE lines, # comments.
  try {
    const raw = readFileSync(path.join(here, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, value] = m as unknown as [string, string, string];
      if (process.env[key] === undefined) {
        process.env[key] = value.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    // no .env — env vars only, fine
  }
}

loadDotEnv();

const randomSecret = () => randomBytes(32).toString('hex');

export const env = {
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://bird@127.0.0.1:5433/storyflow_dev',
  jwtSecret: process.env.JWT_SECRET || randomSecret(),
  jwtSecretIsEphemeral: !process.env.JWT_SECRET,
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 90)
};

if (env.jwtSecretIsEphemeral) {
  console.warn('[config] JWT_SECRET not set — using an EPHEMERAL per-boot secret. All sessions die on restart. Set JWT_SECRET in production!');
}
