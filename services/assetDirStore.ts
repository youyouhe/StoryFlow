/**
 * Directory-backed asset store — the "backend" is a folder on the user's own
 * disk (point it at a synced drive — 坚果云/OneDrive/Syncthing — and it
 * becomes a free cross-device asset backend; the 181 agent and the
 * workstation see the same folder).
 *
 * Built on the File System Access API (Chrome/Edge, SECURE CONTEXT ONLY —
 * on the LAN-IP setup or Firefox/Safari the app falls back to the IndexedDB
 * store in refImageStore.ts).
 *
 * Layout inside the chosen folder:
 *   <chosen-dir>/
 *     manifest.json          ← source of truth: ids, display names,
 *     <id>.<ext>               subjects, sources (structured-clone persisted
 *                               handle re-opens it across sessions)
 *
 * Image files not yet in the manifest are auto-adopted on scan (subject
 * empty — tag them in the library UI).
 */

import { RefImageMetaPatch, openRefsDB } from './refImageStore';

export interface DirAssetMeta {
  id: string;
  fileName: string;
  name: string;
  subject?: string;
  /** Identity v2 (mirrors StoredRefImage). */
  kind?: 'character' | 'environment' | 'prop' | 'action';
  charName?: string;
  variant?: string;
  sceneKey?: string;
  scriptIds?: string[];
  versionGroup?: string;
  version?: number;
  isSelected?: boolean;
  source?: 'upload' | 'ai-generate' | 'video-frame';
  sourcePrompt?: string;
  size: number;
  createdAt: number;
}

interface DirManifest {
  version: 1;
  assets: DirAssetMeta[];
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

export const isDirStoreAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

const MANIFEST = 'manifest.json';
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

const newId = () => Math.random().toString(36).substring(2, 11) + Date.now().toString(36);

// ---- directory handle persistence (IndexedDB — handles are cloneable) ------

const HANDLE_DB = 'storyflow-refs';
const HANDLE_STORE = 'meta';
const HANDLE_KEY = 'assetDir';

export const persistDirHandle = async (h: FileSystemDirectoryHandle): Promise<void> => {
  const db = await openRefsDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).put(h, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const loadPersistedDirHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const db = await openRefsDB();
    return await new Promise((resolve) => {
      const get = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(HANDLE_KEY);
      get.onsuccess = () => resolve((get.result as FileSystemDirectoryHandle) ?? null);
      get.onerror = () => resolve(null);
    });
  } catch { return null; }
};

export const forgetDirHandle = async (): Promise<void> => {
  try {
    const db = await openRefsDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* nothing to forget */ }
};

// ---- permissions -----------------------------------------------------------

export type DirPermission = 'granted' | 'prompt' | 'denied';

export const queryDirPermission = async (h: FileSystemDirectoryHandle): Promise<DirPermission> => {
  try {
    const p = await (h as unknown as { queryPermission: (d: { mode: 'readwrite' }) => Promise<PermissionState> })
      .queryPermission({ mode: 'readwrite' });
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
  } catch { return 'prompt'; }
};

/** Must be called from a user gesture (button click). */
export const requestDirPermission = async (h: FileSystemDirectoryHandle): Promise<boolean> => {
  try {
    const p = await (h as unknown as { requestPermission: (d: { mode: 'readwrite' }) => Promise<PermissionState> })
      .requestPermission({ mode: 'readwrite' });
    return p === 'granted';
  } catch { return false; }
};

// ---- manifest --------------------------------------------------------------

const readManifest = async (dir: FileSystemDirectoryHandle): Promise<DirManifest> => {
  try {
    const fh = await dir.getFileHandle(MANIFEST);
    const text = await (await fh.getFile()).text();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.assets)) return { version: 1, assets: parsed.assets };
  } catch { /* absent or corrupt — start fresh */ }
  return { version: 1, assets: [] };
};

const writeManifest = async (dir: FileSystemDirectoryHandle, m: DirManifest): Promise<void> => {
  const fh = await dir.getFileHandle(MANIFEST, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(m, null, 2));
  await w.close();
};

// ---- operations ------------------------------------------------------------

/** Pick a folder (user gesture required). Returns null when cancelled. */
export const pickAssetDir = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (!isDirStoreAvailable()) return null;
  try {
    return await window.showDirectoryPicker!({ id: 'storyflow-assets', mode: 'readwrite' });
  } catch { return null; } // user cancelled
};

export interface DirAsset extends DirAssetMeta {
  url: string; // session object URL from the file
}

/** Scan the folder: adopt unknown image files, load blobs as object URLs. */
export const listDirAssets = async (dir: FileSystemDirectoryHandle): Promise<DirAsset[]> => {
  const manifest = await readManifest(dir);
  const known = new Set(manifest.assets.map((a) => a.fileName));
  const adopted: DirAssetMeta[] = [];
  const out: DirAsset[] = [];

  for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind !== 'file' || name === MANIFEST || !IMAGE_RE.test(name)) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    if (!known.has(name)) {
      const meta: DirAssetMeta = {
        id: newId(),
        fileName: name,
        name,
        kind: 'environment',
        source: 'upload',
        size: file.size,
        createdAt: file.lastModified || Date.now(),
      };
      manifest.assets.push(meta);
      adopted.push(meta);
    }
  }
  if (adopted.length) await writeManifest(dir, manifest);

  for (const meta of manifest.assets) {
    try {
      const fh = await dir.getFileHandle(meta.fileName);
      const file = await fh.getFile();
      out.push({ ...meta, url: URL.createObjectURL(file) });
    } catch { /* file was moved/deleted externally — skip */ }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
};

/** Write a file into the folder + record it in the manifest. */
export const addAssetToDir = async (
  dir: FileSystemDirectoryHandle,
  file: File,
  meta?: RefImageMetaPatch,
): Promise<DirAsset> => {
  const id = newId();
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? `.${(file.type.split('/')[1] || 'png')}`).toLowerCase();
  const fileName = `${id}${ext}`;
  const fh = await dir.getFileHandle(fileName, { create: true });
  const w = await fh.createWritable();
  await w.write(file);
  await w.close();

  const manifest = await readManifest(dir);
  const entry: DirAssetMeta = {
    id,
    fileName,
    name: meta?.name || file.name || 'reference',
    subject: meta?.subject,
    kind: meta?.kind ?? 'character',
    charName: meta?.charName,
    variant: meta?.variant,
    sceneKey: meta?.sceneKey,
    scriptIds: meta?.scriptIds ?? [],
    versionGroup: meta?.versionGroup ?? `vg_${id}`,
    version: meta?.version ?? 1,
    isSelected: meta?.isSelected ?? true,
    source: meta?.source ?? 'upload',
    sourcePrompt: meta?.sourcePrompt,
    size: file.size,
    createdAt: Date.now(),
  };
  manifest.assets.push(entry);
  await writeManifest(dir, manifest);
  return { ...entry, url: URL.createObjectURL(file) };
};

export const updateAssetMetaInDir = async (
  dir: FileSystemDirectoryHandle,
  id: string,
  patch: RefImageMetaPatch,
): Promise<void> => {
  const manifest = await readManifest(dir);
  const idx = manifest.assets.findIndex((a) => a.id === id);
  if (idx < 0) return;
  manifest.assets[idx] = {
    ...manifest.assets[idx],
    ...('name' in patch ? { name: patch.name! } : {}),
    ...('subject' in patch ? { subject: patch.subject || undefined } : {}),
    ...('source' in patch ? { source: patch.source } : {}),
    ...('sourcePrompt' in patch ? { sourcePrompt: patch.sourcePrompt || undefined } : {}),
  };
  await writeManifest(dir, manifest);
};

export const removeAssetFromDir = async (dir: FileSystemDirectoryHandle, id: string): Promise<void> => {
  const manifest = await readManifest(dir);
  const entry = manifest.assets.find((a) => a.id === id);
  if (!entry) return;
  manifest.assets = manifest.assets.filter((a) => a.id !== id);
  await writeManifest(dir, manifest);
  try { await dir.removeEntry(entry.fileName); } catch { /* already gone */ }
};
