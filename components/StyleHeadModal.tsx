import React, { useState, useEffect, useCallback } from 'react';
import { Palette, RefreshCw, Loader2, Check, X, Sparkles } from 'lucide-react';
import { Screenplay, ScriptBlock, ScriptLanguage, AppSettings, StyleHead } from '../types';
import { generateStyleHeads } from '../services/geminiService';
import { TRANSLATIONS } from '../constants';

interface StyleHeadModalProps {
  /** Currently locked head, if any (shown as the incumbent). */
  current?: StyleHead;
  blocks: ScriptBlock[];
  templateId?: string;
  scriptLanguage: ScriptLanguage;
  appSettings: AppSettings;
  t: typeof TRANSLATIONS['en'];
  onClose: () => void;
  onApply: (head: StyleHead) => void;
}

/**
 * StyleHeadModal — generate & pick the screenplay's fixed visual head
 * (画风 + 场景 preset). Picking one locks it into metadata.styleHead so all
 * downstream text-to-image prompts share a single consistent style.
 */
export const StyleHeadModal: React.FC<StyleHeadModalProps> = ({
  current, blocks, templateId, scriptLanguage, appSettings, t, onClose, onApply
}) => {
  const [heads, setHeads] = useState<StyleHead[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateStyleHeads(blocks, '', scriptLanguage, appSettings, templateId);
      setHeads(result);
    } catch (e) {
      setError(e instanceof Error && e.message === 'STYLE_HEAD_PARSE'
        ? t.styleHeadParseError
        : (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [blocks, scriptLanguage, appSettings, templateId, t]);

  // Generate on first open (and only then — regenerating is explicit).
  useEffect(() => {
    if (heads === null && !loading && !error) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#18181b] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-gray-200 dark:border-zinc-800 ring-1 ring-black/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-800 dark:text-gray-100">
            <Palette className="w-5 h-5 text-fuchsia-500" />
            <span>{t.styleHeadTitle}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void generate()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-60"
            >
              <RefreshCw className={clsxSpin(loading)} />
              {t.styleHeadRegenerate}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* current head banner */}
        {current && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/60 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {t.styleHeadCurrent}: <b>{current.name}</b> — {current.artStyle} · {current.scenePreset}
            </span>
          </div>
        )}

        {/* body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t.styleHeadHint}</p>
          {loading && (
            <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin text-fuchsia-500" />
              <span className="text-xs">{t.styleHeadGenerating}</span>
            </div>
          )}
          {!loading && error && (
            <div className="py-10 text-center text-xs text-red-500">
              {t.styleHeadError}: {error}
            </div>
          )}
          {!loading && !error && heads && (
            <div className="grid gap-3 sm:grid-cols-3">
              {heads.map((h, i) => (
                <button
                  key={i}
                  onClick={() => onApply(h)}
                  className="text-left p-3 rounded-xl border border-gray-200 dark:border-zinc-700 hover:border-fuchsia-400 dark:hover:border-fuchsia-500 hover:shadow-md transition-all group flex flex-col gap-2"
                >
                  <div className="flex items-center gap-1.5 text-sm font-bold text-gray-800 dark:text-gray-100">
                    <Sparkles className="w-3.5 h-3.5 text-fuchsia-500 shrink-0" />
                    <span className="truncate">{h.name}</span>
                  </div>
                  <div className="text-[11px] text-gray-600 dark:text-gray-300">
                    <span className="font-bold text-gray-400 dark:text-gray-500">{t.styleHeadArt}: </span>
                    {h.artStyle}
                  </div>
                  <div className="text-[11px] text-gray-600 dark:text-gray-300">
                    <span className="font-bold text-gray-400 dark:text-gray-500">{t.styleHeadScene}: </span>
                    {h.scenePreset}
                  </div>
                  <div className="mt-auto pt-2 text-[10px] font-mono text-gray-400 dark:text-gray-500 line-clamp-3">
                    {h.promptPrefix}
                  </div>
                  <div className="mt-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-fuchsia-600 text-white text-[10px] font-bold uppercase tracking-wider opacity-80 group-hover:opacity-100">
                    <Check className="w-3 h-3" />
                    {t.styleHeadApply}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between gap-3">
          <span className="text-[10px] text-gray-400 truncate">
            {current ? t.styleHeadFooterLocked : t.styleHeadFooterNone}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg"
          >
            {t.styleHeadSkip}
          </button>
        </div>
      </div>
    </div>
  );
};

function clsxSpin(loading: boolean) {
  return `w-3.5 h-3.5${loading ? ' animate-spin' : ''}`;
}
