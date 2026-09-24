/**
 * ②音频编译器 —— 边界契约(P1 三路之一,docs/storyflow-ir-p1.md §2.2)。
 *
 * 本文件 + `schema.ts`(防漂移)+ `compile.ts`(桩)锁定 ② 的输入输出形状;
 * 实现归 P1-② 实例。职责:IR 音轨 → 三轨合成任务 + **词级锚定→时间轴** +
 * 三轨混音计划(= services/videoExport.ts muxSegment 契约的数据化)。
 */
import type { SfxAnchor } from '../types';
import type { ShotDurationFit } from '../shared';
import type { WordTimingCorrection } from './timing';
export type { WordTimingCorrection };

/** 0.2.0(P5):新增 alignments 输入 + ALIGNMENT_UNUSABLE 警告码(additive minor)。 */
export const AUDIO_MIX_PLAN_VERSION = '0.2.0';
export type AudioMixPlanVersion = typeof AUDIO_MIX_PLAN_VERSION;

/** 混音增益常量 —— 与 services/videoExport.ts:230-238 (muxSegment 的
 *  filter_complex 参数)一一对应,实现处不得另起数值:
 *  对白 `volume=1.0`、BGM `volume=0.25`(+`-stream_loop -1` 循环)、
 *  SFX `adelay=${atMs}:all=1,volume=0.8`、`amix=…:normalize=0`。 */
export const MIX_GAIN_TTS = 1.0;
export const MIX_GAIN_BGM = 0.25;
export const MIX_GAIN_SFX = 0.8;
export const MIX_BGM_LOOP = true;

/** TTS 合成任务 —— GLM-TTS 适配器参数(服务层 glmTtsService 的纯侧)。 */
export interface TtsJob {
  kind: 'tts';
  clipId: string;
  shotId: string;
  character?: string;
  /** 台词逐字(IR TtsClip.text)。 */
  text: string;
  /** ≤1024 字分段(GLM_TTS_MAX_INPUT 规则,splitForTts 语义:标点贪心切、
   *  超长句硬切)。实现由 text 推导,此处固化供执行器逐段合成后拼 wav。 */
  parts: string[];
  /** 系统音色或复刻 id 透传。 */
  voice: string;
  /** 0.5–2。 */
  speed?: number;
  /** 0.5–2。 */
  volume?: number;
  /** 水印(适配器默认 true)。 */
  watermark?: boolean;
}

/** BGM 床任务 —— fal sonilo 适配器(falMusicService buildBgmPrompt 语义)。 */
export interface BgmJob {
  kind: 'bgm';
  clipId: string;
  fromShotId: string;
  /** 缺省 = 铺到片尾。 */
  toShotId?: string;
  prompt: string;
  loop: boolean;
  gain: number;
}

/** SFX 任务 —— manifest 匹配(missing = SFX_MISSING 保留,不静默丢弃)。 */
export interface SfxJob {
  kind: 'sfx';
  clipId: string;
  shotId: string;
  name: string;
  /** 词级锚(P0 契约 SfxAnchor);atMs 由 ② 从锚推导。 */
  anchor: SfxAnchor;
  missing?: boolean;
  gain: number;
}

export type AudioJob = TtsJob | BgmJob | SfxJob;

/** 词锚→时间轴条目(词级锚定非秒级:锚是作者身份,毫秒是编译产物)。
 *  v1 推导:按字素比例把 measuredSeconds 摊到 splitAnchorWords token 窗口
 *  (无逐词对齐;WhisperX 级对齐是 P2 升级位)。 */
export interface TimelineEntry {
  clipId: string;
  /** 段内绝对偏移(毫秒)。 */
  startMs: number;
  /** 已探活才有的时长(毫秒)。 */
  durationMs?: number;
}

/** 段混音计划 —— ProSegmentCut(services/videoExport.ts:175-182)的声明化:
 *  每段 video + 顺序对白 + 循环 BGM + 偏移 SFX,amix normalize=0。 */
export interface SegmentMix {
  shotId: string;
  tts: { clipId: string; gain: number }[];
  bgm?: { clipId: string; gain: number; loop: boolean };
  sfx: { clipId: string; atMs: number; gain: number }[];
}

export type AudioWarningCode =
  | 'TTS_ANCHOR_UNMATCHED'
  | 'AUDIO_TOO_LONG'
  | 'SFX_MISSING'
  | 'SFX_ANCHOR_OUT_OF_RANGE'
  | 'ALIGNMENT_UNUSABLE'
  | 'TIMING_INVALID';

export interface AudioWarning {
  code: AudioWarningCode;
  shotId?: string;
  message: string;
}

export interface AudioShotFit {
  shotId: string;
  durationFit: ShotDurationFit;
}

/** ②的产出:三轨任务 + 词锚时间轴 + 混音计划 + 时长拟合。 */
export interface AudioMixPlan {
  version: AudioMixPlanVersion;
  jobs: AudioJob[];
  timeline: TimelineEntry[];
  mix: SegmentMix[];
  fits: AudioShotFit[];
  warnings: AudioWarning[];
}

/** 逐词对齐的一枚 token 窗(P5,hypit SemanticTake.tokens 映射)。 */
export interface AlignedToken {
  /** 作者身份 = 词锚基文本的 token 下标(splitAnchorWords 同款,0 起)。 */
  tokenIndex: number;
  /** 声学证据上的词形(N:M 分组时多 token 共享窗)。 */
  text?: string;
  /** clip 内时间窗(毫秒)。 */
  startMs: number;
  endMs: number;
  /** 对齐置信 0–1;低置信词允许手动校时(hypit「标注低置信词」)。 */
  confidence?: number;
}

/** 对齐件(SemanticTake 形状,docs/storyflow-ir-p5.md §2)——IO 边缘(对齐
 *  服务)对已合成音频的测量产物,**不进 IR**(锚是作者身份,毫秒是编译产物)。
 *  自含:杆长与文本指纹随件走。 */
export interface AlignmentTake {
  /** 新鲜度指纹 = 对齐所依据的锚基文本全文;不匹配即 stale → 回退字素比例。 */
  text: string;
  /** 对齐的音频 clip(TtsClip id)。 */
  clipId: string;
  /** 归一化杆长(毫秒;与 measured 双源互证,不一致以 measured 为准)。 */
  durationMs: number;
  tokens: AlignedToken[];
}

/** ②入口输入:探活秒数/对齐件由 IO 边缘传入(纯编译层不碰 Blob/网络)。 */
export interface AudioCompileOptions {
  /** clipId → 已探活 wav 秒数(①⇄② 缝合:缺项的 clip 不进时间轴,警告)。 */
  measured?: Record<string, number>;
  /** clipId → 逐词对齐件(P5)。word→ms 优先对齐窗,无/失效回退字素比例。 */
  alignments?: Record<string, AlignmentTake>;
  /** P10 注释校时(随稿持久化形态):clipId → 作者窗,自动套在对齐件上
   *  (applyTimingCorrections;非法 clip 逐条隔离 → TIMING_INVALID 警告)。 */
  timing?: Record<string, WordTimingCorrection[]>;
}
