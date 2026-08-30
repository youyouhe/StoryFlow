import React, { useState, useEffect, useRef } from 'react';
import { FileText, FileJson, FileCode, ChevronDown, Check, X } from 'lucide-react';
import { clsx } from 'clsx';
import { ExportFormat, ExportOptions } from '../types';
import { DEFAULT_EXPORT_OPTIONS } from '../utils/exportData';

/**
 * ExportMenu — a small dropdown panel for choosing an export format (PDF /
 * Markdown / JSON) and which AI payloads to bundle. Replaces the old single
 * "Export PDF" button in the Sidebar.
 *
 * The menu opens in a fixed overlay so it isn't clipped by the Sidebar's
 * narrow width. Format choice drives which option rows are relevant:
 *  - JSON: graybox always raw JSON (it's a lossless dump), so the
 *    json/summary toggle is hidden.
 *  - PDF / Markdown: graybox can be summary or raw JSON.
 */
interface ExportMenuProps {
  open: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat, options: ExportOptions) => void;
  t: any;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({ open, onClose, onExport, t }) => {
  const [format, setFormat] = useState<ExportFormat>('json');
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const panelRef = useRef<HTMLDivElement>(null);

  // close on outside click / escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const set = (patch: Partial<ExportOptions>) => setOpts(prev => ({ ...prev, ...patch }));

  // JSON format is always lossless raw JSON — hide the summary toggle there.
  const grayboxFormatDisabled = format === 'json';

  const formats: { key: ExportFormat; icon: React.ComponentType<{ className?: string }>; label: string; desc: string }[] = [
    { key: 'json', icon: FileJson, label: t.exportJson || 'JSON', desc: t.exportJsonDesc || 'Lossless full dump (all blocks + payloads)' },
    { key: 'markdown', icon: FileCode, label: t.exportMarkdown || 'Markdown', desc: t.exportMarkdownDesc || 'Readable script + folded payloads' },
    { key: 'pdf', icon: FileText, label: t.exportPdf || 'PDF', desc: t.exportPdfDesc || 'Printable screenplay + appendix' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md mx-4 bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-gray-200 dark:border-zinc-800 overflow-hidden"
      >
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">{t.exportTitle || 'Export'}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* format picker */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              {t.exportFormat || 'Format'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {formats.map(f => {
                const Icon = f.icon;
                const active = format === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFormat(f.key)}
                    className={clsx(
                      "flex flex-col items-center gap-1 px-2 py-2.5 rounded-lg border text-center transition-colors",
                      active
                        ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300"
                        : "bg-transparent border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-xs font-semibold">{f.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
              {formats.find(f => f.key === format)?.desc}
            </p>
          </div>

          {/* options */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
              {t.exportInclude || 'Include'}
            </label>
            <div className="space-y-1.5">
              <CheckRow
                checked={!!opts.includeImagePrompts}
                onChange={(v) => set({ includeImagePrompts: v })}
                label={t.exportIncludePrompts || 'Storyboard image prompts'}
              />
              <CheckRow
                checked={!!opts.includeGraybox}
                onChange={(v) => set({ includeGraybox: v })}
                label={t.exportIncludeGraybox || 'Graybox (3D previs)'}
              />
              {/* graybox format sub-toggle */}
              {opts.includeGraybox && !grayboxFormatDisabled && (
                <div className="ml-6 mt-1 flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">{t.exportGrayboxAs || 'Graybox as'}</span>
                  <div className="flex rounded-md border border-gray-200 dark:border-zinc-700 overflow-hidden text-[11px]">
                    {(['json', 'summary'] as const).map(gf => (
                      <button
                        key={gf}
                        onClick={() => set({ grayboxFormat: gf })}
                        className={clsx(
                          "px-2 py-0.5 transition-colors",
                          opts.grayboxFormat === gf
                            ? "bg-indigo-500 text-white"
                            : "bg-transparent text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800"
                        )}
                      >
                        {gf === 'json' ? (t.exportGrayboxJson || 'JSON') : (t.exportGrayboxSummary || 'Summary')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {opts.includeGraybox && grayboxFormatDisabled && (
                <p className="ml-6 text-[10px] text-gray-400 dark:text-gray-500">
                  {t.exportGrayboxAlwaysJson || 'JSON format always includes full graybox JSON.'}
                </p>
              )}
              <CheckRow
                checked={!!opts.includeBlockIds}
                onChange={(v) => set({ includeBlockIds: v })}
                label={t.exportIncludeBlockIds || 'Block type + id annotations'}
              />
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800 flex justify-end gap-2 bg-gray-50/60 dark:bg-zinc-900/60">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg"
          >
            {t.cancel || 'Cancel'}
          </button>
          <button
            onClick={() => { onExport(format, opts); onClose(); }}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg flex items-center gap-1.5"
          >
            <ChevronDown className="w-3.5 h-3.5 rotate-[-90deg]" />
            {t.exportDo || 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
};

const CheckRow: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <label className="flex items-center gap-2.5 cursor-pointer select-none py-0.5">
    <span
      onClick={() => onChange(!checked)}
      className={clsx(
        "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
        checked
          ? "bg-indigo-500 border-indigo-500 text-white"
          : "bg-transparent border-gray-300 dark:border-zinc-600"
      )}
    >
      {checked && <Check className="w-3 h-3" />}
    </span>
    <span className="text-xs text-gray-700 dark:text-gray-300">{label}</span>
  </label>
);
