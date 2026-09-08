/**
 * End-to-end integration test for the Gallery backend (P1 contract).
 * Requires the server running at GALLERY_URL (default http://localhost:8787).
 *
 *   node scripts/server-smoke.mjs
 */

const BASE = process.env.GALLERY_URL ?? 'http://localhost:8787';

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name} ${extra}`);
  }
};

const req = async (method, path, { token, body, idem } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idem ? { 'Idempotency-Key': idem } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const doc = () => ({
  id: 'local-smoke',
  metadata: { title: 'Smoke Script', author: 'IT', draft: 'v1', templateId: 'standard', scriptLanguage: 'zh' },
  blocks: [{ id: 'b1', type: 'ACTION', content: 'beat one', imagePrompt: 'KEEP-ME' }],
  referenceBindings: { characters: {} }
});

const run = async () => {
  console.log('── Gallery server smoke ────────────────────────────');

  const health = await req('GET', '/health');
  check('health', health.status === 200 && health.json?.ok === true);

  const email = `smoke-${Date.now()}@test.dev`;
  const reg = await req('POST', '/auth/register', {
    body: { email, password: 'password123', displayName: 'IT Writer', deviceName: 'smoke' }
  });
  check('register → 201 + tokens', reg.status === 201 && !!reg.json?.tokens?.accessToken && reg.json.user?.displayName === 'IT Writer');

  const dup = await req('POST', '/auth/register', { body: { email, password: 'password123' } });
  check('duplicate email → 409 EMAIL_TAKEN', dup.status === 409 && dup.json?.error?.code === 'EMAIL_TAKEN');

  const badLogin = await req('POST', '/auth/login', { body: { email, password: 'wrong-password' } });
  check('bad password → 401 BAD_CREDENTIALS', badLogin.status === 401 && badLogin.json?.error?.code === 'BAD_CREDENTIALS');

  const t = reg.json.tokens;

  const anon = await req('GET', '/scripts');
  check('no token → 401 AUTH_REQUIRED', anon.status === 401 && anon.json?.error?.code === 'AUTH_REQUIRED');

  const empty = await req('GET', '/scripts', { token: t.accessToken });
  check('list starts empty', empty.status === 200 && Array.isArray(empty.json) && empty.json.length === 0);

  // create (idempotent)
  const created = await req('POST', '/scripts', { token: t.accessToken, body: { doc: doc() }, idem: 'smoke-key-1' });
  check('create → 201 {id,revision:1}', created.status === 201 && created.json?.revision === 1 && !!created.json?.id);
  const id = created.json.id;

  const retry = await req('POST', '/scripts', { token: t.accessToken, body: { doc: doc() }, idem: 'smoke-key-1' });
  check('idempotent retry → same id', retry.status === 200 && retry.json?.id === id);

  // push
  const d2 = doc();
  d2.metadata.title = 'Smoke Script v2';
  d2.blocks.push({ id: 'b2', type: 'DIALOGUE', content: 'beat two' });
  const push = await req('PUT', `/scripts/${id}?ifMatch=1`, { token: t.accessToken, body: { doc: d2 } });
  check('push ifMatch=1 → revision 2', push.status === 200 && push.json?.revision === 2);

  const conflict = await req('PUT', `/scripts/${id}?ifMatch=1`, { token: t.accessToken, body: { doc: d2 } });
  check(
    'stale push → 409 + serverRevision',
    conflict.status === 409 && conflict.json?.error?.code === 'REVISION_CONFLICT' && conflict.json?.error?.serverRevision === 2
  );

  // get + lossless round-trip
  const got = await req('GET', `/scripts/${id}`, { token: t.accessToken });
  check(
    'get → rev2, title updated, doc lossless (imagePrompt kept)',
    got.status === 200
      && got.json?.revision === 2
      && got.json.script?.title === 'Smoke Script v2'
      && got.json.doc?.blocks?.[0]?.imagePrompt === 'KEEP-ME'
      && got.json.doc?.referenceBindings !== undefined
      && got.json.doc?.id === 'local-smoke'
  );

  const list = await req('GET', '/scripts', { token: t.accessToken });
  check(
    'list → 1 row, latestRevision 2, blockCount 2',
    list.json?.length === 1 && list.json[0]?.latestRevision === 2 && list.json[0]?.blockCount === 2
  );

  // ownership isolation: another account cannot see or push it
  const other = await req('POST', '/auth/register', {
    body: { email: `smoke-other-${Date.now()}@test.dev`, password: 'password123', displayName: 'Other' }
  });
  const foreignGet = await req('GET', `/scripts/${id}`, { token: other.json.tokens.accessToken });
  check('foreign read → 404', foreignGet.status === 404);
  const foreignPush = await req('PUT', `/scripts/${id}?ifMatch=2`, { token: other.json.tokens.accessToken, body: { doc: doc() } });
  check('foreign push → 404', foreignPush.status === 404);

  // refresh rotation
  const refreshed = await req('POST', '/auth/refresh', { body: { refreshToken: t.refreshToken } });
  check('refresh → new pair', refreshed.status === 200 && !!refreshed.json?.tokens?.accessToken);
  const reuse = await req('POST', '/auth/refresh', { body: { refreshToken: t.refreshToken } });
  check('refresh reuse → 401 (rotated)', reuse.status === 401 && reuse.json?.error?.code === 'INVALID_TOKEN');
  const t2 = refreshed.json.tokens;

  // soft delete + list
  const del = await req('DELETE', `/scripts/${id}`, { token: t2.accessToken });
  check('delete → 204', del.status === 204);
  const afterDel = await req('GET', '/scripts', { token: t2.accessToken });
  check('deleted script out of list', afterDel.json?.length === 0);
  const gone = await req('GET', `/scripts/${id}`, { token: t2.accessToken });
  check('deleted script get → 404', gone.status === 404);

  // logout revokes refresh
  const out = await req('POST', '/auth/logout', { token: t2.accessToken, body: { refreshToken: t2.refreshToken } });
  check('logout → 204', out.status === 204);
  const afterOut = await req('POST', '/auth/refresh', { body: { refreshToken: t2.refreshToken } });
  check('refresh after logout → 401', afterOut.status === 401);

  console.log('────────────────────────────────────────────────────');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(e => {
  console.error('SMOKE CRASHED:', e);
  process.exit(1);
});
