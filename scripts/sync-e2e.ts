/**
 * Client-stack end-to-end test: GalleryClient + SyncEngine + HttpGalleryApi
 * against the REAL server (default http://localhost:8787).
 *
 *   npx esbuild scripts/sync-e2e.ts --bundle --platform=node --format=esm \
 *     --outfile=/tmp/opencode/sync-e2e.mjs && node /tmp/opencode/sync-e2e.mjs
 */

const BASE = process.env.GALLERY_URL ?? 'http://localhost:8787';

// localStorage shim — GalleryClient persists tokens there (node has none).
const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k)
};

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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function main() {
  const { GalleryClient, HttpGalleryApi } = await import('../services/apiClient');
  const { SyncEngine } = await import('../services/syncEngine');
  type SyncStoreAdapter = import('../services/syncEngine').SyncStoreAdapter;
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
    metadata: { title, author: 'E2E', draft: 'v1', templateId: 'standard', scriptLanguage: 'zh' },
    lastModified: Date.now(),
    blocks: [{ id: 'b1', type: 'ACTION', content: `${title} opening.`, imagePrompt: 'KEEP-ME' }]
  });

  console.log(`── Client↔Server E2E (${BASE}) ─────────────────────`);

  const client = new GalleryClient(new HttpGalleryApi(BASE));
  const store = new MemoryStore();
  const engine = new SyncEngine(client, store, { flushDelayMs: 20 });

  const user = await client.ssoExchange(`e2e-${Date.now()}`);
  check('ssoExchange over HTTP', client.isAuthenticated);

  // second "device": its own client session (fresh exchange), pushing behind the engine's back
  const second = new GalleryClient(new HttpGalleryApi(BASE));
  await second.ssoExchange(`e2e-2-${Date.now()}`);
  check('second device logged in', second.isAuthenticated);

  // create + first push
  const spA = mk('a', 'E2E Script');
  store.putScreenplay(spA);
  await engine.syncNow(spA.id);
  check('syncNow → synced rev1', engine.statusOf(spA.id) === 'synced' && store.getSyncState(spA.id)?.baseRevision === 1);

  // edit → auto push
  spA.blocks.push({ id: 'b2', type: 'DIALOGUE', content: 'second beat' });
  engine.markDirty(spA);
  const t0 = Date.now();
  while (engine.statusOf(spA.id) !== 'synced' && Date.now() - t0 < 3000) await sleep(20);
  check('edit auto-flushed → rev2', store.getSyncState(spA.id)?.baseRevision === 2);

  // (second device session already established above via ssoExchange)
  await second.pushScript(engine.cloudIdOf(spA.id)!, 2, {
    ...mk('x', 'E2E Script'),
    blocks: [{ id: 'x1', type: 'ACTION', content: 'from device 2' }]
  } as Screenplay);

  // local edit → 409 → fork + accept-and-overwrite
  spA.blocks.push({ id: 'b3', type: 'ACTION', content: 'local edit on top' });
  engine.markDirty(spA);
  const t1 = Date.now();
  while (engine.statusOf(spA.id) !== 'synced' && Date.now() - t1 < 4000) await sleep(20);
  check('conflict resolved → synced at rev4', engine.statusOf(spA.id) === 'synced' && store.getSyncState(spA.id)?.baseRevision === 4);
  const fork = store.allScreenplayIds().map(id => store.getScreenplay(id)!).find(s => s.id !== spA.id);
  check('cloud copy forked with suffix', !!fork && fork.metadata.title === 'E2E Script (云端冲突副本)');
  check('fork keeps device-2 content', fork?.blocks?.[0]?.content === 'from device 2');

  // pullAll: second device created a script we don't have
  const pulled = mk('c', 'E2E From Cloud');
  const cloudId = await second.createScript(pulled, `e2e-pull-${Date.now()}`);
  await engine.pullAll();
  const gotPull = store.allScreenplayIds().map(id => store.getScreenplay(id)!).find(s => s.metadata.title === 'E2E From Cloud');
  check('pullAll imported cloud-only script', !!gotPull && engine.statusOf(gotPull.id) === 'synced');
  void cloudId;

  console.log('────────────────────────────────────────────────────');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('E2E CRASHED:', e);
  process.exit(1);
});
