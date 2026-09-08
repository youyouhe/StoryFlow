import { Hono } from 'hono';
import { query, withTx } from '../db.js';
import { AppError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

/** Screenplay ownership scope. Param placeholder is injected per-query. */
const OWNED_AT = (ownerParam: string) =>
  `owner_type = 'user' AND owner_id = ${ownerParam} AND deleted_at IS NULL`;

const scripts = new Hono<{ Variables: { userId: string } }>();
scripts.use('*', requireAuth);

// ---- doc validation (lossless: never reconstruct the client's doc) ---------

interface DocInfo {
  doc: unknown;
  title: string;
  templateId: string | null;
  scriptLanguage: string;
}

function extractDoc(body: unknown): DocInfo {
  if (!body || typeof body !== 'object') throw new AppError('VALIDATION', 'JSON body required');
  const doc = (body as Record<string, unknown>).doc;
  if (!doc || typeof doc !== 'object') throw new AppError('VALIDATION', 'doc object required');
  const meta = (doc as Record<string, unknown>).metadata;
  if (!meta || typeof meta !== 'object' || typeof (meta as Record<string, unknown>).title !== 'string') {
    throw new AppError('VALIDATION', 'doc.metadata.title (string) required');
  }
  if (!Array.isArray((doc as Record<string, unknown>).blocks)) {
    throw new AppError('VALIDATION', 'doc.blocks (array) required');
  }
  const title = ((meta as Record<string, unknown>).title as string).trim().slice(0, 300) || 'Untitled';
  const templateIdRaw = (meta as Record<string, unknown>).templateId;
  const langRaw = (meta as Record<string, unknown>).scriptLanguage;
  return {
    doc,
    title,
    templateId: typeof templateIdRaw === 'string' ? templateIdRaw.slice(0, 100) : null,
    scriptLanguage: typeof langRaw === 'string' ? langRaw.slice(0, 10) : 'en'
  };
}

const blockCountOf = (doc: unknown) => (doc as { blocks: unknown[] }).blocks.length;

// ---- routes ----------------------------------------------------------------

scripts.get('/', async c => {
  const rows = await query<{
    id: string; title: string; visibility: string; latest_revision: number;
    block_count: number; updated_at: Date;
  }>(
    `select s.id, s.title, s.visibility, s.latest_revision, lv.block_count, s.updated_at
     from scripts s
     join lateral (
       select block_count from script_versions v
       where v.script_id = s.id order by revision desc limit 1
     ) lv on true
     where ${OWNED_AT('$1')}
     order by s.updated_at desc`,
    [c.get('userId')]
  );
  return c.json(rows.map(r => ({
    id: r.id,
    title: r.title,
    visibility: r.visibility,
    latestRevision: r.latest_revision,
    blockCount: r.block_count,
    updatedAt: r.updated_at.getTime()
  })));
});

scripts.post('/', async c => {
  const info = extractDoc(await c.req.json().catch(() => null));
  const idemKey = c.req.header('Idempotency-Key') || null;
  const userId = c.get('userId');

  // Idempotent create: same key → same script (its CURRENT latest revision,
  // so a retried push continues from the newest base).
  if (idemKey) {
    const existing = await query<{ id: string; latest_revision: number }>(
      `select s.id, s.latest_revision
       from script_versions v join scripts s on s.id = v.script_id
       where v.idempotency_key = $1 and s.owner_id = $2 and s.deleted_at is null
       limit 1`,
      [idemKey, userId]
    );
    if (existing[0]) return c.json({ id: existing[0].id, revision: existing[0].latest_revision });
  }

  const scriptId = await withTx<string>(async tx => {
    const scriptRows = await tx<{ id: string }>(
      `insert into scripts (owner_type, owner_id, title, visibility, template_id, script_language, latest_revision)
       values ('user', $1, $2, 'private', $3, $4, 1) returning id`,
      [userId, info.title, info.templateId, info.scriptLanguage]
    );
    const id = scriptRows[0]!.id;
    await tx(
      `insert into script_versions (script_id, revision, doc, block_count, author_id, idempotency_key)
       values ($1, 1, $2, $3, $4, $5)`,
      [id, JSON.stringify(info.doc), blockCountOf(info.doc), userId, idemKey]
    );
    return id;
  }).catch(async (e: unknown) => {
    // Lost a race on the partial-unique idempotency index → resolve to winner.
    if ((e as { code?: string }).code === '23505' && idemKey) {
      const existing = await query<{ id: string; latest_revision: number }>(
        `select s.id, s.latest_revision
         from script_versions v join scripts s on s.id = v.script_id
         where v.idempotency_key = $1 and s.owner_id = $2 limit 1`,
        [idemKey, userId]
      );
      if (existing[0]) return `${existing[0].id}:${existing[0].latest_revision}`;
    }
    throw e;
  });

  if (scriptId.includes(':')) {
    const [id, rev] = scriptId.split(':');
    return c.json({ id, revision: Number(rev) });
  }
  return c.json({ id: scriptId, revision: 1 }, 201);
});

scripts.put('/:id', async c => {
  const scriptId = c.req.param('id');
  const ifMatch = Number(c.req.query('ifMatch'));
  if (!Number.isInteger(ifMatch) || ifMatch < 0) {
    throw new AppError('VALIDATION', 'ifMatch (integer) query param required');
  }
  const info = extractDoc(await c.req.json().catch(() => null));
  const userId = c.get('userId');

  const revision = await withTx<number>(async tx => {
    const rows = await tx<{ latest_revision: number }>(
      `select latest_revision from scripts where id = $1 and ${OWNED_AT('$2')} for update`,
      [scriptId, userId]
    );
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', 'Script not found');
    if (row.latest_revision !== ifMatch) {
      throw new AppError('REVISION_CONFLICT', `Expected ifMatch=${row.latest_revision}`, {
        serverRevision: row.latest_revision
      });
    }
    const next = row.latest_revision + 1;
    await tx(
      `insert into script_versions (script_id, revision, doc, block_count, author_id)
       values ($1, $2, $3, $4, $5)`,
      [scriptId, next, JSON.stringify(info.doc), blockCountOf(info.doc), userId]
    );
    await tx(
      `update scripts set latest_revision = $2, title = $3,
       template_id = coalesce($4, template_id), script_language = $5, updated_at = now()
       where id = $1`,
      [scriptId, next, info.title, info.templateId, info.scriptLanguage]
    );
    return next;
  });

  return c.json({ revision });
});

scripts.get('/:id', async c => {
  const userId = c.get('userId');
  const rows = await query<{
    id: string; title: string; visibility: string; latest_revision: number;
    updated_at: Date; doc: unknown; revision: number; block_count: number;
  }>(
    `select s.id, s.title, s.visibility, s.latest_revision, s.updated_at,
            v.doc, v.revision, v.block_count
     from scripts s
     join lateral (
       select doc, revision, block_count from script_versions v
       where v.script_id = s.id order by revision desc limit 1
     ) v on true
     where s.id = $1 and ${OWNED_AT('$2')}`,
    [c.req.param('id'), userId]
  );
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Script not found');
  return c.json({
    script: {
      id: row.id,
      title: row.title,
      visibility: row.visibility,
      latestRevision: row.latest_revision,
      blockCount: row.block_count,
      updatedAt: row.updated_at.getTime()
    },
    doc: row.doc,
    revision: row.revision
  });
});

scripts.delete('/:id', async c => {
  const userId = c.get('userId');
  const res = await query<{ id: string }>(
    `update scripts set deleted_at = now()
     where id = $1 and ${OWNED_AT('$2')} and deleted_at is null
     returning id`,
    [c.req.param('id'), userId]
  );
  if (!res[0]) throw new AppError('NOT_FOUND', 'Script not found');
  return c.body(null, 204);
});

export default scripts;
