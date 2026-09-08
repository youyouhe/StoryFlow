import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { CloudUpload } from 'lucide-react';
import { RefImage } from '../types';
import { Panorama3DViewer } from './Panorama3DViewer';
import { galleryClient } from '../services/gallery';
import {
  uploadedLocalIds,
  uploadLocalAsset,
  downloadCloudBlob,
  cloudObjectUrl
} from '../services/assetCloud';
import { addRefImage } from '../services/refImageStore';
import type { CloudAsset } from '../services/apiClient';
/**
 * RefAssetLibraryModal — the management surface for the white-model
 * reference assets (数字资产). Global library view with search, renaming,
 * subject tagging (the identity axis that powers smart binding), provenance
 * badges, and deletion. Bindings themselves live in the per-script binding
 * panel; this modal only curates the assets.
 */

interface Labels {
  title: string;
  search: string;
  name: string;
  subject: string;
  subjectHint: string;
  delete: string;
  empty: string;
  emptySearch: string;
  close: string;
  sourceBadge: Record<string, string>;
  count: (n: number) => string;
  folderMode: string;
  localMode: string;
  useFolder: string;
  folderHint: string;
  phone: string;
  phoneNeedDir: string;
  phoneOffline: string;
  phoneOnline: (alias: string, ip: string) => string;
  phoneHint: string;
  phoneCount: (n: number) => string;
  rescan: string;
  qrHint: string;
  previewClose: string;
  catAll: string; catChar: string; catAction: string; catScene: string; catProp: string;
  scriptAll: string; scriptNone: string;
  // ---- cloud sync (P3) ----
  syncToCloud: string;
  syncing: string;
  uploadDone: (ok: number, fail: number) => string;
  signInFirst: string;
  cloudSection: string;
  cloudEmpty: string;
  cloudLoading: string;
  download: string;
  downloading: string;
  transcode: string;
  transcoding: string;
}

export const REF_LIBRARY_LABELS: Record<'en' | 'zh', Labels> = {
  en: {
    title: 'Reference Asset Library',
    search: 'Search name / subject…',
    name: 'name',
    subject: 'subject',
    subjectHint: 'e.g. a character name, 环境, 道具:X; costume variants as 名字/装束 (林枫/战损) — powers smart binding',
    delete: 'Delete',
    empty: 'Library is empty — upload images from the binding panel in a shot prompt modal.',
    emptySearch: 'No assets match the search.',
    close: 'Close',
    sourceBadge: { upload: 'upload', 'ai-generate': 'AI', 'video-frame': 'frame' },
    count: (n) => `${n} asset${n === 1 ? '' : 's'}`,
    folderMode: 'Folder',
    localMode: 'Browser storage',
    useFolder: 'Use folder…',
    folderHint: 'Switching auto-migrates your browser-storage assets into the folder (idempotent). Point at a synced folder for cross-device sharing. Requires Chrome/Edge on localhost/HTTPS.',
    phone: 'Phone drop · LocalSend',
    phoneNeedDir: 'Phone drop needs the folder backend (files land in the folder, then auto-import).',
    phoneOffline: 'Receiver not running — start scripts/localsend-assets.sh <folder>',
    phoneOnline: (alias, ip) => `Online · ${alias} @ ${ip}`,
    phoneHint: 'Install the LocalSend app on your phone (same Wi-Fi), pick this device, send — photos/videos land straight in the asset folder and auto-import.',
    phoneCount: (n) => `received ${n}`,
    rescan: 'Rescan',
    qrHint: 'Scan on the phone to open the upload page — no app needed.',
    previewClose: 'Close preview',
    catAll: 'All', catChar: 'Characters', catAction: 'Storyboard', catScene: 'Scenes', catProp: 'Props',
    scriptAll: 'All scripts', scriptNone: 'Unassigned',
    syncToCloud: 'Sync to cloud',
    syncing: 'Syncing…',
    uploadDone: (ok, fail) => `Uploaded ${ok}${fail ? `, ${fail} failed` : ''}`,
    signInFirst: 'Sign in (Settings → Account) to sync assets to the cloud.',
    cloudSection: 'Cloud assets',
    cloudEmpty: 'No cloud assets yet — sync your library or download from another device.',
    cloudLoading: 'Loading…',
    download: 'Download to library',
    downloading: 'Downloading…',
    transcode: 'Transcode to 1080p proxy',
    transcoding: 'Queued…',
  },
  zh: {
    title: '参考资产库',
    search: '搜索名称 / subject…',
    name: '名称',
    subject: 'subject',
    subjectHint: '如角色名、环境、道具:X；装束变体写 名字/装束（如 林枫/战损）——智能绑定按它匹配',
    delete: '删除',
    empty: '图库为空——在镜头提示词弹窗的绑定区上传图片。',
    emptySearch: '没有匹配的资产。',
    close: '关闭',
    sourceBadge: { upload: '上传', 'ai-generate': 'AI', 'video-frame': '抽帧' },
    count: (n) => `${n} 个资产`,
    folderMode: '文件夹',
    localMode: '浏览器存储',
    useFolder: '使用文件夹…',
    folderHint: '切换时自动把浏览器存量资产迁移进文件夹（按 id 幂等，可重复执行）。指向同步盘目录即可跨设备共享。需 Chrome/Edge + localhost/HTTPS。',
    phone: '手机投递 · LocalSend',
    phoneNeedDir: '手机投递需要文件夹后端（文件落盘到文件夹后自动入库）。',
    phoneOffline: '接收端未运行——在资产文件夹所在的机器上执行 scripts/localsend-assets.sh <文件夹>',
    phoneOnline: (alias, ip) => `在线 · ${alias} @ ${ip}`,
    phoneHint: '手机安装 LocalSend App（同一 Wi-Fi）→ 搜到本设备 → 发送，照片/视频直接落进资产文件夹并自动入库。',
    phoneCount: (n) => `已收 ${n} 个`,
    rescan: '重新扫描',
    qrHint: '手机扫码打开上传页——无需安装任何 App。',
    previewClose: '关闭预览',
    catAll: '全部', catChar: '角色', catAction: '分镜', catScene: '场景', catProp: '道具',
    scriptAll: '全部剧本', scriptNone: '未归属',
    syncToCloud: '同步到云端',
    syncing: '同步中…',
    uploadDone: (ok, fail) => `已上传 ${ok}${fail ? `，${fail} 个失败` : ''}`,
    signInFirst: '登录后（设置 → 账号）可把资产同步到云端。',
    cloudSection: '云端资产',
    cloudEmpty: '云端还没有资产——同步本地图库，或从其他设备下载。',
    cloudLoading: '加载中…',
    download: '下载到图库',
    downloading: '下载中…',
    transcode: '转码为 1080p 代理档',
    transcoding: '已入队…',
  },
};

interface Props {
  images: RefImage[];
  onUpdateMeta: (id: string, patch: { name?: string; subject?: string }) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  labels: Labels;
  /** Where assets live: 'dir' = user-chosen folder on disk, 'idb' = browser. */
  backend: 'dir' | 'idb';
  backendName?: string;
  dirAvailable: boolean;
  onOpenDir: () => void;
  /** Re-scan the asset folder (called automatically when phone drops arrive). */
  onRescan: () => void;
  /** Current screenplay id — enables the 本剧本/全部 scope filter. */
  scriptId?: string;
  /** Saved-script index for the per-script filter dropdown. */
  scripts: Array<{ id: string; title: string }>;
}

/** Inline-editable text field: click to edit, Enter/blur to commit, Esc to cancel. */
const EditableText: React.FC<{
  value: string;
  placeholder: string;
  title?: string;
  onCommit: (v: string) => void;
  className?: string;
}> = ({ value, placeholder, title, onCommit, className = '' }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (!editing) {
    return (
      <button
        type="button"
        title={title ?? placeholder}
        onClick={() => { setDraft(value); setEditing(true); }}
        className={`w-full text-left truncate hover:bg-gray-100 dark:hover:bg-zinc-800 rounded px-1 transition-colors ${className}`}
      >
        {value || <span className="text-gray-300 dark:text-gray-600">{placeholder}</span>}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); onCommit(draft.trim()); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { setEditing(false); onCommit(draft.trim()); }
        if (e.key === 'Escape') setEditing(false);
      }}
      className="w-full px-1 rounded bg-white dark:bg-zinc-800 border border-emerald-400 outline-none text-[10px]"
    />
  );
};

export const RefAssetLibraryModal: React.FC<Props> = ({ images, onUpdateMeta, onDelete, onClose, labels, backend, backendName, dirAvailable, onOpenDir, onRescan, scriptId, scripts }) => {
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<RefImage | null>(null);
  const [cat, setCat] = useState<'all' | 'character' | 'action' | 'environment' | 'prop'>('all');
  const [scriptFilter, setScriptFilter] = useState<string>(scriptId ?? 'all');
  const q = query.trim().toLowerCase();

  // ---- Cloud sync (P3) ------------------------------------------------------
  // Local → cloud: upload every not-yet-uploaded asset (sha256 dedupe makes
  // retries idempotent). Cloud → local: list cloud assets, one-click import
  // into the IndexedDB library. Sign-in state comes from the gallery client.
  const signedIn = galleryClient.isAuthenticated;
  const [uploaded, setUploaded] = useState<Set<string>>(() => uploadedLocalIds());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [cloud, setCloud] = useState<CloudAsset[] | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [transcoding, setTranscoding] = useState<string | null>(null);
  const [cloudUrls, setCloudUrls] = useState<Record<string, string>>({});

  const refreshCloud = useCallback(async () => {
    if (!galleryClient.isAuthenticated) { setCloud(null); return; }
    setCloudLoading(true);
    try {
      const assets = await galleryClient.listAssets();
      setCloud(assets.filter(a => a.status === 'ready'));
    } catch { setCloud(null); }
    finally { setCloudLoading(false); }
  }, []);

  useEffect(() => { void refreshCloud(); }, [refreshCloud]);

  // Thumbnail object URLs for the cloud grid — revoked on unmount/refresh.
  useEffect(() => {
    if (!cloud?.length) return;
    let cancelled = false;
    const made: string[] = [];
    (async () => {
      for (const a of cloud) {
        if (cancelled) return;
        if (cloudUrls[a.id]) continue;
        try {
          const url = await cloudObjectUrl(a.id, true);
          if (cancelled) { URL.revokeObjectURL(url); return; }
          made.push(url);
          setCloudUrls(prev => (prev[a.id] ? prev : { ...prev, [a.id]: url }));
        } catch { /* leave the tile without a preview */ }
      }
    })();
    return () => { cancelled = true; made.forEach(u => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);
  useEffect(() => () => { Object.values(cloudUrls).forEach(u => URL.revokeObjectURL(u)); // eslint-disable-line react-hooks/exhaustive-deps
  }, []);

  const handleSyncToCloud = useCallback(async () => {
    if (syncing) return;
    if (!galleryClient.isAuthenticated) { setSyncMsg(labels.signInFirst); return; }
    setSyncing(true);
    setSyncMsg(null);
    let ok = 0, fail = 0;
    for (const im of images) {
      if (uploaded.has(im.id)) continue;
      try {
        const blob = await fetch(im.url).then(r => r.blob());
        await uploadLocalAsset({ localId: im.id, blob, name: im.name, kind: 'image', meta: { subject: im.subject ?? '' } });
        ok++;
      } catch { fail++; }
    }
    setUploaded(uploadedLocalIds());
    setSyncing(false);
    setSyncMsg(labels.uploadDone(ok, fail));
    void refreshCloud();
  }, [images, uploaded, syncing, labels, refreshCloud]);

  const handleDownload = useCallback(async (asset: CloudAsset) => {
    if (downloading) return;
    setDownloading(asset.id);
    try {
      const { blob } = await downloadCloudBlob(asset.id);
      // panorama3d assets import with the panorama mime so the local preview
      // lightbox routes them into the 360° viewer (same as direct uploads).
      const type = asset.kind === 'panorama3d' ? 'image/panorama' : asset.mime;
      const file = new File([blob], asset.name || `asset-${asset.id.slice(0, 8)}`, { type });
      await addRefImage(file, { source: 'upload', name: asset.name || undefined });
      onRescan(); // reload local library state in App
    } catch { /* keep the button clickable for a retry */ }
    setDownloading(null);
  }, [downloading, onRescan]);

  const handleTranscode = useCallback(async (asset: CloudAsset) => {
    if (transcoding) return;
    setTranscoding(asset.id);
    try {
      await galleryClient.assetTranscode(asset.id);
      await refreshCloud();
    } catch { /* keep the button clickable for a retry */ }
    setTranscoding(null);
  }, [transcoding, refreshCloud]);

  const pendingCount = useMemo(
    () => images.filter(im => !uploaded.has(im.id)).length,
    [images, uploaded]
  );

  // ---- LocalSend receiver status (phone drop) -------------------------------
  // Polls http://<this-host>:53317/status while the modal is open; when the
  // received count grows, rescans the folder so new files appear immediately.
  const [ls, setLs] = useState<{
    running: boolean; alias: string; my_ip?: string; port?: number;
    received_count: number; pending_files: number;
    received: Array<{ fileName: string; time: number }>;
  } | null>(null);
  const lastCountRef = useRef(-1);
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`http://${location.hostname}:53317/status`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (stopped) return;
        setLs(data);
        if (lastCountRef.current >= 0 && data.received_count > lastCountRef.current) {
          onRescan(); // fresh file landed in the folder — pull it into the library
        }
        lastCountRef.current = data.received_count;
      } catch {
        if (!stopped) setLs(null);
      }
    };
    if (backend === 'dir') {
      tick();
      const t = window.setInterval(tick, 4000);
      return () => { stopped = true; window.clearInterval(t); };
    }
  }, [backend, onRescan]);
  const filtered = useMemo(() => {
    let list = images;
    if (cat !== 'all') list = list.filter(im => im.kind === cat);
    if (scriptFilter !== 'all') {
      list = scriptFilter === 'none'
        ? list.filter(im => !im.scriptIds?.length)
        : list.filter(im => im.scriptIds?.includes(scriptFilter));
    }
    if (q) list = list.filter((im) =>
      im.name.toLowerCase().includes(q) || (im.subject ?? '').toLowerCase().includes(q));
    // selected version of each group first
    return [...list].sort((a, b) =>
      Number(!!b.isSelected) - Number(!!a.isSelected) || b.createdAt - a.createdAt);
  }, [images, q, cat, scriptFilter]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
          <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{labels.title}</span>
          <span className="text-[10px] text-gray-400">{labels.count(images.length)}</span>
          <button
            type="button"
            onClick={onOpenDir}
            title={labels.folderHint}
            className={`px-2 py-0.5 rounded-full text-[9px] font-semibold border transition-colors ${
              backend === 'dir'
                ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
                : 'border-gray-300 dark:border-zinc-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            {backend === 'dir'
              ? `📁 ${backendName ?? ''}`
              : `💾 ${labels.localMode} · ${dirAvailable ? labels.useFolder : '—'}`}
          </button>
          {signedIn ? (
            <button
              type="button"
              onClick={() => void handleSyncToCloud()}
              disabled={syncing || pendingCount === 0}
              title={syncing ? labels.syncing : labels.syncToCloud}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold border transition-colors disabled:opacity-50 border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
            >
              <CloudUpload className="w-3 h-3" />
              {syncing ? labels.syncing : `${labels.syncToCloud}${pendingCount ? ` (${pendingCount})` : ''}`}
            </button>
          ) : (
            <span className="text-[9px] text-gray-400" title={labels.signInFirst}>☁︎</span>
          )}
          {syncMsg && <span className="text-[9px] text-gray-500 dark:text-gray-400">{syncMsg}</span>}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.search}
            className="ml-auto w-44 px-2 py-1 rounded-md border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-xs outline-none focus:border-emerald-400"
          />
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-800"
            aria-label={labels.close}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {/* Phone drop (LocalSend) — files land in the asset folder */}
          <div className="mb-3 rounded-lg border border-gray-200 dark:border-zinc-700 px-2.5 py-2 bg-gray-50/60 dark:bg-zinc-800/40">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">📱 {labels.phone}</span>
              <span className={`text-[10px] font-semibold ${ls?.running ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
                {backend !== 'dir'
                  ? labels.phoneNeedDir
                  : ls?.running
                    ? labels.phoneOnline(ls.alias, ls.my_ip ?? '?')
                    : labels.phoneOffline}
              </span>
              {backend === 'dir' && (
                <button
                  type="button"
                  onClick={onRescan}
                  className="ml-auto px-2 py-0.5 rounded text-[9px] font-semibold border border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                >
                  ⟳ {labels.rescan}
                </button>
              )}
            </div>
            {backend === 'dir' && ls?.running && (
              <div className="mt-1.5 flex items-start gap-3">
                {(() => {
                  const port = ls.port ?? 53317;
                  const url = `http://${ls.my_ip ?? location.hostname}:${port}/`;
                  try {
                    const qr = qrcode(0, 'M');
                    qr.addData(url);
                    qr.make();
                    return (
                      <div
                        className="shrink-0 bg-white rounded-md p-1 leading-none"
                        title={labels.qrHint}
                        dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 3, margin: 1 }) }}
                      />
                    );
                  } catch { return null; }
                })()}
                <div className="min-w-0">
                  <p className="text-[10px] leading-snug text-gray-400 dark:text-gray-500">
                    {labels.phoneCount(ls.received_count)}
                    {ls.received?.length ? ` · ${ls.received.slice(-3).map(r => r.fileName).join('、')}` : ''}
                    {' — '}{labels.phoneHint}
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">{labels.qrHint}</p>
                </div>
              </div>
            )}
          </div>

          {/* category tabs + per-script filter */}
          <div className="flex items-center gap-1.5 mb-3 flex-wrap">
            {([['all', labels.catAll], ['character', labels.catChar], ['action', labels.catAction], ['environment', labels.catScene], ['prop', labels.catProp]] as const).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setCat(k)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors ${cat === k
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-gray-300 dark:border-zinc-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800'}`}
              >
                {lbl} {k === 'all' ? images.length : images.filter(im => im.kind === k).length}
              </button>
            ))}
            <select
              value={scriptFilter}
              onChange={(e) => setScriptFilter(e.target.value)}
              className="ml-auto rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-[10px] text-gray-700 dark:text-gray-200 max-w-[180px]"
            >
              <option value="all">{labels.scriptAll}</option>
              {scripts.map(sc => <option key={sc.id} value={sc.id}>{sc.title}</option>)}
              <option value="none">{labels.scriptNone}</option>
            </select>
          </div>

          {images.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-10">{labels.empty}</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-10">{labels.emptySearch}</p>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {filtered.map((im) => (
                <div key={im.id} className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
                  <div className="relative aspect-square bg-gray-100 dark:bg-zinc-800">
                    <img
                      src={im.url}
                      alt={im.name}
                      title={im.sourcePrompt ? `${im.sourcePrompt.slice(0, 200)}` : im.name}
                      onClick={() => setPreview(im)}
                      className="w-full h-full object-cover cursor-zoom-in"
                    />
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px]">
                      {labels.sourceBadge[im.source ?? 'upload'] ?? im.source}
                      {im.sourcePrompt ? ' ⁺' : ''}
                      {(im.version ?? 1) > 1 ? ` v${im.version}` : ''}
                    </span>
                    {!im.isSelected && (
                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white/80 text-[9px]">旧版本</span>
                    )}
                    {uploaded.has(im.id) && (
                      <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-indigo-500/90 text-white text-[9px]" title={labels.syncToCloud}>☁</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(im.id)}
                      title={labels.delete}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/90 text-white text-[10px] leading-none flex items-center justify-center hover:bg-red-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    <EditableText
                      value={im.name}
                      placeholder={labels.name}
                      onCommit={(v) => v && onUpdateMeta(im.id, { name: v })}
                      className="text-[10px] text-gray-700 dark:text-gray-200"
                    />
                    <EditableText
                      value={im.subject ?? ''}
                      placeholder={labels.subject}
                      title={labels.subjectHint}
                      onCommit={(v) => onUpdateMeta(im.id, { subject: v })}
                      className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Cloud assets (P3) — one-click import into the local library */}
          {signedIn && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">☁ {labels.cloudSection}</span>
                <span className="text-[10px] text-gray-400">{cloud?.length ?? ''}</span>
                {cloudLoading && <span className="text-[10px] text-gray-400">{labels.cloudLoading}</span>}
              </div>
              {!cloud ? null : cloud.length === 0 ? (
                <p className="text-xs text-gray-400">{labels.cloudEmpty}</p>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  {cloud.map(a => (
                    <div key={a.id} className="rounded-lg border border-indigo-200 dark:border-indigo-900 overflow-hidden">
                      <div className="relative aspect-square bg-gray-100 dark:bg-zinc-800">
                        {cloudUrls[a.id] ? (
                          <img src={cloudUrls[a.id]} alt={a.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-zinc-600 text-lg">☁</div>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDownload(a)}
                          disabled={downloading === a.id}
                          title={downloading === a.id ? labels.downloading : labels.download}
                          className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-indigo-600/90 text-white text-[9px] leading-none hover:bg-indigo-600 disabled:opacity-60"
                        >
                          ↓
                        </button>
                      </div>
                      <div className="p-1.5">
                        <div className="text-[10px] text-gray-700 dark:text-gray-200 truncate">{a.name || a.id.slice(0, 8)}</div>
                        <div className="flex items-center gap-1">
                          {a.width && a.height && (
                            <span className="text-[9px] text-gray-400">{a.width}×{a.height}</span>
                          )}
                          {a.kind === 'video' && (
                            <button
                              type="button"
                              onClick={() => void handleTranscode(a)}
                              disabled={transcoding === a.id || a.transcodeStatus === 'queued' || a.transcodeStatus === 'running'}
                              title={a.transcodeStatus === 'ready' ? '1080p proxy ready' : labels.transcode}
                              className="ml-auto px-1 py-0.5 rounded bg-zinc-600/90 text-white text-[9px] leading-none hover:bg-zinc-500 disabled:opacity-60"
                            >
                              {a.transcodeStatus === 'ready' ? 'HD✓' : a.transcodeStatus === 'queued' || a.transcodeStatus === 'running' ? '⏳' : '▶1080p'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* full-size preview lightbox — panorama assets get the 360° viewer */}
        {preview && preview.type === 'image/panorama' ? (
          <div
            className="fixed inset-0 z-[60] bg-black flex items-center justify-center p-3"
            onClick={() => setPreview(null)}
          >
            <div className="w-full h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
              <Panorama3DViewer
                src={preview.url}
                className="flex-1 rounded-lg overflow-hidden"
                onLoaded={(w, h) => {
                  if (w / h < 1.8) console.warn('[assets] panorama is not 2:1 equirectangular:', w, h);
                }}
              />
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-200">
                <span className="font-semibold truncate">{preview.name}</span>
                <span className="text-[10px] text-gray-400">360° — 拖拽旋转 · 滚轮缩放</span>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="ml-auto shrink-0 px-2.5 py-1 rounded-md border border-white/30 text-white/90 hover:bg-white/10"
                >
                  ✕ {labels.previewClose}
                </button>
              </div>
            </div>
          </div>
        ) : !!preview && (
          <div
            className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6"
            onClick={() => setPreview(null)}
          >
            <div className="max-w-[90vw] max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <img
                src={preview.url}
                alt={preview.name}
                className="max-w-[90vw] max-h-[78vh] object-contain rounded-lg shadow-2xl"
              />
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-200">
                <span className="font-semibold truncate">{preview.name}</span>
                {preview.subject && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-600/80 text-white text-[10px]">{preview.subject}</span>
                )}
                {preview.sourcePrompt && (
                  <span className="text-[10px] text-gray-400 truncate flex-1" title={preview.sourcePrompt}>
                    {preview.sourcePrompt.slice(0, 120)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="ml-auto shrink-0 px-2.5 py-1 rounded-md border border-white/30 text-white/90 hover:bg-white/10"
                >
                  ✕ {labels.previewClose}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-xs font-semibold rounded-lg border border-gray-300 dark:border-zinc-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {labels.close}
          </button>
        </div>
      </div>
    </div>
  );
};
