import React, { useMemo, useState } from 'react';
import { X, Image as ImageIcon, Film, RefreshCw, Lock, Unlock, AlertCircle, Loader2, Clapperboard } from 'lucide-react';
import { clsx } from 'clsx';
import { Screenplay, AppSettings, RefImage, ExpressShot } from '../types';
import { TRANSLATIONS } from '../constants';
import { generateFirstFrame, generateI2V } from '../services/expressService';

/**
 * ExpressWorkbench — the Mode-A gacha workbench (docs/pipeline-two-mode.md §1).
 *
 * One row per generatable block (a block with an imagePrompt): first frame →
 * I2V clip, with preview / reroll / lock per shot. Durable outcomes persist in
 * `screenplay.expressShots`; transient generation state lives here. Reroll
 * re-queues the I2V with a fresh seed against the SAME first frame and is
 * blocked while a shot is locked.
 */
interface ExpressWorkbenchProps {
  screenplay: Screenplay;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  appSettings: AppSettings;
  t: typeof TRANSLATIONS['en'];
  lang: 'en' | 'zh';
  onClose: () => void;
  /** Upload a generated frame into the durable asset library; returns its id. */
  onUploadFrame: (blob: Blob, subject: string) => Promise<string | null>;
  refImages: RefImage[];
}

const zh = (lang: 'en' | 'zh') => lang === 'zh';

export const ExpressWorkbench: React.FC<ExpressWorkbenchProps> = ({
  screenplay, setScreenplay, appSettings, t, lang, onClose, onUploadFrame, refImages,
}) => {
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [duration, setDuration] = useState(5);
  const [expanded, setExpanded] = useState<string | null>(null);

  const isZh = zh(lang);
  const comfyReady = !!appSettings.comfyServerUrl.trim() && !!appSettings.comfyWorkflowI2V.trim();
  const imageCfg = {
    provider: appSettings.imageProvider,
    minimaxApiKey: appSettings.minimaxApiKey.trim(),
    minimaxBaseUrl: appSettings.minimaxBaseUrl,
    falKey: appSettings.falKey.trim(),
    falModel: appSettings.falModel.trim(),
    falQuality: appSettings.falQuality,
  };
  const comfyCfg = { serverUrl: appSettings.comfyServerUrl };

  const shots = useMemo(() => {
    const list: { blockId: string; index: number; prompt: string; excerpt: string; shot: ExpressShot | undefined }[] = [];
    let i = 0;
    for (const b of screenplay.blocks) {
      if (!b.imagePrompt?.trim()) continue;
      i += 1;
      list.push({
        blockId: b.id,
        index: i,
        prompt: b.imagePrompt,
        excerpt: b.content.trim().slice(0, 60) || b.imagePrompt.slice(0, 60),
        shot: screenplay.expressShots?.[b.id],
      });
    }
    return list;
  }, [screenplay.blocks, screenplay.expressShots]);

  const patchShot = (blockId: string, patch: Partial<ExpressShot>) => {
    setScreenplay(prev => {
      const cur: ExpressShot = prev.expressShots?.[blockId] ?? { status: 'idle' };
      return { ...prev, expressShots: { ...(prev.expressShots ?? {}), [blockId]: { ...cur, ...patch, updatedAt: Date.now() } } };
    });
  };

  const setShotBusy = (blockId: string, on: boolean) => {
    setBusy(prev => {
      const next = new Set(prev);
      if (on) next.add(blockId); else next.delete(blockId);
      return next;
    });
  };

  const genFrame = async (blockId: string, prompt: string) => {
    setShotBusy(blockId, true);
    patchShot(blockId, { status: 'imaging', error: undefined });
    try {
      const { blob, url } = await generateFirstFrame(imageCfg, prompt);
      const assetId = await onUploadFrame(blob, `express-${blockId}`);
      patchShot(blockId, { imageAssetId: assetId ?? undefined, imageUrl: url, status: 'image-ready' });
    } catch (e) {
      patchShot(blockId, { status: 'failed', error: String((e as Error)?.message ?? e).slice(0, 200) });
    } finally {
      setShotBusy(blockId, false);
    }
  };

  const genVideo = async (blockId: string, prompt: string, shot: ExpressShot | undefined) => {
    if (!shot?.imageUrl) return;
    setShotBusy(blockId, true);
    patchShot(blockId, { status: 'generating', error: undefined });
    try {
      // Reroll rides the SAME first frame: fetch its bytes back from the
      // display URL (asset object URL or provider URL — both are fetchable).
      const blob = await (await fetch(shot.imageUrl)).blob();
      const { videoUrl, promptId } = await generateI2V(
        comfyCfg,
        appSettings.comfyWorkflowI2V,
        { prompt, firstFrameBlob: blob, durationSeconds: duration },
      );
      patchShot(blockId, { videoUrl, videoPromptId: promptId, status: 'video-ready' });
    } catch (e) {
      patchShot(blockId, { status: shot.videoUrl ? 'video-ready' : 'failed', error: String((e as Error)?.message ?? e).slice(0, 200) });
    } finally {
      setShotBusy(blockId, false);
    }
  };

  const statusBadge = (s: ExpressShot | undefined, isBusy: boolean) => {
    if (isBusy) return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"><Loader2 className="inline w-3 h-3 animate-spin" /> …</span>;
    const map: Record<string, [string, string]> = {
      idle: [t.expressStIdle, 'bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-gray-400'],
      imaging: [t.expressStImaging, 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'],
      'image-ready': [t.expressStFrame, 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'],
      generating: [t.expressStGenerating, 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'],
      'video-ready': [t.expressStReady, 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'],
      failed: [t.expressStFailed, 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'],
    };
    const [label, cls] = map[s?.status ?? 'idle'];
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[88vh] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-zinc-700 flex flex-col">
        {/* header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <Clapperboard className="w-4 h-4 text-indigo-600" />
          <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{t.expressTitle}</div>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
              {t.expressDuration}
              <select
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                className="px-1.5 py-1 rounded-md border border-gray-200 dark:border-zinc-700 bg-transparent text-xs"
              >
                {[4, 5, 6, 8, 10].map(s => <option key={s} value={s}>{s}s</option>)}
              </select>
            </label>
            <button type="button" onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!comfyReady && (
          <div className="mx-5 mt-4 text-[11px] px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
            {t.expressNeedComfy}
          </div>
        )}

        {/* rows */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {shots.length === 0 && (
            <div className="text-xs text-gray-400 py-10 text-center">{t.expressNoShots}</div>
          )}
          {shots.map(({ blockId, index, prompt, excerpt, shot }) => {
            const isBusy = busy.has(blockId);
            const locked = !!shot?.locked;
            const thumbUrl = shot?.imageUrl ?? refImages.find(r => r.id === shot?.imageAssetId)?.url;
            return (
              <div key={blockId} className="rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <span className="text-[10px] font-mono text-gray-400 w-6">#{index}</span>
                  {/* thumb */}
                  <div className="w-16 h-10 rounded-md overflow-hidden bg-gray-100 dark:bg-zinc-800 shrink-0 flex items-center justify-center">
                    {thumbUrl
                      ? <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
                      : <ImageIcon className="w-4 h-4 text-gray-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{excerpt}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      {statusBadge(shot, isBusy)}
                      {locked && <Lock className="w-3 h-3 text-amber-500" />}
                      {shot?.error && <span className="text-[10px] text-red-500 truncate max-w-[280px]" title={shot.error}>{shot.error}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!shot?.imageUrl && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void genFrame(blockId, prompt)}
                        title={t.expressGenFrame}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />{t.expressGenFrame}
                      </button>
                    )}
                    {shot?.imageUrl && (
                      <button
                        type="button"
                        disabled={isBusy || !comfyReady || locked}
                        onClick={() => void genVideo(blockId, prompt, shot)}
                        title={locked ? t.expressLockedHint : (shot.videoUrl ? t.expressReroll : t.expressGenVideo)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                      >
                        {shot.videoUrl ? <RefreshCw className="w-3.5 h-3.5" /> : <Film className="w-3.5 h-3.5" />}
                        {shot.videoUrl ? t.expressReroll : t.expressGenVideo}
                      </button>
                    )}
                    {shot?.videoUrl && (
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === blockId ? null : blockId)}
                        className={clsx('px-2.5 py-1.5 text-[11px] font-bold rounded-lg border',
                          expanded === blockId
                            ? 'bg-gray-900 text-white border-gray-900 dark:bg-white dark:text-black dark:border-white'
                            : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-zinc-700')}
                      >
                        {t.expressPreview}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!shot?.videoUrl}
                      onClick={() => patchShot(blockId, { locked: !locked })}
                      title={locked ? t.expressUnlock : t.expressLock}
                      className={clsx('p-1.5 rounded-lg border transition-colors disabled:opacity-30',
                        locked
                          ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/40 dark:border-amber-800 dark:text-amber-300'
                          : 'text-gray-400 border-gray-200 dark:border-zinc-700 hover:text-gray-700 dark:hover:text-gray-200')}
                    >
                      {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                {expanded === blockId && shot?.videoUrl && (
                  <div className="px-3 pb-3">
                    <video src={shot.videoUrl} controls autoPlay loop muted className="w-full max-h-72 rounded-lg bg-black" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 text-gray-400" />
          <div className="text-[10px] text-gray-400 flex-1">{t.expressFootnote}</div>
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-zinc-700 rounded-lg">
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};
