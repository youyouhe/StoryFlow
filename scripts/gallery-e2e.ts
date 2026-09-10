/**
 * P2 client-stack e2e: browse public feed → fork → materialize locally.
 * Requires the backend running (GALLERY_URL, default http://127.0.0.1:8787).
 *
 *   npx esbuild scripts/gallery-e2e.ts --bundle --platform=node --format=esm \
 *     --outfile=/tmp/opencode/gallery-e2e.mjs && node /tmp/opencode/gallery-e2e.mjs
 */

const BASE = process.env.GALLERY_URL ?? 'http://127.0.0.1:8787';

const mem = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k)
};

let failures = 0;
const check = (name: string, cond: boolean) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}`);
  }
};

async function main() {
  const { GalleryClient, HttpGalleryApi } = await import('../services/apiClient');
  type Screenplay = import('../types').Screenplay;

  const mk = (title: string, marker: string): Screenplay => ({
    id: `local-${Math.random().toString(36).slice(2, 8)}`,
    metadata: { title, author: 'P2E2E', draft: 'v1', templateId: 'standard', scriptLanguage: 'zh' },
    lastModified: Date.now(),
    blocks: [{ id: 'b1', type: 'ACTION', content: marker }],
    referenceBindings: { characters: {} }
  });

  console.log(`── Gallery P2 client e2e (${BASE}) ─────────────────`);

  const alice = new GalleryClient(new HttpGalleryApi(BASE));
  const bob = new GalleryClient(new HttpGalleryApi(BASE));
  const t = Date.now();

  // 4A 完全替代: identity comes from the sso_token exchange. The server must
  // run with AUTH_VERIFY_URL pointing at a stub that accepts these tokens.
  await alice.ssoExchange(`ga-${t}`);
  await bob.ssoExchange(`gb-${t}`);

  // Alice publishes a script
  const created = await alice.createScript(mk('P2 Public Piece', 'e2e-marker-42'), crypto.randomUUID());
  await alice.setVisibility(created.id, 'public');

  // Bob browses the feed
  const feed = await bob.galleryList();
  check('feed contains Alice\u0027s public piece', feed.some(c => c.id === created.id && c.ownerName === 'Alice'));
  const searched = await bob.galleryList('P2 Public');
  check('search narrows to it', searched.some(c => c.id === created.id));

  // Bob previews the detail
  const detail = await bob.galleryGet(created.id);
  check('detail doc lossless', detail.doc.blocks[0]?.content === 'e2e-marker-42');

  // Bob forks + materializes locally (GalleryModal flow)
  const fork = await bob.forkScript(created.id, crypto.randomUUID());
  const full = await bob.getScript(fork.id);
  check('fork lands in bob\u0027s cloud list as private', (await bob.listScripts()).some(s => s.id === fork.id && s.visibility === 'private'));
  check(
    'fork row titled, doc lossless',
    full.script.title === 'P2 Public Piece (fork)' && full.doc.blocks[0]?.content === 'e2e-marker-42'
  );

  // Local materialization path (what syncStore does)
  const localId = `local-${Math.random().toString(36).slice(2, 8)}`;
  const localDoc: Screenplay = { ...full.doc, id: localId, lastModified: Date.now() };
  check('local copy shape ok', !!localDoc.metadata?.title && Array.isArray(localDoc.blocks));

  // Bob changes his mind → visibility switch on his own fork (private↔public)
  const pv = await bob.setVisibility(fork.id, 'public');
  check('bob publishes his fork', pv.visibility === 'public');
  check('fork now visible in feed', (await bob.galleryList()).some(c => c.id === fork.id));

  console.log('────────────────────────────────────────────────────');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('E2E CRASHED:', e);
  process.exit(1);
});
