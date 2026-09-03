/**
 * Reference-image library — IndexedDB persistence for the white-model
 * reference assets (角色/场景参考图). Blobs don't belong in localStorage
 * (the screenplay JSON stays exportable/clean), so images live here and the
 * prompt bindings (which ARE tiny) live in localStorage per script.
 *
 * Global library (shared across scripts); bindings are per-screenplay:
 * `ref_bindings_{scriptId}` -> RefBindings (see types.ts).
 *
 * Minimal hand-rolled IndexedDB wrapper — no dependency, promise-based.
 */

const DB_NAME = 'storyflow-refs';
// v3 history: v2 added the 'meta' store (asset-dir handle persistence) — but
// a DB upgraded 0->2 by assetDirStore first never runs refImageStore's
// upgrade, so 'images' was never created and every asset write died with
// NotFoundError (found live). v3 forces one more upgrade pass; both stores
// are created idempotently, whichever module opens first.
const DB_VERSION = 3;
const STORE = 'images';

export interface StoredRefImage {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  blob: Blob;
  /** Global identity axis for smart binding: character name / "环境" / "道具:X". */
  subject?: string;
  /** Provenance: how the asset entered the library. */
  source?: 'upload' | 'ai-generate' | 'video-frame';
  /** For AI-generated assets: the prompt that produced them (traceability). */
  sourcePrompt?: string;
}

export interface RefImageMetaPatch {
  name?: string;
  subject?: string;
  source?: StoredRefImage['source'];
  sourcePrompt?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Shared opener — assetDirStore uses the same DB for its 'meta' store. */
export const openRefsDB = (): Promise<IDBDatabase> => openDB();

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
};

const tx = async (mode: IDBTransactionMode) => {
  const db = await openDB();
  return db.transaction(STORE, mode).objectStore(STORE);
};

const generateId = () => Math.random().toString(36).substring(2, 11) + Date.now().toString(36);

/** Store an uploaded file. Returns the stored record. */
export const addRefImage = async (file: File, meta?: RefImageMetaPatch): Promise<StoredRefImage> => {
  const store = await tx('readwrite');
  // Defensive: AI-generated files are named "<subject>-gen-<stamp>.<ext>" by
  // construction — if a caller dropped the subject (observed once via a stale
  // HMR closure), recover it from the name instead of storing an untagged
  // asset that smart binding can never find.
  const effective: RefImageMetaPatch = { ...meta };
  if (!effective.subject && effective.source === 'ai-generate') {
    const m = file.name.match(/^(.+)-gen-[a-z0-9]+\.(?:png|jpe?g|webp)$/i);
    if (m) {
      effective.subject = m[1];
      console.warn('[refImageStore] subject missing in meta — recovered from filename:', m[1]);
    }
  }
  const record: StoredRefImage = {
    id: generateId(),
    name: file.name || 'reference',
    type: file.type || 'image/*',
    size: file.size,
    createdAt: Date.now(),
    blob: file,
    ...effective,
  };
  await new Promise<void>((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('put failed'));
  });
  return record;
};

/** Update an image's metadata (name/subject/source) without touching the
 *  blob — reads the existing record, merges, puts it back. */
export const updateRefImageMeta = async (id: string, patch: RefImageMetaPatch): Promise<StoredRefImage | null> => {
  const store = await tx('readwrite');
  const existing: StoredRefImage | undefined = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as StoredRefImage | undefined);
    req.onerror = () => reject(req.error ?? new Error('get failed'));
  });
  if (!existing) return null;
  const next: StoredRefImage = {
    ...existing,
    ...('name' in patch ? { name: patch.name! } : {}),
    ...('subject' in patch ? { subject: patch.subject || undefined } : {}),
    ...('source' in patch ? { source: patch.source } : {}),
    ...('sourcePrompt' in patch ? { sourcePrompt: patch.sourcePrompt || undefined } : {}),
  };
  await new Promise<void>((resolve, reject) => {
    const req = store.put(next);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('put failed'));
  });
  return next;
};

/** List all images, oldest first (stable upload-order numbering). Records
 *  written before the subject/source fields existed normalize to 'upload'. */
export const listRefImages = async (): Promise<StoredRefImage[]> => {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(
      (req.result as StoredRefImage[])
        .map((r) => ({ ...r, source: r.source ?? 'upload' as const }))
        .sort((a, b) => a.createdAt - b.createdAt),
    );
    req.onerror = () => reject(req.error ?? new Error('getAll failed'));
  });
};

/** Delete one image by id. */
export const removeRefImage = async (id: string): Promise<void> => {
  const store = await tx('readwrite');
  await new Promise<void>((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('delete failed'));
  });
};
