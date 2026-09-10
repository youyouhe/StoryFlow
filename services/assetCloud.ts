/**
 * Cloud asset sync (P3) — bridges the local IndexedDB library and the
 * Gallery cloud asset store.
 *
 * Mapping: localStorage `asset_cloud_map` = { localId: { cloudId, uploadedAt } }.
 * Content addressing via sha256 — the server dedupes per owner, so re-uploads
 * are idempotent. Thumbnails are generated client-side (canvas → webp dataURL)
 * so the server never touches full-size media.
 */
import { galleryClient } from './gallery';
import { isGalleryApiError } from './apiClient';
import type { AssetKind, CloudAsset } from './apiClient';

const MAP_KEY = 'asset_cloud_map';

interface MapEntry {
  cloudId: string;
  uploadedAt: number;
}

type CloudMap = Record<string, MapEntry>;

function readMap(): CloudMap {
  try {
    return JSON.parse(localStorage.getItem(MAP_KEY) || '{}') as CloudMap;
  } catch {
    return {};
  }
}

function writeMap(m: CloudMap): void {
  localStorage.setItem(MAP_KEY, JSON.stringify(m));
}

export function getCloudIdFor(localId: string): string | null {
  return readMap()[localId]?.cloudId ?? null;
}

export function uploadedLocalIds(): Set<string> {
  return new Set(Object.keys(readMap()));
}

function recordUpload(localId: string, cloudId: string): void {
  const m = readMap();
  m[localId] = { cloudId, uploadedAt: Date.now() };
  writeMap(m);
}

export async function sha256Of(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Downscale to a webp thumbnail (dataURL) + natural dimensions. */
export async function thumbnailFromBlob(
  blob: Blob,
  maxW = 320
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (!blob.type.startsWith('image/')) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image decode failed'));
      el.src = url;
    });
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/webp', 0.75), width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface UploadSource {
  localId: string;
  blob: Blob;
  name: string;
  kind?: AssetKind;
  meta?: Record<string, unknown>;
}

/** Full pipeline: sha → upload-url → PUT → finalize (with thumb) → record map. */
export async function uploadLocalAsset(src: UploadSource): Promise<{ cloudId: string; deduplicated: boolean }> {
  const kind: AssetKind = src.kind ?? (src.blob.type.startsWith('video/') ? 'video' : 'image');
  const sha256 = await sha256Of(src.blob);
  const up = await galleryClient.assetUploadUrl({
    kind,
    mime: src.blob.type || 'application/octet-stream',
    size: src.blob.size,
    sha256,
    name: src.name
  });
  if (up.deduplicated) {
    recordUpload(src.localId, up.assetId);
    return { cloudId: up.assetId, deduplicated: true };
  }
  if (up.upload) {
    await galleryClient.assetPutBytes(up.upload, new Uint8Array(await src.blob.arrayBuffer()));
  }
  const thumb = kind === 'image' ? await thumbnailFromBlob(src.blob) : null;
  await galleryClient.assetFinalize(up.assetId, {
    thumbDataUrl: thumb?.dataUrl,
    width: thumb?.width,
    height: thumb?.height,
    meta: src.meta
  });
  recordUpload(src.localId, up.assetId);
  return { cloudId: up.assetId, deduplicated: false };
}

/** Fetch raw bytes of a cloud asset as a Blob (for import into the local library). */
export async function downloadCloudBlob(cloudId: string): Promise<{
  blob: Blob; asset: CloudAsset | null;
  /** Set when the fetch was credit-gated: consume ran first, then the retry. */
  purchased?: boolean;
  /** Thrown as GalleryApiError('INSUFFICIENT_CREDITS') when balance is short. */
}> {
  const attempt = (grant?: string) => galleryClient.assetBytes(cloudId, false, grant);
  let bytes: Uint8Array;
  let purchased = false;
  try {
    bytes = await attempt();
  } catch (e) {
    if (!isGalleryApiError(e) || e.code !== 'CREDITS_REQUIRED') throw e;
    // Gated asset: consume credits (server releases the grant), then retry.
    const consume = await galleryClient.consumeCredit(cloudId);
    if (!consume.grantToken) throw e; // free/owner race — shouldn't happen
    purchased = consume.charged;
    bytes = await attempt(consume.grantToken);
  }
  let asset: CloudAsset | null = null;
  try {
    const all = await galleryClient.listAssets();
    asset = all.find(a => a.id === cloudId) ?? null;
  } catch { /* meta is optional for the download itself */ }
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: asset?.mime ?? 'application/octet-stream' }),
    asset,
    purchased
  };
}

/** Object URL for display (thumb first, raw fallback) — caller revokes. */
export async function cloudObjectUrl(cloudId: string, thumb = true): Promise<string> {
  const bytes = await galleryClient.assetBytes(cloudId, thumb).catch(() => (thumb ? galleryClient.assetBytes(cloudId, false) : Promise.reject(new Error('asset unavailable'))));
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart]));
}
