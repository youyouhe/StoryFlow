import React, { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { RefImage } from '../types';

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
    folderHint: 'Point at a synced folder (OneDrive/坚果云/Syncthing) — assets become plain files shared across devices. Requires Chrome/Edge on localhost/HTTPS.',
    phone: 'Phone drop · LocalSend',
    phoneNeedDir: 'Phone drop needs the folder backend (files land in the folder, then auto-import).',
    phoneOffline: 'Receiver not running — start scripts/localsend-assets.sh <folder>',
    phoneOnline: (alias, ip) => `Online · ${alias} @ ${ip}`,
    phoneHint: 'Install the LocalSend app on your phone (same Wi-Fi), pick this device, send — photos/videos land straight in the asset folder and auto-import.',
    phoneCount: (n) => `received ${n}`,
    rescan: 'Rescan',
    qrHint: 'Scan on the phone to open the upload page — no app needed.',
    previewClose: 'Close preview',
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
    folderHint: '指向一个同步盘目录（OneDrive/坚果云/Syncthing）——资产变成普通文件、跨设备共享。需 Chrome/Edge + localhost/HTTPS。',
    phone: '手机投递 · LocalSend',
    phoneNeedDir: '手机投递需要文件夹后端（文件落盘到文件夹后自动入库）。',
    phoneOffline: '接收端未运行——在资产文件夹所在的机器上执行 scripts/localsend-assets.sh <文件夹>',
    phoneOnline: (alias, ip) => `在线 · ${alias} @ ${ip}`,
    phoneHint: '手机安装 LocalSend App（同一 Wi-Fi）→ 搜到本设备 → 发送，照片/视频直接落进资产文件夹并自动入库。',
    phoneCount: (n) => `已收 ${n} 个`,
    rescan: '重新扫描',
    qrHint: '手机扫码打开上传页——无需安装任何 App。',
    previewClose: '关闭预览',
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

export const RefAssetLibraryModal: React.FC<Props> = ({ images, onUpdateMeta, onDelete, onClose, labels, backend, backendName, dirAvailable, onOpenDir, onRescan }) => {
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<RefImage | null>(null);
  const q = query.trim().toLowerCase();

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
    if (!q) return images;
    return images.filter((im) =>
      im.name.toLowerCase().includes(q) || (im.subject ?? '').toLowerCase().includes(q));
  }, [images, q]);

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
                    </span>
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
        </div>

        {/* full-size preview lightbox */}
        {preview && (
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
