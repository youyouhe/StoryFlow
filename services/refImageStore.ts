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
const DB_VERSION = 1;
const STORE = 'images';

export interface StoredRefImage {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

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
export const addRefImage = async (file: File): Promise<StoredRefImage> => {
  const store = await tx('readwrite');
  const record: StoredRefImage = {
    id: generateId(),
    name: file.name || 'reference',
    type: file.type || 'image/*',
    size: file.size,
    createdAt: Date.now(),
    blob: file,
  };
  await new Promise<void>((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('put failed'));
  });
  return record;
};

/** List all images, oldest first (stable upload-order numbering). */
export const listRefImages = async (): Promise<StoredRefImage[]> => {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as StoredRefImage[]).sort((a, b) => a.createdAt - b.createdAt));
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
