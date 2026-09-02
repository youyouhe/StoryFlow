import React, { useMemo, useState } from 'react';
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
}

export const REF_LIBRARY_LABELS: Record<'en' | 'zh', Labels> = {
  en: {
    title: 'Reference Asset Library',
    search: 'Search name / subject…',
    name: 'name',
    subject: 'subject',
    subjectHint: 'e.g. a character name, 环境, 道具:X — powers smart binding',
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
  },
  zh: {
    title: '参考资产库',
    search: '搜索名称 / subject…',
    name: '名称',
    subject: 'subject',
    subjectHint: '如角色名、环境、道具:X——智能绑定按它匹配',
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

export const RefAssetLibraryModal: React.FC<Props> = ({ images, onUpdateMeta, onDelete, onClose, labels, backend, backendName, dirAvailable, onOpenDir }) => {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
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
          {images.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-10">{labels.empty}</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-10">{labels.emptySearch}</p>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {filtered.map((im) => (
                <div key={im.id} className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
                  <div className="relative aspect-square bg-gray-100 dark:bg-zinc-800">
                    <img src={im.url} alt={im.name} className="w-full h-full object-cover" />
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px]">
                      {labels.sourceBadge[im.source ?? 'upload'] ?? im.source}
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
