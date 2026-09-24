/**
 * P9 价目与精确结算(orchestration StoryFlow#7,docs/storyflow-ir-p9.md)。
 *
 * 费率**输入制**(provider 刊例声明,分整数,P0 规则三);本层只实现计价口径
 * (图按张 / TTS 按字符 / BGM 按次 / SFX 本地免费)与汇总——不编造刊例数值。
 * **精确结算 = 按实际产出**:succeeded 才计,failed/timeout/skipped 不计
 * (远端账单为准;与 P6「发起即计」并存,`settlement` 选项切换)。
 */
import type { ImageJob, VisualCallPlan } from '../ir/visual/types';
import type { AudioMixPlan, TtsJob, BgmJob, SfxJob } from '../ir/audio/types';
import type { AudioRunResult, VisualRunResult } from './types';

/** 价目表(provider 刊例声明,分整数;缺任一价目 = 该类条目回退 unpriced)。 */
export interface PriceBooks {
  /** 生图:每张(每 image job 一张,① opts.n=1 口径)。 */
  image?: { perImageFen: number };
  /** TTS:每字符(实际合成文本用量,TtsJob.text 的 UTF-16 码元数)。 */
  tts?: { perCharFen: number };
  /** BGM:每次请求(每床一条)。 */
  bgm?: { perRequestFen: number };
}

// ── 逐条目计价(纯;null = 无价目 → unpriced) ───────────────────────────────

export const imageJobCostFen = (job: ImageJob, books?: PriceBooks): number | null =>
  books?.image ? books.image.perImageFen : null;

export const ttsClipCostFen = (job: TtsJob, books?: PriceBooks): number | null =>
  books?.tts ? books.tts.perCharFen * job.text.length : null;

export const bgmClipCostFen = (job: BgmJob, books?: PriceBooks): number | null =>
  books?.bgm ? books.bgm.perRequestFen : null;

/** SFX = 本地 manifest 免费(已知零价,非 unpriced)。 */
export const SFX_COST_FEN = 0;

// ── 视觉计划:计价(① estimatedCostFen + 图价目) ───────────────────────────

export interface SettledJob {
  jobId: string;
  shotId: string;
  status: 'succeeded' | 'failed' | 'timeout' | 'skipped';
  costFen: number;
  priced: boolean;
}

/** 精确结算(视觉):按实际产出计费——succeeded 才计,failed/timeout/skipped 0。
 *  逐 job 成本源:① baked estimatedCostFen(minimax 视频)+ 图价目(books)。 */
export const settleVisualRun = (
  plan: VisualCallPlan,
  result: VisualRunResult,
  books?: PriceBooks,
): {
  chargedCostFen: number;
  settled: SettledJob[];
  unpricedJobIds: string[];
} => {
  const costByJob = new Map<string, { cost: number; priced: boolean; shotId: string }>();
  for (const shot of plan.shots) {
    for (const job of shot.jobs) {
      const baked = job.kind === 'video' ? job.estimatedCostFen : undefined;
      if (baked != null) {
        costByJob.set(job.jobId, { cost: baked, priced: true, shotId: job.shotId });
      } else if (job.kind === 'image') {
        const c = imageJobCostFen(job, books);
        costByJob.set(job.jobId, { cost: c ?? 0, priced: c != null, shotId: job.shotId });
      } else {
        costByJob.set(job.jobId, { cost: 0, priced: false, shotId: job.shotId });
      }
    }
  }
  let chargedCostFen = 0;
  const settled: SettledJob[] = result.results.map(r => {
    const entry = costByJob.get(r.jobId);
    const succeeded = r.status === 'succeeded';
    const cost = succeeded && entry?.priced ? entry.cost : 0;
    chargedCostFen += cost;
    return {
      jobId: r.jobId,
      shotId: r.shotId,
      status: r.status as SettledJob['status'],
      costFen: cost,
      priced: entry?.priced ?? false,
    };
  });
  const unpricedJobIds = [...costByJob.entries()]
    .filter(([, v]) => !v.priced)
    .map(([jobId]) => jobId);
  return { chargedCostFen, settled, unpricedJobIds };
};

// ── 音频计划:三轨计价 + 实际用量结算 ───────────────────────────────────────

export interface AudioCostReport {
  totalCostFen: number;
  byClip: { clipId: string; kind: 'tts' | 'bgm' | 'sfx'; costFen: number; priced: boolean }[];
  unpricedClipIds: string[];
}

/** 音频三轨计价(全量计划口径——预算/估算用)。 */
export const audioCostReport = (
  plan: AudioMixPlan,
  books?: PriceBooks,
): AudioCostReport => {
  const byClip: AudioCostReport['byClip'] = [];
  let totalCostFen = 0;
  const unpricedClipIds: string[] = [];
  for (const job of plan.jobs) {
    let cost: number | null;
    let kind: 'tts' | 'bgm' | 'sfx';
    if (job.kind === 'tts') {
      cost = ttsClipCostFen(job, books);
      kind = 'tts';
    } else if (job.kind === 'bgm') {
      cost = bgmClipCostFen(job, books);
      kind = 'bgm';
    } else {
      cost = SFX_COST_FEN;
      kind = 'sfx';
    }
    const costFen = cost ?? 0;
    byClip.push({ clipId: job.clipId, kind, costFen, priced: cost != null });
    if (cost != null) totalCostFen += costFen;
    else unpricedClipIds.push(job.clipId);
  }
  return { totalCostFen, byClip, unpricedClipIds };
};

/** 精确结算(音频):按实际用量——TTS 只计实际合成 clip(clipBlobs 在场,
 *  失败 clip 不在),BGM 只计拿到 URL 的床;SFX 本地免费恒 0。 */
export const settleAudioRun = (
  plan: AudioMixPlan,
  run: AudioRunResult,
  books?: PriceBooks,
): {
  chargedCostFen: number;
  settled: { clipId: string; kind: 'tts' | 'bgm' | 'sfx'; costFen: number; priced: boolean }[];
  unpricedClipIds: string[];
} => {
  const synthesized = new Set(Object.keys(run.clipBlobs));
  const delivered = new Set(Object.keys(run.bgmUrls));
  const byClip: ReturnType<typeof settleAudioRun>['settled'] = [];
  let chargedCostFen = 0;
  const unpricedClipIds: string[] = [];
  for (const job of plan.jobs) {
    let cost: number | null;
    let kind: 'tts' | 'bgm' | 'sfx';
    let produced: boolean;
    if (job.kind === 'tts') {
      cost = ttsClipCostFen(job, books);
      kind = 'tts';
      produced = synthesized.has(job.clipId);
    } else if (job.kind === 'bgm') {
      cost = bgmClipCostFen(job, books);
      kind = 'bgm';
      produced = delivered.has(job.clipId);
    } else {
      cost = SFX_COST_FEN;
      kind = 'sfx';
      produced = true; // 本地查表,无远端消耗
    }
    const costFen = cost != null && produced ? cost : 0;
    byClip.push({ clipId: job.clipId, kind, costFen, priced: cost != null });
    if (cost != null) chargedCostFen += costFen;
    else unpricedClipIds.push(job.clipId);
  }
  return { chargedCostFen, settled: byClip, unpricedClipIds };
};
