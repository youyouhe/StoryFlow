import { useState, useEffect, useCallback } from 'react';
import { RefBindings, RefImage } from '../types';
import { shipLog } from '../services/debugLog';
import { listRefImages, addRefImage, updateRefImageMeta, removeRefImage as removeStoredRefImage, computeVersionGroup, promoteVersion, RefImageMetaPatch } from '../services/refImageStore';
import {
  isDirStoreAvailable, pickAssetDir, persistDirHandle, loadPersistedDirHandle,
  queryDirPermission, requestDirPermission, listDirAssets, addAssetToDir,
  updateAssetMetaInDir, removeAssetFromDir, mergeIdbIntoDir,
} from '../services/assetDirStore';

/** Full-field mapper — every library-loading path MUST carry the v2 identity
 *  fields (kind/charName/variant/sceneKey/scriptIds/version*), or category
 *  tabs, script filters and version badges silently break (live bug). */
const toRefImage = (s: {
  id: string; name: string; size: number; createdAt: number;
  blob?: Blob; url?: string; type?: string;
  subject?: string; kind?: RefImage['kind']; charName?: string; variant?: string;
  sceneKey?: string; scriptIds?: string[]; versionGroup?: string; version?: number;
  isSelected?: boolean; source?: RefImage['source']; sourcePrompt?: string;
}): RefImage => ({
  id: s.id,
  name: s.name,
  type: s.type ?? (s.blob?.type || 'image/*'),
  size: s.size,
  createdAt: s.createdAt,
  url: s.url ?? (s.blob ? URL.createObjectURL(s.blob) : ''),
  subject: s.subject,
  kind: s.kind,
  charName: s.charName,
  variant: s.variant,
  sceneKey: s.sceneKey,
  scriptIds: s.scriptIds ?? [],
  versionGroup: s.versionGroup,
  version: s.version,
  isSelected: s.isSelected,
  source: s.source ?? 'upload',
  sourcePrompt: s.sourcePrompt,
});

/**
 * The REFERENCE-ASSET LIBRARY state domain: the reference images (IndexedDB
 * or a folder backend), the directory handle and every library mutation.
 *
 * Extracted verbatim from App.tsx (wave 1 of the App split). The library load
 * effect, upload/update/remove/switch/rescan handlers keep their exact
 * dependency arrays — screenplay identity, current bindings and the binding
 * writer arrive as parameters because removal scrubs stale bindings.
 */
export function useRefAssetLibrary({ scriptId, referenceBindings, onBindingsChange }: {
  scriptId: string;
  referenceBindings: RefBindings | undefined;
  onBindingsChange: (next: RefBindings) => void;
}) {
  // White-model reference-image library (global, IndexedDB-backed). Blobs stay
  // out of the screenplay JSON so exports remain clean; object URLs are
  // session-only.
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  // Directory-backed asset backend (File System Access API). Null = IndexedDB
  // fallback (LAN-IP context / Firefox / Safari / not picked yet).
  const [assetDir, setAssetDir] = useState<FileSystemDirectoryHandle | null>(null);

  // Library load: prefer the persisted asset FOLDER (cross-device "backend"),
  // fall back to IndexedDB. Object URLs are session-scoped.
  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    (async () => {
      try {
        const h = await loadPersistedDirHandle();
        if (h && (await queryDirPermission(h)) === 'granted') {
          const assets = await listDirAssets(h);
          if (cancelled) return;
          setAssetDir(h);
          setRefImages(assets.map((a) => toRefImage(a)));
          return;
        }
      } catch { /* dir unreadable — fall through */ }
      const stored = await listRefImages().catch(() => []);
      if (cancelled) return;
      const mapped = stored.map((s) => toRefImage(s));
      urls.push(...mapped.map((m) => m.url));
      setRefImages(mapped);
    })();
    return () => { cancelled = true; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  const handleUploadRefImage = useCallback(async (
    file: File,
    subject?: string,
    sourcePrompt?: string,
    source: 'upload' | 'ai-generate' | 'video-frame' = 'upload',
    identity?: { kind: 'character' | 'environment' | 'prop' | 'action'; charName?: string; variant?: string; sceneKey?: string },
  ): Promise<string | null> => {
    // v2 identity: pin to the current script; same-identity regenerations join
    // one version group (history kept, the newest becomes the selected one).
    const kind = identity?.kind ?? 'environment';
    const scriptIds = [scriptId];
    const versionGroup = computeVersionGroup({ kind, charName: identity?.charName ?? subject, variant: identity?.variant, sceneKey: identity?.sceneKey, scriptIds });
    const siblings = refImages.filter(r => r.versionGroup === versionGroup);
    const version = siblings.length ? Math.max(...siblings.map(r => r.version ?? 1)) + 1 : 1;
    const meta: RefImageMetaPatch = {
      subject, source, sourcePrompt,
      kind, charName: identity?.charName, variant: identity?.variant, sceneKey: identity?.sceneKey,
      scriptIds, versionGroup, version, isSelected: true,
    };
    try {
      if (assetDir) {
        const a = await addAssetToDir(assetDir, file, meta);
        setRefImages((prev) => [...prev.map(r => r.versionGroup === versionGroup ? { ...r, isSelected: false } : r), {
          id: a.id, name: a.name, type: file.type || 'image/*', size: a.size, createdAt: a.createdAt,
          url: a.url, subject: a.subject, source: a.source ?? 'upload', sourcePrompt: a.sourcePrompt,
          kind: a.kind, charName: a.charName, variant: a.variant, sceneKey: a.sceneKey, scriptIds: a.scriptIds,
          versionGroup: a.versionGroup, version: a.version, isSelected: a.isSelected ?? true,
        }]);
        if (siblings.length) promoteVersion(versionGroup, a.id).catch(() => {});
        return a.id;
      } else {
        const stored = await addRefImage(file, meta);
        setRefImages((prev) => [...prev.map(r => r.versionGroup === versionGroup ? { ...r, isSelected: false } : r), {
          id: stored.id, name: stored.name, type: stored.type, size: stored.size, createdAt: stored.createdAt,
          url: URL.createObjectURL(stored.blob),
          subject: stored.subject, source: stored.source ?? 'upload', sourcePrompt: stored.sourcePrompt,
          kind: stored.kind, charName: stored.charName, variant: stored.variant, sceneKey: stored.sceneKey, scriptIds: stored.scriptIds,
          versionGroup: stored.versionGroup, version: stored.version, isSelected: stored.isSelected ?? true,
        }]);
        if (siblings.length) promoteVersion(versionGroup, stored.id).catch(() => {});
        return stored.id;
      }
    } catch (e) {
      console.warn('Failed to store reference image', e); shipLog("asset", "error", "Failed to store reference image", e);
      return null;
    }
  }, [assetDir, scriptId, refImages]);

  /** Library metadata edits (rename / re-tag subject) — persisted, UI state synced. */
  const handleUpdateRefImageMeta = useCallback((id: string, patch: { name?: string; subject?: string }) => {
    setRefImages((prev) => prev.map((im) => im.id === id ? { ...im, ...patch, subject: patch.subject || undefined } : im));
    if (assetDir) updateAssetMetaInDir(assetDir, id, patch).catch((e) => console.warn('Failed to update asset meta', e));
    else updateRefImageMeta(id, patch).catch((e) => console.warn('Failed to update asset meta', e));
  }, [assetDir]);

  /** User gesture: pick/restore the asset folder (the disk "backend"). */
  const handleOpenAssetDir = useCallback(async () => {
    if (!isDirStoreAvailable()) {
      alert('当前环境不支持文件夹资产库（需要 Chrome/Edge + localhost 或 HTTPS）。已使用浏览器本地存储。');
      return;
    }
    const h = assetDir ?? await pickAssetDir();
    if (!h) return;
    if ((await queryDirPermission(h)) !== 'granted') {
      if (!(await requestDirPermission(h))) return;
    }
    try {
      await persistDirHandle(h);
      // One-time migration: bring the browser-storage library (with identity,
      // versions, provenance) into the folder. Idempotent by asset id.
      let migratedNote = '';
      try {
        const idbRecords = await listRefImages();
        const n = await mergeIdbIntoDir(h, idbRecords);
        if (n) migratedNote = `（已自动迁移 ${n} 张浏览器存量资产）`;
      } catch (e) {
        console.warn('IDB→folder migration failed', e);
      }
      const assets = await listDirAssets(h);
      setAssetDir(h);
      if (migratedNote) console.info('[assets]', migratedNote);
      setRefImages(assets.map((a) => toRefImage(a)));
    } catch (e) {
      console.warn('Failed to open asset folder', e); shipLog("asset", "error", "Failed to open asset folder", e);
    }
  }, [assetDir]);

  /** Switch the asset folder to a DIFFERENT directory. Unlike
   *  handleOpenAssetDir (first-time adopt, which migrates browser-storage
   *  assets in), switching re-points the library at the newly picked folder
   *  and reloads its contents — no migration, no side effects on the old
   *  folder. */
  const handleSwitchAssetDir = useCallback(async () => {
    if (!isDirStoreAvailable()) {
      alert('当前环境不支持文件夹资产库（需要 Chrome/Edge + localhost 或 HTTPS）。');
      return;
    }
    const h = await pickAssetDir();
    if (!h) return;
    if ((await queryDirPermission(h)) !== 'granted') {
      if (!(await requestDirPermission(h))) return;
    }
    try {
      await persistDirHandle(h);
      const assets = await listDirAssets(h);
      setAssetDir(h);
      setRefImages(assets.map((a) => toRefImage(a)));
    } catch (e) {
      console.warn('Failed to switch asset folder', e); shipLog("asset", "error", "Failed to switch asset folder", e);
    }
  }, []);

  /** Re-scan the asset store — manual button + auto-triggered when a phone
   *  drop (LocalSend) lands new files or a cloud download imports locally. */
  const reloadAssets = useCallback(async () => {
    if (!assetDir) {
      // IndexedDB backend: re-read the store into display state.
      const stored = await listRefImages().catch(() => []);
      setRefImages(stored.map((s) => toRefImage(s)));
      return;
    }
    try {
      const assets = await listDirAssets(assetDir);
      setRefImages(assets.map((a) => toRefImage(a)));
    } catch (e) {
      console.warn('Failed to rescan asset folder', e); shipLog("asset", "warn", "Failed to rescan asset folder", e);
    }
  }, [assetDir]);

  const handleRemoveRefImage = useCallback((id: string) => {
    if (assetDir) removeAssetFromDir(assetDir, id).catch((e) => console.warn('Failed to delete asset file', e));
    else removeStoredRefImage(id).catch((e) => console.warn('Failed to delete reference image', e));
    setRefImages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
    // scrub bindings pointing at the removed image
    if (referenceBindings) {
      const prev = referenceBindings;
      const characters = Object.fromEntries(Object.entries(prev.characters).filter(([, v]) => v !== id));
      const environment = prev.environment === id ? undefined : prev.environment;
      onBindingsChange({ characters, environment });
    }
  }, [assetDir, referenceBindings, onBindingsChange]);

  return {
    refImages, setRefImages,
    assetDir,
    handleUploadRefImage,
    handleUpdateRefImageMeta,
    handleOpenAssetDir,
    handleSwitchAssetDir,
    reloadAssets,
    handleRemoveRefImage,
  };
}
