import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Film, Download, Plus, Trash2 } from 'lucide-react';
import type { Screenplay } from '../types';
import { buildTimeline, projectCaptionCues } from '../utils/timing/timeline';
import {
  DEFAULT_CAPTION_STYLE,
  type CaptionStyle,
  type CompositeScene,
  type OverlayTrackSpec,
  type StickerTrackSpec,
} from '../utils/compositor/scene';
import { exportComposite, pickCaptureMime } from '../utils/compositor/capture';

/**
 * Composite export (P5a) — bake captions/titles/stickers into a finished
 * clip at ZERO generation cost: the base footage (when present) is whatever
 * was already produced, and everything else is code-rendered from the P2
 * word timeline (caption windows ARE token windows).
 */
interface ComposeExportModalProps {
  open: boolean;
  screenplay: Screenplay;
  t: any;
  onClose: () => void;
  /** Recent result-repo video outputs to use as base footage. */
  onListVideoOutputs?: () => Promise<{ runId: string; runName: string; outputs: { name: string; kind: string }[] }[]>;
  onReadOutput?: (runId: string, name: string) => Promise<{ blob: Blob | null } | null>;
  /** Hand the finished clip to the review loop (done means watched). */
  onExported?: (previewUrl: string) => void;
}

const CAPTION_PRESETS: Record<string, Partial<CaptionStyle>> = {
  classic: {},
  karaoke: { activeFill: '#73FBD3', y: 0.78 },
  bold: { size: 64, fill: '#FFD54A', activeFill: '#FFFFFF', maxWordsPerLine: 3 },
};

export const ComposeExportModal: React.FC<ComposeExportModalProps> = ({
  open, screenplay, t, onClose, onListVideoOutputs, onReadOutput, onExported,
}) => {
  const [baseMode, setBaseMode] = useState<'none' | 'file' | 'result'>('none');
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [outputs, setOutputs] = useState<{ runId: string; runName: string; outputs: { name: string; kind: string }[] }[]>([]);
  const [basePick, setBasePick] = useState<string>(''); // "runId#name"
  const [captionOn, setCaptionOn] = useState(true);
  const [presetKey, setPresetKey] = useState<keyof typeof CAPTION_PRESETS>('karaoke');
  const [titleOn, setTitleOn] = useState(false);
  const [titleText, setTitleText] = useState(screenplay.metadata.title);
  const [titlePlacement, setTitlePlacement] = useState<'top' | 'center' | 'bottom'>('top');
  const [stickers, setStickers] = useState<StickerTrackSpec[]>([]);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || !onListVideoOutputs) return;
    let cancelled = false;
    void onListVideoOutputs()
      .then(runs => {
        if (cancelled) return;
        const videos = runs
          .map(r => ({ ...r, outputs: r.outputs.filter(o => o.kind === 'video') }))
          .filter(r => r.outputs.length > 0);
        setOutputs(videos);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, onListVideoOutputs]);

  const cues = useMemo(() => projectCaptionCues(buildTimeline(screenplay)), [screenplay]);

  if (!open) return null;

  const buildScene = async (): Promise<CompositeScene> => {
    const overlays: OverlayTrackSpec[] = [];
    const captionStyle: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, ...CAPTION_PRESETS[presetKey] };
    if (captionOn && cues.length) overlays.push({ kind: 'caption', cues, style: captionStyle, order: 70 });
    if (titleOn && titleText.trim()) {
      overlays.push({ kind: 'title', text: titleText.trim(), placement: titlePlacement, color: '#FFFFFF', size: 72, order: 90 });
    }
    for (const s of stickers) overlays.push(s);

    let base: CompositeScene['base'];
    if (baseMode === 'file' && baseFile) {
      base = { src: baseFile, fit: 'cover' };
    } else if (baseMode === 'result' && basePick && onReadOutput) {
      const [runId, name] = basePick.split('#');
      const out = await onReadOutput(runId, name);
      if (!out?.blob) throw new Error('底版字节不可用——请换一个产物或用文件');
      base = { src: out.blob, fit: 'cover' };
    }
    return {
      width: 1080,
      height: 1920,
      fps: 30,
      background: '#09090B',
      base,
      overlays,
    };
  };

  const handleExport = async (): Promise<void> => {
    setError(null);
    setExporting(true);
    setProgress(0);
    abortRef.current = new AbortController();
    try {
      const scene = await buildScene();
      const result = await exportComposite(scene, {
        signal: abortRef.current.signal,
        onProgress: p => setProgress(p.durationSec ? Math.round((p.t / p.durationSec) * 100) : 0),
      });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${screenplay.metadata.title.replace(/[^a-z0-9一-龥]+/gi, '_') || 'composite'}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      onExported?.(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const addSticker = (): void => {
    const mid = cues.length ? (cues[0].start + cues[cues.length - 1].end) / 2 : 1;
    setStickers(prev => [...prev, {
      kind: 'sticker',
      id: `st-${Date.now().toString(36)}`,
      text: t.composeStickerDefault || 'Wow!',
      author: '@viewer',
      atSec: Math.round(mid * 10) / 10,
      durationSec: 2,
      order: 50,
    }]);
  };

  const captureOk = pickCaptureMime() !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 inline-flex items-center gap-2">
            <Film className="w-4 h-4" /> {t.composeTitle || 'Composite export'}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-xs">
          <p className="text-[10px] text-gray-400">
            {t.composeHint || 'Captions/titles/stickers are code-rendered from the word timeline — zero generation cost. Base footage is optional.'}
          </p>

          {/* base footage */}
          <div>
            <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">{t.composeBase || 'Base footage'}</p>
            <div className="flex flex-wrap gap-2">
              {(['none', 'file', 'result'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  disabled={mode === 'result' && !onReadOutput}
                  onClick={() => setBaseMode(mode)}
                  className={`px-2 py-1 text-[10px] font-bold rounded border ${baseMode === mode ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-400 text-indigo-600' : 'border-gray-200 dark:border-zinc-700 text-gray-500'}`}
                >
                  {mode === 'none' ? (t.composeBaseNone || 'none (title/card only)') : mode === 'file' ? (t.composeBaseFile || 'file') : (t.composeBaseResult || 'result output')}
                </button>
              ))}
            </div>
            {baseMode === 'file' && (
              <input type="file" accept="video/*" className="mt-2 block w-full text-[10px]"
                onChange={e => setBaseFile(e.target.files?.[0] ?? null)} />
            )}
            {baseMode === 'result' && (
              <select value={basePick} onChange={e => setBasePick(e.target.value)}
                className="mt-2 w-full px-2 py-1 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded">
                <option value="">{t.composePickOutput || 'choose a video output…'}</option>
                {outputs.map(r => r.outputs.map(o => (
                  <option key={`${r.runId}#${o.name}`} value={`${r.runId}#${o.name}`}>
                    {r.runName} / {o.name}
                  </option>
                )))}
              </select>
            )}
          </div>

          {/* captions */}
          <div>
            <label className="flex items-center gap-2 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[10px]">
              <input type="checkbox" checked={captionOn} onChange={e => setCaptionOn(e.target.checked)} />
              {t.composeCaptions || `Captions (${cues.length} cues from word timing)`}
            </label>
            {captionOn && (
              <div className="mt-1 flex gap-2">
                {Object.keys(CAPTION_PRESETS).map(key => (
                  <button key={key} type="button" onClick={() => setPresetKey(key as keyof typeof CAPTION_PRESETS)}
                    className={`px-2 py-1 text-[10px] rounded border ${presetKey === key ? 'bg-teal-100 dark:bg-teal-900/30 border-teal-400 text-teal-600' : 'border-gray-200 dark:border-zinc-700 text-gray-500'}`}>
                    {key}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* title */}
          <div>
            <label className="flex items-center gap-2 font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[10px]">
              <input type="checkbox" checked={titleOn} onChange={e => setTitleOn(e.target.checked)} />
              {t.composeTitleLabel || 'Title overlay'}
            </label>
            {titleOn && (
              <div className="mt-1 flex gap-2">
                <input value={titleText} onChange={e => setTitleText(e.target.value)}
                  className="flex-1 px-2 py-1 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded" />
                <select value={titlePlacement} onChange={e => setTitlePlacement(e.target.value as 'top' | 'center' | 'bottom')}
                  className="px-2 py-1 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded">
                  <option value="top">top</option>
                  <option value="center">center</option>
                  <option value="bottom">bottom</option>
                </select>
              </div>
            )}
          </div>

          {/* stickers */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t.composeStickers || 'Stickers'}</p>
              <button type="button" onClick={addSticker} className="text-[10px] font-bold text-indigo-500 inline-flex items-center gap-1">
                <Plus className="w-3 h-3" /> {t.composeAddSticker || 'add'}
              </button>
            </div>
            {stickers.map((s, i) => (
              <div key={s.id} className="flex items-center gap-1 mb-1">
                <input value={s.text} onChange={e => setStickers(prev => prev.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                  className="flex-1 px-2 py-1 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded" />
                <input type="number" step="0.1" min="0" value={s.atSec} title="at (s)"
                  onChange={e => setStickers(prev => prev.map((x, j) => j === i ? { ...x, atSec: Math.max(0, parseFloat(e.target.value) || 0) } : x))}
                  className="w-16 px-1 py-1 font-mono bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded" />
                <button type="button" onClick={() => setStickers(prev => prev.filter((_, j) => j !== i))}
                  className="p-1 text-gray-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>

          {error && <p className="text-[11px] text-red-500" role="alert">{error}</p>}
          {!captureOk && <p className="text-[11px] text-amber-500">{t.composeNoCapture || 'This browser lacks MediaRecorder — use Chrome/Edge or the desktop app.'}</p>}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-zinc-800">
          <span className="text-[10px] font-mono text-gray-400">{exporting ? `${progress}%` : ' '}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 dark:border-zinc-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800">
              {t.composeCancel || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || !captureOk}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              {exporting ? (t.composeExporting || 'Baking…') : (t.composeExport || 'Export .webm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
