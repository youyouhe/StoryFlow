/**
 * 音频执行器 —— AudioMixPlan → TTS 合成/拼杆/探活 + SFX 查表 + BGM 轮询
 * (docs/storyflow-ir-p3.md §2.3)。
 *
 * 全 IO 只经 `deps.ports`;参数打包复用 P2 桥映射。单 clip 失败不中断其余
 * (P2「失败=新调用」);`measurements` 即②编译 `opts.measured` 的回填输入——
 * 合成→探活→回填→重编时间轴,闭合 P1 缝合不变量(锚是作者身份,毫秒是编译产物)。
 */
import type { AudioMixPlan } from '../ir/audio/types';
import {
  mapAudioPlanToBgmQueue, mapAudioPlanToSfxQueue, mapAudioPlanToTtsQueue,
} from '../bridge/audio';
import type { AudioExecDeps, AudioRunResult, ExecOptions } from './types';
import { pollUntil, errMsg } from './poll';

export const executeAudioPlan = async (
  plan: AudioMixPlan,
  deps: AudioExecDeps,
  opts: ExecOptions = {},
): Promise<AudioRunResult> => {
  const clipBlobs: Record<string, Blob> = {};
  const measurements: Record<string, number> = {};
  const sfxResolutions: AudioRunResult['sfxResolutions'] = {};
  const bgmUrls: Record<string, string> = {};
  const failures: AudioRunResult['failures'] = [];

  // ---- TTS:逐 part 合成 → 每 clip 拼杆 → 探活 -----------------------------
  const partsByClip = new Map<string, Blob[]>();
  for (const call of mapAudioPlanToTtsQueue(plan, { apiKey: deps.ttsApiKey })) {
    try {
      const blob = await deps.ports.synthesizeSpeech(call.apiKey, call.input, call.opts);
      const arr = partsByClip.get(call.clipId) ?? [];
      arr.push(blob);
      partsByClip.set(call.clipId, arr);
    } catch (e) {
      failures.push({ clipId: call.clipId, error: errMsg(e) });
    }
  }
  for (const [clipId, parts] of partsByClip) {
    try {
      const blob = parts.length > 1 ? await deps.ports.concatWavs(parts) : parts[0];
      clipBlobs[clipId] = blob;
      measurements[clipId] = deps.ports.wavDuration(await blob.arrayBuffer());
    } catch (e) {
      failures.push({ clipId, error: errMsg(e) });
    }
  }

  // ---- SFX:manifest 查表(missing 如实保留) --------------------------------
  for (const call of mapAudioPlanToSfxQueue(plan)) {
    try {
      sfxResolutions[call.clipId] = await deps.ports.resolveSfx(call.name);
    } catch (e) {
      failures.push({ clipId: call.clipId, error: errMsg(e) });
    }
  }

  // ---- BGM:提交 → 轮询收集 ------------------------------------------------
  for (const call of mapAudioPlanToBgmQueue(plan, { falKey: deps.falKey })) {
    try {
      const req = await deps.ports.requestMusic(call.falKey, call.prompt);
      const term = await pollUntil(
        async () => {
          const r = await deps.ports.pollMusic(call.falKey, req);
          return { status: r.status, videoUrl: r.audioUrl, errorMessage: r.errorMessage };
        },
        opts,
        { jobId: call.clipId, shotId: '' },
      );
      if (term.status === 'succeeded' && term.url) bgmUrls[call.clipId] = term.url;
      else failures.push({ clipId: call.clipId, error: term.error ?? 'BGM 生成失败' });
    } catch (e) {
      failures.push({ clipId: call.clipId, error: errMsg(e) });
    }
  }

  return { clipBlobs, measurements, sfxResolutions, bgmUrls, failures };
};
