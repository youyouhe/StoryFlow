import React, { useMemo, useState } from 'react';
import { Loader2, Music, Mic, Volume2, Download, TriangleAlert } from 'lucide-react';
import { clsx } from 'clsx';
import { Screenplay, AppSettings } from '../types';
import { TRANSLATIONS } from '../constants';
import { VideoPlan } from '../utils/videoPlan';
import { collectCharacterNames } from '../utils/beatCast';
import { GLM_VOICES, GLM_DEFAULT_VOICE, synthesizeSpeech, getGlmTtsKey } from '../services/glmTtsService';
import { getFalToken, requestMusic, pollMusic, buildBgmPrompt } from '../services/falMusicService';
import { suggestSfx } from '../services/sfxService';
import { putAudio, getAudio, audioKeys } from '../services/proAudioStore';
import { audioLowerBoundSeconds, fitSegmentSeconds } from '../utils/proAudio';
import { baseCharName } from '../utils/beatCast';

/**
 * ProAudioPanel — Pro mode's audio workbench inside the VIDEO_PLAN modal
 * (docs/pipeline-two-mode.md §6): per-segment dialogue TTS (character→voice),
 * one BGM bed per scene (fal sonilo), SFX suggestions, and the TTS lower-bound
 * fit for every segment. Audio bytes live in the session store; metadata
 * (line/voice/seconds/url) persists in screenplay.proAudio.
 */
interface ProAudioPanelProps {
  videoPlan: VideoPlan;
  screenplay: Screenplay;
  setScreenplay: React.Dispatch<React.SetStateAction<Screenplay>>;
  appSettings: AppSettings;
  t: typeof TRANSLATIONS['en'];
  lang: 'en' | 'zh';
  onToast?: (msg: string) => void;
}

export const ProAudioPanel: React.FC<ProAudioPanelProps> = ({
  videoPlan, screenplay, setScreenplay, appSettings, t, lang, onToast,
}) => {
  const isZh = lang === 'zh';
  const [busy, setBusy] = useState<string | null>(null);
  const characters = useMemo(() => collectCharacterNames(screenplay.blocks), [screenplay.blocks]);
  const glmKey = getGlmTtsKey();
  const falKey = (getFalToken() || appSettings.falKey).trim();
  const stylePreset = screenplay.metadata.styleHead?.scenePreset;

  const patchAudio = (segKey: string, patch: Partial<NonNullable<Screenplay['proAudio']>[string]>) => {
    setScreenplay(prev => ({
      ...prev,
      proAudio: {
        ...(prev.proAudio ?? {}),
        [segKey]: { ...(prev.proAudio?.[segKey] ?? {}), ...patch },
      },
    }));
  };

  const setVoice = (char: string, voice: string) => {
    setScreenplay(prev => ({
      ...prev,
      voiceCast: { ...(prev.voiceCast ?? {}), [char]: voice || GLM_DEFAULT_VOICE },
    }));
  };

  const voiceOf = (cue: string | undefined): string =>
    (cue ? screenplay.voiceCast?.[baseCharName(cue)] : undefined) ?? GLM_DEFAULT_VOICE;

  /** Synthesize every dialogue line of one segment (sequential, cached). */
  const synthSegment = async (segKey: string, lines: { cue?: string; line: string }[]) => {
    if (!glmKey) {
      onToast?.(isZh ? '未配置 BIGMODEL_TOKEN——TTS 需要该环境变量。' : 'BIGMODEL_TOKEN missing — required for TTS.');
      return;
    }
    setBusy(`tts:${segKey}`);
    try {
      const tracks: NonNullable<Screenplay['proAudio']>[string]['tts'] = [];
      for (let i = 0; i < lines.length; i++) {
        const { cue, line } = lines[i];
        const key = audioKeys.tts(segKey, i);
        if (!getAudio(key)) {
          const wav = await synthesizeSpeech(glmKey, line, { voice: voiceOf(cue) });
          putAudio(key, wav);
        }
        const buf = await (getAudio(key) as Blob).arrayBuffer();
        const { wavDuration } = await import('../services/glmTtsService');
        tracks.push({
          line, charName: cue ? baseCharName(cue) : undefined,
          voice: voiceOf(cue), url: key, seconds: Math.round(wavDuration(buf) * 100) / 100,
        });
      }
      patchAudio(segKey, { tts: tracks });
      onToast?.(isZh ? `本段对白 TTS 完成(${tracks.length} 句)` : `TTS done (${tracks.length} lines)`);
    } catch (e) {
      onToast?.(String((e as Error)?.message ?? e).slice(0, 140));
    } finally {
      setBusy(null);
    }
  };

  /** One music bed per scene heading (fal queue, cached by prompt). */
  const requestBgm = async (segKey: string, sceneHeading: string) => {
    if (!falKey) {
      onToast?.(isZh ? '未配置 FAL_TOKEN——BGM 需要 FAL。' : 'FAL_TOKEN missing — required for BGM.');
      return;
    }
    setBusy(`bgm:${segKey}`);
    try {
      const prompt = buildBgmPrompt(stylePreset, sceneHeading);
      const { requestId, statusUrl, responseUrl } = await requestMusic(falKey, prompt);
      let poll = await pollMusic(falKey, { requestId, statusUrl, responseUrl });
      while (poll.status === 'queued' || poll.status === 'running') {
        await new Promise(r => setTimeout(r, 5000));
        poll = await pollMusic(falKey, { requestId, statusUrl, responseUrl });
      }
      if (poll.status !== 'succeeded' || !poll.audioUrl) throw new Error(poll.errorMessage ?? 'BGM 失败');
      const blob = await (await fetch(poll.audioUrl)).blob();
      putAudio(audioKeys.bgm(segKey), blob);
      patchAudio(segKey, { bgm: { prompt, url: poll.audioUrl } });
      onToast?.(isZh ? 'BGM 已生成' : 'BGM ready');
    } catch (e) {
      onToast?.(String((e as Error)?.message ?? e).slice(0, 140));
    } finally {
      setBusy(null);
    }
  };

  const suggestSegmentSfx = async (segKey: string, text: string) => {
    setBusy(`sfx:${segKey}`);
    try {
      const hit = await suggestSfx(text);
      const list = hit
        ? [{ name: hit.name, url: hit.url, missing: hit.missing }]
        : [{ name: text.slice(0, 12), missing: true }];
      patchAudio(segKey, { sfx: list });
    } finally {
      setBusy(null);
    }
  };

  const dialogueCount = (seg: VideoPlan['segments'][number]) =>
    seg.beats.reduce((n, b) => n + b.dialogues.length, 0);

  return (
    <div className="mt-3 rounded-xl border border-violet-300 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-bold text-violet-700 dark:text-violet-300">
        <Volume2 className="w-3.5 h-3.5" />{t.proAudioTitle}
      </div>

      {/* voice cast */}
      {characters.length > 0 && (
        <div className="rounded-lg border border-violet-200 dark:border-violet-800 p-2.5 space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t.proVoiceCast}</div>
          {characters.map(c => (
            <div key={c} className="flex items-center gap-2 text-xs">
              <span className="w-20 truncate text-gray-700 dark:text-gray-300" title={c}>{c}</span>
              <select
                value={screenplay.voiceCast?.[c] ?? GLM_DEFAULT_VOICE}
                onChange={e => setVoice(c, e.target.value)}
                className="flex-1 px-2 py-1 rounded-md border border-gray-200 dark:border-zinc-700 bg-transparent text-[11px]"
              >
                {GLM_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          ))}
          {!glmKey && (
            <div className="text-[10px] text-amber-600 dark:text-amber-400">{t.proNeedBigmodel}</div>
          )}
        </div>
      )}

      {/* per-segment tracks */}
      <div className="space-y-2">
        {videoPlan.segments.map(seg => {
          const segKey = seg.blockIds[0];
          const audio = screenplay.proAudio?.[segKey];
          const lines = seg.beats.flatMap(b => b.dialogues.map(d => ({ cue: d.cue, line: d.line })));
          const ttsSeconds = (audio?.tts ?? []).map(x => x.seconds);
          const fit = fitSegmentSeconds(seg.duration, ttsSeconds);
          const isBusy = busy !== null && busy.endsWith(segKey);
          return (
            <div key={segKey} className="rounded-lg border border-violet-200 dark:border-violet-800 px-2.5 py-2 space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                <span className="font-mono text-gray-400">#{seg.index}</span>
                <span className="truncate flex-1">{seg.sceneHeading || '—'}</span>
                {fit.audioTooLong && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 dark:text-red-400" title={t.proAudioTooLongHint}>
                    <TriangleAlert className="w-3 h-3" />AUDIO_TOO_LONG
                  </span>
                )}
              </div>

              {/* dialogue */}
              {dialogueCount(seg) > 0 && (
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    disabled={isBusy || !glmKey}
                    onClick={() => void synthSegment(segKey, lines)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white font-bold disabled:opacity-50"
                  >
                    {busy === `tts:${segKey}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
                    {t.proSynthTts} ({dialogueCount(seg)})
                  </button>
                  {audio?.tts && (
                    <span className="text-[10px] text-gray-500">
                      {t.proLowerBound}: {audioLowerBoundSeconds(ttsSeconds)}s → {t.proFitOut}: <b>{fit.outputSeconds}s</b>
                    </span>
                  )}
                </div>
              )}

              {/* bgm + sfx row */}
              <div className="flex items-center gap-2 text-[11px] flex-wrap">
                <button
                  type="button"
                  disabled={isBusy || !falKey}
                  onClick={() => void requestBgm(segKey, seg.sceneHeading)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 font-bold disabled:opacity-50"
                >
                  {busy === `bgm:${segKey}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Music className="w-3 h-3" />}
                  {audio?.bgm ? t.proBgmRedo : t.proBgmRequest}
                </button>
                {audio?.bgm && <span className="text-[10px] text-emerald-600 dark:text-emerald-400">✓</span>}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void suggestSegmentSfx(segKey, seg.beats[0]?.text ?? seg.sceneHeading)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-gray-300 font-bold disabled:opacity-50"
                >
                  {busy === `sfx:${segKey}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                  {t.proSfxSuggest}
                </button>
                {audio?.sfx?.map(s => (
                  <span key={s.name} className={clsx('text-[10px] px-1.5 py-0.5 rounded-full', s.missing
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300')}>
                    {s.missing ? `SFX_MISSING:${s.name}` : `SFX:${s.name}`}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-gray-400">{t.proAudioFootnote}</div>
      <Download className="hidden" />
    </div>
  );
};
