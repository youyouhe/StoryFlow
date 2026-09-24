/**
 * ②音频桥 —— AudioMixPlan → TTS/SFX/BGM 任务队列 + mixSegment 参数
 * (P2 交付物,接口清单 docs/storyflow-ir-p2.md §2.2)。
 *
 * 纯映射,零 IO:key/解算 Blob 由 `*CallRuntime` 注入。
 *
 * 映射要点:
 *   · TtsJob.parts → **逐 part 一调用**(GLM_TTS 1024 上限切分;同参 wav
 *     事后 concatWavs 拼杆)——`GlmTtsOptions.watermarkEnabled` ← IR 的
 *     `watermark`(适配器参数名不同,一一对齐)。
 *   · SegmentMix → `ProSegmentCut`:`segKey = shotId`;`ttsKeys` 按 mix.tts
 *     序取 store 键(拼杆序 = 说话序);`sfx[].atMs` 已是②计划的词锚推导值;
 *     **不可解算的 SFX 过滤出 cut**(live exportCut「missing sfx filtered
 *     out」口径)。增益执行值在 ffmpeg 滤镜层(muxSegment 内置),不进
 *     ProSegmentCut。
 */
import type { AudioMixPlan, TtsJob } from '../ir/audio/types';
import type { ProSegmentCut } from '../../services/videoExport';
import type {
  BgmCall, BgmCallRuntime, MixCallRuntime, SfxCall, TtsCall, TtsCallRuntime,
} from './types';

/** ② TTS 合成任务队列:job 序 × part 序,逐 part 一 `synthesizeSpeech` 调用。 */
export const mapAudioPlanToTtsQueue = (
  plan: AudioMixPlan,
  rt: TtsCallRuntime,
): TtsCall[] => {
  const calls: TtsCall[] = [];
  for (const job of plan.jobs) {
    if (job.kind !== 'tts') continue;
    const opts = ttsOptsOf(job);
    job.parts.forEach((part, partIndex) => {
      calls.push({ clipId: job.clipId, partIndex, apiKey: rt.apiKey, input: part, opts });
    });
  }
  return calls;
};

const ttsOptsOf = (job: TtsJob): TtsCall['opts'] => ({
  voice: job.voice,
  ...(job.speed != null ? { speed: job.speed } : {}),
  ...(job.volume != null ? { volume: job.volume } : {}),
  ...(job.watermark != null ? { watermarkEnabled: job.watermark } : {}),
});

/** ② SFX 解算队列:一 clip 一 `resolveSfx(name)` 查表(缺失同样入列,
 *  查表是幂等探测;SFX_MISSING 已由②计划层标记)。 */
export const mapAudioPlanToSfxQueue = (plan: AudioMixPlan): SfxCall[] =>
  plan.jobs.flatMap((job): SfxCall[] =>
    job.kind === 'sfx' ? [{ clipId: job.clipId, name: job.name }] : []);

/** ② BGM 请求队列:一床一 `requestMusic(falKey, prompt)`(pollMusic 轮询)。 */
export const mapAudioPlanToBgmQueue = (
  plan: AudioMixPlan,
  rt: BgmCallRuntime,
): BgmCall[] =>
  plan.jobs.flatMap((job): BgmCall[] =>
    job.kind === 'bgm'
      ? [{ clipId: job.clipId, falKey: rt.falKey, prompt: job.prompt }]
      : []);

/** ② 混音计划 → `exportProCut` 的 `ProSegmentCut[]`(段序 = plan.mix 序 =
 *  镜头序)。不可解算 SFX 过滤(live exportCut 口径);空可选字段省略。 */
export const mapMixToProSegmentCuts = (
  plan: AudioMixPlan,
  rt: MixCallRuntime,
): ProSegmentCut[] =>
  plan.mix.map(seg => {
    const sfx = seg.sfx.flatMap(s => {
      const blob = rt.blobOf(s.clipId);
      return blob ? [{ blob, atMs: s.atMs }] : [];
    });
    return {
      videoUrl: rt.videoUrlOf(seg.shotId),
      segKey: seg.shotId,
      ...(seg.tts.length ? { ttsKeys: seg.tts.map(t => rt.keyOf(t.clipId)) } : {}),
      ...(seg.bgm ? { bgmUrl: rt.bgmUrlOf(seg.bgm.clipId) } : {}),
      ...(sfx.length ? { sfx } : {}),
    };
  });
