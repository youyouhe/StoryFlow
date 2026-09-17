import React from 'react';
import { Screenplay, ScriptTemplate } from '../types';
import { TRANSLATIONS } from '../constants';
import { OpeningCandidate } from '../services/geminiService';

interface OpeningPickerProps {
  /** The template being opened; non-null because the parent guards `openingPicker &&`. */
  openingPicker: ScriptTemplate;
  openingOptions: OpeningCandidate[] | null;
  openingsLoading: boolean;
  openingsError: string | null;
  chosenOpening: number | null;
  setChosenOpening: React.Dispatch<React.SetStateAction<number | null>>;
  /** Current screenplay — its content language decides whether the template's
   *  zh/dual opening (or its English default) is the "template default" row. */
  screenplay: Screenplay;
  t: typeof TRANSLATIONS['en'];
  onClose: () => void;
  onReroll: () => void;
  /** Creates the script with the chosen opening (parent passes handleCreateFromTemplate). */
  onConfirm: (templateId: string, opening?: OpeningCandidate) => void;
  /** Start a BLANK script from the picked template: no AI opening, one empty
   *  scene heading so the user has a cursor to type into. */
  onBlank: () => void;
}

export const OpeningPicker: React.FC<OpeningPickerProps> = ({
  openingPicker,
  openingOptions,
  openingsLoading,
  openingsError,
  chosenOpening,
  setChosenOpening,
  onReroll,
  onBlank,
  onConfirm,
  screenplay,
  t,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#18181b] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-gray-200 dark:border-zinc-800">
        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <div className="font-bold text-gray-900 dark:text-white">🎲 {t.openingTitle}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t.templates[openingPicker.nameKey as keyof typeof t.templates]} · {t.openingAiHint}
          </div>
        </div>
        <div className="p-4 overflow-y-auto space-y-3">
          {/* Template default opening */}
          <button
            type="button"
            onClick={() => setChosenOpening(null)}
            className={`w-full text-left p-3 rounded-xl border transition-all ${
              chosenOpening === null
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-gray-200 dark:border-zinc-800 hover:border-indigo-300'
            }`}
          >
            <div className="text-xs font-bold text-gray-900 dark:text-white mb-1">{t.openingDefault}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {(() => {
                const base = (openingPicker.initialBlocksZh && ['zh', 'dual'].includes(screenplay.metadata.scriptLanguage))
                  ? openingPicker.initialBlocksZh
                  : openingPicker.initialBlocks;
                return base.slice(0, 2).map(b => b.content).join(' — ');
              })()}
            </div>
          </button>

          {openingsLoading && (
            <div className="p-3 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-800 text-xs text-indigo-600 dark:text-indigo-400 animate-pulse">
              {t.openingLoading}
            </div>
          )}
          {openingsError && (
            <div className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 text-[11px] text-red-600 dark:text-red-400 break-all">
              {openingsError}
            </div>
          )}
          {(openingOptions ?? []).map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setChosenOpening(i)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${
                chosenOpening === i
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                  : 'border-gray-200 dark:border-zinc-800 hover:border-indigo-300'
              }`}
            >
              <div className="text-xs font-bold text-gray-900 dark:text-white mb-1">{opt.logline || `#${i + 1}`}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2">
                {opt.blocks.slice(0, 3).map(b => b.content).join(' — ')}
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={onReroll}
            disabled={openingsLoading}
            className="w-full p-2 rounded-xl border border-dashed border-gray-300 dark:border-zinc-700 text-xs text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50"
          >
            {openingsLoading ? t.openingLoading : t.openingReroll}
          </button>
          <button onClick={onBlank} className="mr-auto px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg">
            {t.openingBlank}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg">
            {t.cancel}
          </button>
          <button
            onClick={() => {
              onConfirm(
                openingPicker.id,
                chosenOpening !== null && openingOptions ? openingOptions[chosenOpening] : undefined
              );
            }}
            className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm disabled:opacity-50"
          >
            {t.openingConfirm}
          </button>
        </div>
      </div>
    </div>
  );
};