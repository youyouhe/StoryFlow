/**
 * Reference-image library — IndexedDB persistence for the white-model
 * reference assets (数字资产). Blobs don't belong in localStorage
 * (the screenplay JSON stays exportable/clean), so images live here and the
 * prompt bindings travel inside the screenplay (Screenplay.referenceBindings).
 *
 * v4 identity model — every asset carries four identity dimensions:
 *   kind        character | environment | prop
 *   charName    character name (kind=character)
 *   variant     costume variant (战损/朝服…), optional
 *   sceneKey    owning scene heading (kind=environment)
 *   scriptIds   which screenplays the asset is pinned to ([] = global)
 * plus a version group: regenerating the same identity yields
 * versionGroup+version+isSelected — history is kept, the selected one is
 * what bindings and H3 submissions consume by default.
 *
 * `subject` remains as the DERIVED display/search string
 * (character: "名字" or "名字/装束"; prop: "道具:X"; environment: "环境").
 */

const DB_NAME = 'storyflow-refs';
// v4: identity model (kind/charName/variant/sceneKey/scriptIds/version*).
// Stores are created idempotently on whichever upgrade pass runs first.
const DB_VERSION = 4;
const STORE = 'images';
const META_STORE = 'meta';

export type AssetKind = 'character' | 'environment' | 'prop' | 'action';
export type AssetSource = 'upload' | 'ai-generate' | 'video-frame';

export interface StoredRefImage {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  blob: Blob;
  /** DERIVED display/search string — keep in sync with the identity fields. */
  subject?: string;
  // ---- identity v2 ----
  kind?: AssetKind;
  charName?: string;
  variant?: string;
  sceneKey?: string;
  scriptIds?: string[];
  // ---- versions ----
  versionGroup?: string;
  version?: number;
  isSelected?: boolean;
  // ---- provenance ----
  source?: AssetSource;
  sourcePrompt?: string;
}

export interface RefImageMetaPatch {
  name?: string;
  subject?: string;
  kind?: AssetKind;
  charName?: string;
  variant?: string;
  sceneKey?: string;
  scriptIds?: string[];
  versionGroup?: string;
  version?: number;
  isSelected?: boolean;
  source?: AssetSource;
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
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
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

// ---- identity helpers --------------------------------------------------------

/** Derive the display/search subject from structured identity fields. */
export const deriveSubject = (r: Pick<StoredRefImage, 'kind' | 'charName' | 'variant' | 'sceneKey'>): string => {
  if (r.kind === 'action') return '环境';
  if (r.kind === 'environment') return '环境';
  if (r.kind === 'prop') return `道具:${r.charName ?? ''}`;
  const base = r.charName ?? '';
  return r.variant ? `${base}/${r.variant}` : base;
};

/** Parse a legacy subject string into structured identity fields. */
export const parseLegacySubject = (subject?: string): { kind: AssetKind; charName?: string; variant?: string } => {
  const s = (subject ?? '').trim();
  if (!s || s === '环境') return { kind: 'environment' };
  if (s.startsWith('道具:')) return { kind: 'prop', charName: s.slice(3) };
  const slash = s.indexOf('/');
  if (slash > 0) return { kind: 'character', charName: s.slice(0, slash), variant: s.slice(slash + 1) };
  return { kind: 'character', charName: s };
};

/** Deterministic version-group key for an identity. */
export const computeVersionGroup = (
  identity: { kind: AssetKind; charName?: string; variant?: string; sceneKey?: string; scriptIds?: string[] },
): string =>
  ['v2', identity.kind, identity.charName ?? '', identity.variant ?? '',
    identity.kind === 'environment' ? (identity.sceneKey ?? '') : '',
    (identity.scriptIds ?? []).slice().sort().join(',')].join('|');

/** One legacy record → v4 fields (no write; listRefImages persists the result). */
const migrateRecord = (r: StoredRefImage): StoredRefImage => {
  if (r.versionGroup) return r; // already v4
  const legacy = parseLegacySubject(r.subject);
  const kind = (r.kind ?? legacy.kind) as AssetKind;
  const charName = r.charName ?? legacy.charName;
  const variant = r.variant ?? legacy.variant;
  const next: StoredRefImage = {
    ...r,
    kind,
    charName,
    variant,
    sceneKey: r.sceneKey,
    scriptIds: r.scriptIds ?? [],
    versionGroup: `vg_${r.id}`,
    version: 1,
    isSelected: true,
    subject: deriveSubject({ kind, charName, variant }),
  };
  return next;
};

/** Store an uploaded/generated file. Returns the stored record. */
export const addRefImage = async (file: File, meta?: RefImageMetaPatch): Promise<StoredRefImage> => {
  const store = await tx('readwrite');
  // Defensive: AI-generated files are named "<subject>-gen-<stamp>.<ext>" by
  // construction — if a caller dropped the subject (observed once via a stale
  // HMR closure), recover it from the name instead of storing an untagged
  // asset that smart binding can never find.
  const effective: RefImageMetaPatch = { ...meta };
  if (!effective.subject && !effective.charName && effective.source === 'ai-generate') {
    const m = file.name.match(/^(.+)-gen-[a-z0-9]+\.(?:png|jpe?g|webp)$/i);
    if (m) {
      console.warn('[refImageStore] subject missing in meta — recovered from filename:', m[1]);
      Object.assign(effective, parseLegacySubject(m[1]));
    }
  }
  if (!effective.subject && effective.charName) {
    effective.subject = deriveSubject({ kind: effective.kind ?? 'character', charName: effective.charName, variant: effective.variant });
  }
  const record: StoredRefImage = {
    id: generateId(),
    name: file.name || 'reference',
    type: file.type || 'image/*',
    size: file.size,
    createdAt: Date.now(),
    blob: file,
    kind: effective.kind ?? 'character',
    scriptIds: effective.scriptIds ?? [],
    version: effective.version ?? 1,
    isSelected: effective.isSelected ?? true,
    ...effective,
  };
  if (!record.subject) record.subject = deriveSubject(record);
  await new Promise<void>((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('put failed'));
  });
  return record;
};

/** Within a version group, mark `keepId` as the only selected version. */
export const promoteVersion = async (versionGroup: string, keepId: string): Promise<void> => {
  const store = await tx('readwrite');
  const all: StoredRefImage[] = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as StoredRefImage[]);
    req.onerror = () => reject(req.error ?? new Error('getAll failed'));
  });
  for (const r of all.filter(x => x.versionGroup === versionGroup)) {
    const want = r.id === keepId;
    if (!!r.isSelected !== want) {
      r.isSelected = want;
      await new Promise<void>((resolve, reject) => {
        const req = store.put(r);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error('put failed'));
      });
    }
  }
};

/** Update an image's metadata without touching the blob. Editing `subject`
 *  re-derives the structured identity (supports the 名字/装束 convention). */
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
    ...('kind' in patch ? { kind: patch.kind } : {}),
    ...('charName' in patch ? { charName: patch.charName || undefined } : {}),
    ...('variant' in patch ? { variant: patch.variant || undefined } : {}),
    ...('sceneKey' in patch ? { sceneKey: patch.sceneKey || undefined } : {}),
    ...('scriptIds' in patch ? { scriptIds: patch.scriptIds ?? [] } : {}),
    ...('isSelected' in patch ? { isSelected: !!patch.isSelected } : {}),
    ...('source' in patch ? { source: patch.source } : {}),
    ...('sourcePrompt' in patch ? { sourcePrompt: patch.sourcePrompt || undefined } : {}),
  };
  if ('subject' in patch && patch.subject) {
    Object.assign(next, parseLegacySubject(patch.subject));
  }
  if (!next.versionGroup) {
    next.versionGroup = `vg_${next.id}`;
    next.version = next.version ?? 1;
    next.isSelected = true;
  }
  next.subject = deriveSubject(next);
  await new Promise<void>((resolve, reject) => {
    const req = store.put(next);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('put failed'));
  });
  return next;
};

/** List all images (oldest first), migrating legacy records to the v4
 *  identity model in place on first sight. */
export const listRefImages = async (): Promise<StoredRefImage[]> => {
  const store = await tx('readonly');
  const raw: StoredRefImage[] = await new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as StoredRefImage[]);
    req.onerror = () => reject(req.error ?? new Error('getAll failed'));
  });
  const migrated: StoredRefImage[] = [];
  const out = raw
    .map((r0) => {
      const r = migrateRecord(r0);
      if (r !== r0) migrated.push(r);
      return r;
    })
    .map((r) => ({ ...r, source: (r.source ?? 'upload') as AssetSource }))
    .sort((a, b) => a.createdAt - b.createdAt);
  if (migrated.length) {
    const wtx = dbPromise ? await (await openDB()).transaction(STORE, 'readwrite') : null;
    const wstore = wtx?.objectStore(STORE);
    if (wstore) for (const r of migrated) wstore.put(r);
  }
  return out;
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
