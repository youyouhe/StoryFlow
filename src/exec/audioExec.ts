/**
 * 音频执行器 —— AudioMixPlan → TTS 合成/拼杆/探活 + SFX 查表 + BGM 轮询
 * (docs/storyflow-ir-p3.md §2.3)。
 *
 * 全 IO 只经 `deps.ports`;参数打包复用 P2 桥映射。单 clip 失败不中断其余
 * (P2「失败=新调用」);`measurements` 即②编译 `opts.measured` 的回填输入——
 * 合成→探活→回填→重编时间轴,闭合 P1 缝合不变量(锚是作者身份,毫秒是编译产物)。
 */
import type { AlignmentTake, AudioMixPlan, WordTimingCorrection } from '../ir/audio/types';
import { applyManualTiming } from '../ir/audio/timing';
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


/** P5:逐 clip 逐词对齐(`alignTake` port;未绑定即抛——拒绝而非钳制)。
 *  产出 = ② 编译 `opts.alignments` 的输入;单 clip 失败不中断其余。 */
export const alignAudioClips = async (
  clipBlobs: Record<string, Blob>,
  plan: AudioMixPlan,
  deps: AudioExecDeps,
  opts: { corrections?: Record<string, WordTimingCorrection[]> } = {},
): Promise<{
  takes: Record<string, AlignmentTake>;
  failures: { clipId: string; error: string }[];
}> => {
  const alignTake = deps.ports.alignTake;
  if (!alignTake) {
    throw new Error('未绑定对齐服务(alignTake)——拒绝而非钳制(见 docs/storyflow-ir-p5.md §5)');
  }
  const takes: Record<string, AlignmentTake> = {};
  const failures: { clipId: string; error: string }[] = [];
  for (const job of plan.jobs) {
    if (job.kind !== 'tts') continue;
    const blob = clipBlobs[job.clipId];
    if (!blob) continue;
    try {
      // clipId 由 runner 权威盖章(对齐服务只见 wav+text)
      let take: AlignmentTake = { ...(await alignTake(blob, job.text)), clipId: job.clipId };
      // P10:随稿校时自动套用(作者窗覆盖;非法进 failures 不中断)
      const fixes = opts.corrections?.[job.clipId];
      if (fixes?.length) take = applyManualTiming(take, fixes);
      takes[job.clipId] = take;
    } catch (e) {
      failures.push({ clipId: job.clipId, error: errMsg(e) });
    }
  }
  return { takes, failures };
};
