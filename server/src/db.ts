import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000
});

export type QueryParam = string | number | boolean | null | object;

/** Parameterized query helper — rows typed by the caller. */
export async function query<T>(text: string, params: readonly QueryParam[] = []): Promise<T[]> {
  const res = await pool.query(text, params as unknown as unknown[]);
  return res.rows as T[];
}

/** Run `fn` inside a transaction; rolls back on throw. */
export async function withTx<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = (async <T>(text: string, params: readonly QueryParam[] = []) => {
      const res = await client.query(text, params as unknown as unknown[]);
      return res.rows as T[];
    }) as TxClient;
    const out = await fn(tx);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export interface TxClient {
  <T>(text: string, params?: readonly QueryParam[]): Promise<T[]>;
}

/**
 * Boot-time migration runner: applies `src/migrations/*.sql` in filename
 * order, exactly once each, tracked in schema_migrations.
 */
export async function runMigrations(): Promise<string[]> {
  await query(`create table if not exists schema_migrations (
    id text primary key,
    applied_at timestamptz not null default now()
  )`);

  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  const applied = new Set((await query<{ id: string }>('select id from schema_migrations')).map(r => r.id));
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), 'utf8');
    await withTx(async tx => {
      await tx(sql);
      await tx('insert into schema_migrations (id) values ($1)', [file]);
    });
    ran.push(file);
  }
  return ran;
}
