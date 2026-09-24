import React, { useMemo, useState } from 'react';
import type { ScriptBlock, ScriptMarks, ScriptToken } from '../types';
import { TRANSLATIONS } from '../constants';
import { rangeFromGaps } from '../utils/timing/offsets';
import { Waves, Upload, Check, X, Trash2, Pencil } from 'lucide-react';

/**
 * Word-level timing strip (P2b of docs/storyflow-adoption-plan.md) — the
 * PromptPanel "timing" tab. One chip per token, WIDTH PROPORTIONAL to its
 * projected window (the timeline is literally word-shaped), colored by where
 * the time came from: estimate / aligned (audio) / manual (校时). Low
 * confidence words get flagged. Marks (Selections/Moments) that touch the
 * block render as pins under the strip. Clicking a word jumps the editor
 * caret onto it — the strip ↔ editor navigation is bidirectional through
 * App's highlightRange.
 */
interface TimingStripProps {
  block: ScriptBlock;
  tokens: ScriptToken[];
  /** Projected program windows per token (same order as tokens). */
  windows: { start: number; end: number }[];
  blockWindow: { start: number; end: number };
  marks: ScriptMarks;
  t: typeof TRANSLATIONS['en'];
  readOnly: boolean;
  alignBusy: boolean;
  alignError: string | null;
  hasAsrKey: boolean;
  onCreateSelection: (name: string, startGap: number, endGap: number) => void;
  onCreateMoment: (name: string, gap: number) => void;
  onDeleteMark: (id: string) => void;
  onSetTokenTiming: (index: number, start: number, end: number) => void;
  onClearTokenTiming: (index: number) => void;
  onJumpToEditor: (rawStart: number, rawEnd: number) => void;
  onAlignAudio: (file: File) => void;
  onImportAsr: (file: File) => void;
}

type Source = 'estimate' | 'aligned' | 'manual';

const SOURCE_STYLE: Record<Source, string> = {
  estimate: 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-zinc-700',
  aligned: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
  manual: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800',
};

export const TimingStrip: React.FC<TimingStripProps> = ({
  block, tokens, windows, blockWindow, marks, t, readOnly,
  alignBusy, alignError, hasAsrKey,
  onCreateSelection, onCreateMoment, onDeleteMark,
  onSetTokenTiming, onClearTokenTiming,
  onJumpToEditor, onAlignAudio, onImportAsr,
}) => {
  const [editing, setEditing] = useState<number | null>(null);
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [markName, setMarkName] = useState('');

  const span = Math.max(0.1, blockWindow.end - blockWindow.start);
  const overlayByIndex = useMemo(() => {
    const m = new Map<number, NonNullable<ScriptBlock['timing']>['tokens'][number]>();
    for (const e of block.timing?.tokens ?? []) m.set(e.index, e);
    return m;
  }, [block.timing]);

  const localWindow = (i: number): { start: number; end: number; source: Source; confidence?: number } => {
    const entry = overlayByIndex.get(i);
    if (entry) {
      return {
        start: entry.start,
        end: entry.end,
        source: entry.source,
        confidence: entry.confidence,
      };
    }
    return {
      start: windows[i].start - blockWindow.start,
      end: windows[i].end - blockWindow.start,
      source: 'estimate',
    };
  };

  // marks that touch this block (blockId match; gaps clamp at projection)
  const blockMarks = useMemo(() => {
    const gapCount = tokens.length;
    const gapTime = (gap: number): number => {
      const g = Math.max(0, Math.min(gapCount, gap));
      return g === 0 ? 0 : g >= gapCount ? span : localWindow(g).start;
    };
    return {
      selections: marks.selections
        .filter(s => s.start.blockId === block.id || s.end.blockId === block.id)
        .map(s => ({
          ...s,
          left: (gapTime(s.start.blockId === block.id ? s.start.gap : 0) / span) * 100,
          right: (gapTime(s.end.blockId === block.id ? s.end.gap : gapCount) / span) * 100,
        })),
      moments: marks.moments
        .filter(m => m.at.blockId === block.id)
        .map(m => ({ ...m, at: (gapTime(m.at.gap) / span) * 100 })),
    };
  }, [marks, block.id, tokens.length, span]);

  const openEditor = (startGap: number, endGap: number): void => {
    const range = rangeFromGaps(tokens, startGap, endGap);
    if (range) onJumpToEditor(range.start, range.end);
  };

  const startEdit = (i: number): void => {
    const w = localWindow(i);
    setEditing(i);
    setDraftStart(String(Math.round(w.start * 1000) / 1000));
    setDraftEnd(String(Math.round(w.end * 1000) / 1000));
  };

  const commitEdit = (): void => {
    if (editing === null) return;
    const start = parseFloat(draftStart);
    const end = parseFloat(draftEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      onSetTokenTiming(editing, start, end);
    }
    setEditing(null);
  };

  const nextMarkName = (prefix: string): string => {
    const typed = markName.trim();
    if (typed) return typed;
    const existing = new Set([...marks.selections.map(s => s.id), ...marks.moments.map(m => m.id)]);
    let n = 1;
    while (existing.has(`${prefix}-${n}`)) n++;
    return `${prefix}-${n}`;
  };

  return (
    <div className="px-4 py-3 space-y-3">
      <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug">{t.timingHint}</p>

      {/* ---- word ticks: width ∝ projected duration ---- */}
      <div className="relative">
        <div className="flex items-stretch gap-[2px] min-h-[42px]">
          {tokens.map((token, i) => {
            const w = localWindow(i);
            const low = typeof w.confidence === 'number' && w.confidence < 0.6;
            return (
              <button
                key={token.id}
                type="button"
                disabled={readOnly}
                onClick={() => (editing === i ? setEditing(null) : startEdit(i))}
                title={`${token.text || token.spokenText}\n${w.start.toFixed(2)}–${w.end.toFixed(2)}s${w.confidence !== undefined ? ` · ${t.timingConfidence} ${(w.confidence * 100).toFixed(0)}%` : ''}`}
                style={{ flexGrow: Math.max(0.4, (w.end - w.start) * 100) }}
                className={`relative min-w-[22px] px-1 py-1 rounded border text-[10px] leading-tight break-all text-center transition-colors ${SOURCE_STYLE[w.source]} ${low ? 'ring-2 ring-amber-400' : ''} ${editing === i ? 'outline outline-2 outline-indigo-500' : ''}`}
              >
                <span className="block truncate max-w-[80px]">{token.text || '␣'}</span>
                <span className="block font-mono text-[9px] opacity-70">{w.start.toFixed(2)}</span>
                {token.kind === 'punct' && <span className="absolute top-0 right-0 text-[8px] opacity-50">·</span>}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between mt-1 font-mono text-[9px] text-gray-400 dark:text-gray-500">
          <span>{blockWindow.start.toFixed(2)}s</span>
          <span>{t.timingSourceEstimate} / {t.timingSourceAligned} / {t.timingSourceManual}</span>
          <span>{blockWindow.end.toFixed(2)}s</span>
        </div>
      </div>

      {/* ---- manual timing editor (校时) ---- */}
      {editing !== null && !readOnly && (
        <div className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700">
          <div>
            <label className="block text-[9px] font-bold text-gray-400 uppercase">{t.timingEditWord}</label>
            <span className="text-xs font-mono">{tokens[editing]?.text || tokens[editing]?.spokenText}</span>
          </div>
          <div>
            <label className="block text-[9px] font-bold text-gray-400 uppercase">{t.timingStartLabel}</label>
            <input
              type="number" step="0.05" min="0" value={draftStart}
              onChange={e => setDraftStart(e.target.value)}
              className="w-20 px-2 py-1 text-xs font-mono bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded"
            />
          </div>
          <div>
            <label className="block text-[9px] font-bold text-gray-400 uppercase">{t.timingEndLabel}</label>
            <input
              type="number" step="0.05" min="0" value={draftEnd}
              onChange={e => setDraftEnd(e.target.value)}
              className="w-20 px-2 py-1 text-xs font-mono bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded"
            />
          </div>
          <button type="button" onClick={commitEdit} className="px-2 py-1 text-[10px] font-bold rounded bg-indigo-600 text-white hover:bg-indigo-500 inline-flex items-center gap-1">
            <Check className="w-3 h-3" /> {t.timingSet}
          </button>
          <button type="button" onClick={() => onClearTokenTiming(editing)} className="px-2 py-1 text-[10px] rounded border border-gray-200 dark:border-zinc-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> {t.timingClear}
          </button>
          <button type="button" onClick={() => setEditing(null)} className="px-2 py-1 text-[10px] rounded border border-gray-200 dark:border-zinc-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1">
            <X className="w-3 h-3" /> {t.timingCancel}
          </button>
        </div>
      )}

      {/* ---- marks as pins under the strip ---- */}
      <div>
        <div className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">
          {t.timingMarks}
          {!blockMarks.selections.length && !blockMarks.moments.length && (
            <span className="ml-2 font-normal normal-case tracking-normal">{t.timingNoMarks}</span>
          )}
        </div>
        {(blockMarks.selections.length > 0 || blockMarks.moments.length > 0) && (
          <div className="relative h-4 rounded bg-gray-50 dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800">
            {blockMarks.selections.map(s => (
              <div
                key={s.id}
                className="absolute top-0 h-full rounded bg-indigo-400/30 border-x border-indigo-400 cursor-pointer"
                style={{ left: `${Math.min(s.left, s.right)}%`, width: `${Math.max(1.5, Math.abs(s.right - s.left))}%` }}
                title={s.id}
                onClick={() => !readOnly && onDeleteMark(s.id)}
              >
                <span className="absolute -top-0.5 left-1 text-[8px] text-indigo-700 dark:text-indigo-300 truncate max-w-[60px]">{s.id}</span>
              </div>
            ))}
            {blockMarks.moments.map(m => (
              <div
                key={m.id}
                className="absolute top-0 h-full w-[3px] bg-amber-500 cursor-pointer"
                style={{ left: `${m.at}%` }}
                title={`${m.id} · ${t.timingDelete}?`}
                onClick={() => !readOnly && onDeleteMark(m.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---- actions: mark creation + alignment ---- */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            type="text"
            value={markName}
            onChange={e => setMarkName(e.target.value)}
            placeholder={t.markBarName}
            className="w-28 px-2 py-1 text-[10px] bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded"
          />
          <button
            type="button"
            onClick={() => { onCreateSelection(nextMarkName('sel'), 0, tokens.length); setMarkName(''); }}
            className="px-2 py-1 text-[10px] font-bold rounded border border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
          >
            {t.markBarSelection}
          </button>
          <button
            type="button"
            onClick={() => { onCreateMoment(nextMarkName('mom'), 0); setMarkName(''); }}
            className="px-2 py-1 text-[10px] font-bold rounded border border-amber-300 dark:border-amber-800 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
          >
            {t.markBarMoment}
          </button>
          <span className="text-[9px] text-gray-400">{t.markBarHint}</span>
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <label className={`px-2 py-1 text-[10px] font-bold rounded border inline-flex items-center gap-1 cursor-pointer ${hasAsrKey ? 'border-emerald-300 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'border-gray-200 dark:border-zinc-700 text-gray-400 cursor-not-allowed'}`}>
            <Waves className="w-3 h-3" />
            {alignBusy ? t.timingAlignBusy : t.timingAlign}
            <input
              type="file"
              accept="audio/*,video/mp4,video/quicktime"
              className="hidden"
              disabled={!hasAsrKey || alignBusy}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) onAlignAudio(f);
                e.target.value = '';
              }}
            />
          </label>
          <label className="px-2 py-1 text-[10px] font-bold rounded border border-gray-200 dark:border-zinc-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1 cursor-pointer">
            <Upload className="w-3 h-3" />
            {t.timingImport}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) onImportAsr(f);
                e.target.value = '';
              }}
            />
          </label>
          {!hasAsrKey && <span className="text-[9px] text-amber-600 dark:text-amber-400">{t.timingNoAsrKey}</span>}
          {alignError && <span className="text-[10px] text-red-500" role="alert">{alignError}</span>}
        </div>
      )}
      {readOnly && (
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <Pencil className="w-3 h-3" /> {t.timingSourceEstimate}: {blockWindow.start.toFixed(2)}–{blockWindow.end.toFixed(2)}s
        </div>
      )}
    </div>
  );
};
