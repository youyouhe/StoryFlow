/**
 * End-to-end smoke test for the P1 Gallery sync stack
 * (GalleryClient + SyncEngine against MockGalleryApi).
 * No server, no browser required — runs in plain node.
 *
 * Run:
 *   npx esbuild scripts/sync-smoke.ts --bundle --platform=node --format=esm \
 *     --outfile=/tmp/opencode/sync-smoke.mjs && node /tmp/opencode/sync-smoke.mjs
 */

// localStorage shim — must exist before any client/engine construction.
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k)
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface Check {
  (name: string, cond: boolean): void;
}
let failures = 0;
const check: Check = (name, cond) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}`);
  }
};

async function main() {
  const { GalleryClient, MockGalleryApi } = await import('../services/apiClient');
  const { SyncEngine, drain } = await import('../services/syncEngine');
  type SyncStoreAdapter = import('../services/syncEngine').SyncStoreAdapter;
  type SyncEvent = import('../services/syncEngine').SyncEvent;
  type Screenplay = import('../types').Screenplay;
  type ScriptSyncState = import('../types').ScriptSyncState;

  class MemoryStore implements SyncStoreAdapter {
    private docs = new Map<string, Screenplay>();
    private sync = new Map<string, ScriptSyncState>();
    getScreenplay(id: string) {
      return this.docs.get(id) ?? null;
    }
    putScreenplay(s: Screenplay) {
      this.docs.set(s.id, s);
    }
    allScreenplayIds() {
      return [...this.docs.keys()];
    }
    getSyncState(id: string) {
      return this.sync.get(id) ?? null;
    }
    setSyncState(id: string, st: ScriptSyncState | null) {
      if (st) this.sync.set(id, st);
      else this.sync.delete(id);
    }
  }

  const mk = (tag: string, title: string): Screenplay => ({
    id: `local-${tag}`,
    metadata: { title, author: 'Smoke', draft: 'v1', templateId: 'standard', scriptLanguage: 'en' },
    lastModified: Date.now(),
    blocks: [{ id: 'b1', type: 'ACTION', content: `${title} — opening beat.` }]
  });

  console.log('── Gallery sync smoke ──────────────────────────────');

  // Short access-token TTL so the refresh path is exercised for real.
  const mock = new MockGalleryApi({ latencyMs: 5, accessTtlMs: 150 });
  const client = new GalleryClient(mock);
  const store = new MemoryStore();
  const engine = new SyncEngine(client, store, { flushDelayMs: 20 });

  const events: SyncEvent[] = [];
  engine.on(e => events.push(e));

  const creds = { email: 'smoke@test.dev', password: 'secret123', deviceName: 'smoke-runner' };

  // 1. register + first push
  const user = await client.register({ ...creds, displayName: 'Smoke Writer' });
  check('register → signed in', user.displayName === 'Smoke Writer' && client.isAuthenticated);

  const spA = mk('a', 'Script A');
  store.putScreenplay(spA);
  check("pristine script status is 'local'", engine.statusOf(spA.id) === 'local');

  await engine.syncNow(spA.id);
  check('syncNow → synced at revision 1', engine.statusOf(spA.id) === 'synced' && store.getSyncState(spA.id)?.baseRevision === 1);
  check('cloud id assigned', !!engine.cloudIdOf(spA.id));

  // 2. edit → debounced auto-push
  spA.blocks.push({ id: 'b2', type: 'DIALOGUE', content: 'Second beat.' });
  spA.lastModified = Date.now();
  engine.markDirty(spA);
  await drain(engine);
  check('edit → auto-flushed to revision 2', store.getSyncState(spA.id)?.baseRevision === 2);

  // 3. conflict: another device advanced the cloud behind our back
  const cloudA = mock.debugFindScriptByTitle('Script A');
  check('cloud copy of A exists', !!cloudA);
  const extDoc: Screenplay = structuredClone(spA);
  extDoc.blocks = [{ id: 'x1', type: 'ACTION', content: 'Written on ANOTHER device.' }];
  mock.debugPushExternal(cloudA!.id, extDoc); // → server rev 3, we still think 2

  spA.blocks.push({ id: 'b3', type: 'ACTION', content: 'Local edit on top.' });
  spA.lastModified = Date.now();
  engine.markDirty(spA);
  await drain(engine);
  check(
    'conflict resolved: local wins at revision 4',
    engine.statusOf(spA.id) === 'synced' && store.getSyncState(spA.id)?.baseRevision === 4
  );
  const fork = store.allScreenplayIds().map(id => store.getScreenplay(id)!).find(s => s.id !== spA.id);
  check('cloud copy forked locally', !!fork && fork.metadata.title === 'Script A (云端冲突副本)');
  check('fork content preserved', fork?.blocks[0]?.content === 'Written on ANOTHER device.');
  check('conflict-forked event fired', events.some(e => e.type === 'conflict-forked'));

  // 4. multi-device pull
  mock.debugCreateExternal(creds.email, mk('c', 'Script C'));
  await engine.pullAll();
  const pulled = store.allScreenplayIds().map(id => store.getScreenplay(id)!).find(s => s.metadata.title === 'Script C');
  check('cloud-only script pulled', !!pulled && engine.statusOf(pulled.id) === 'synced');

  // 5. token refresh (access token now expired — TTL 150ms)
  await sleep(200);
  const list = await client.listScripts();
  check('expired access token transparently refreshed', client.isAuthenticated && list.length === 2);

  // 6. signed-out edits pause flushing; sign-in resumes and drains the outbox
  await client.logout();
  spA.blocks.push({ id: 'b4', type: 'ACTION', content: 'Edited while signed out.' });
  spA.lastModified = Date.now();
  engine.markDirty(spA);
  await engine.flush();
  check("flush skipped while signed out (stays 'dirty')", engine.statusOf(spA.id) === 'dirty');

  await client.login(creds);
  await engine.onSignedIn();
  check('sign-in drains outbox → revision 5', engine.statusOf(spA.id) === 'synced' && store.getSyncState(spA.id)?.baseRevision === 5);

  // 7. error events surfaced (network class shouldn't appear in this run)
  check('no unexpected error events', !events.some(e => e.type === 'error'));

  console.log('────────────────────────────────────────────────────');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('SMOKE CRASHED:', e);
  process.exit(1);
});
