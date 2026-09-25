/**
 * ①视觉编译器 —— IR→I2V/T2V 后端调用计划(P1 三路之一,docs/storyflow-ir-p1.md §2.1)。
 *
 * `compileVisualPlan` 把 StoryFlowIR 的每个镜头编译成一组**后端调用**(纯数据,
 * 无 IO):Express 路 = 首帧 T2I + I2V 对;Pro 路 = T2V(+白模 R2V)。执行器
 * (ComfyUI/MiniMax/H3)按字段照单提交,vendor 专有旋钮在扁平原语袋里透传——
 * 核心形状永远后端无关(P0 规则一)。
 */
import type { IRMode } from '../types';
import type { AnchorSource, ChainLink, ShotDurationFit } from '../shared';

/** 计划版本(独立于 IR 版本;扩展走 additive 路径)。 */
export const VISUAL_PLAN_VERSION = '0.1.0';
export type VisualPlanVersion = typeof VISUAL_PLAN_VERSION;

/** 生成后端(P0 契约 GenerationParams.backend 同枚举)。 */
export type VisualBackend = 'comfyui' | 'minimax' | 'grok';

/** 视频生成路径:
 *  i2v = 首帧图生视频(Express 管线,docs/pipeline-two-mode.md §1);
 *  t2v = 文生视频 + 参考图包(Pro 默认);
 *  r2v = 白模参考视频(Pro,`opts.whiteModelRef` 传入时才可能——运行时输入,
 *        永不进 IR)。 */
export type VideoPath = 'i2v' | 't2v' | 'r2v';

/** 参考槽(`<Picture N>` 打包契约,P1 统一规则 §3):
 *  打包序 = [场景/环境图(有则), 角色设定表(绑定序), 其余绑定 ref],严格
 *  1..N 连续编号(不跳号),上限 9;tag 只由本结构生成,不回推重算。
 *  历史双拷贝(hooks/useH3VideoPlan.ts:151-155 / :300-303)在此合一,段路径
 *  的跳号 bug 与写死故事文案的 env tag 一并修正(deviation 记档 §3)。 */
export interface RefSlot {
  /** 1..9,严格连续。 */
  index: number;
  /** → refs 注册表 id。 */
  refId: string;
  /** 注册表类别 = 语义角色。 */
  role: 'character' | 'prop' | 'scene' | 'style' | 'action';
  /** 显示名(角色变体带「名(变体)」限定)。 */
  name: string;
  /** `<Picture N>` 标签文本。 */
  tag: string;
}

export interface MaterialsPack {
  slots: RefSlot[];
  /** 身份关键槽位下标(1 起)——解决生图参考不对称(minimax image-01 单
   *  subject_reference vs fal 多图):单槽执行器据此确定性选取。规则:首个
   *  character 槽,否则首槽。槽位→厂商端口的映射属执行器侧 vendor pack,
   *  不进核心(§6 扩展策略)。 */
  primaryRefSlot?: number;
}

/** seed 策略(P0 抽卡语义:重 roll = 换新种子,永不原地变异):
 *  IR 带 seed → fixed;缺省 → reroll(每次调用注入新种子,= ComfyUI
 *  randomizeSeed 语义,services/expressService.ts:64)。 */
export interface SeedPlan {
  mode: 'fixed' | 'reroll';
  /** mode='fixed' 时的种子值。 */
  value?: number;
}

export interface ImageJobPrompt {
  /** 提交文本 = shot.imagePrompt 原样(风格前缀已在 IR 契约层强制烘焙)。 */
  text: string;
  imagePrompt: string;
}

export interface VideoJobPrompt {
  /** 组装后的提交文本:motion + 台词行(带 cue 引号逐字)+ 连续性锁句
   *  (H3 方言,utils/videoSegmentSubmit.ts:23-42)。 */
  text: string;
  motion: string;
  /** 对白逐字(引号内即此字段);无对白省略。 */
  dialogue?: string;
  /** 说话人 cue(shot.character);无省略。 */
  cue?: string;
  /** 连续性锁句(方言常量)。 */
  continuity: string;
  /** 词锚基文本 —— **逐字节等于 IR 字段**(①⇄② 缝合不变量)。② 的
   *  wordIndex 只对 anchorText 分词,永不对 text 分词。 */
  anchorText: string;
  anchorSource: AnchorSource;
}

export interface VisualJobBase {
  /** `vj-001` 格式,计划内全局顺序。 */
  jobId: string;
  shotId: string;
  backend: VisualBackend;
  chainIndex: number;
  chainCount: number;
  materials: MaterialsPack;
  seed: SeedPlan;
  /** vendor 专有旋钮,扁平原语袋无损透传(P0 规则一)。 */
  vendor?: Record<string, string | number | boolean>;
  /** 成本预估(分,整数)。仅 minimax 视频任务计价(comfy/grok 不走刊例;
   *  首帧生图另有图价目,不在此表)。 */
  estimatedCostFen?: number;
}

/** 首帧 T2I 调用(Express 路;一张图 = 一个资产,chain 1/1)。 */
export interface ImageJob extends VisualJobBase {
  kind: 'image';
  prompt: ImageJobPrompt;
  /** 生图供应商(P13,计价假设显式化):① 自 opts.imageProvider 烘焙;
   *  运行时实际 provider 可不同(差异 = 估算假设 vs 实际,结算按计划口径)。 */
  provider?: 'minimax' | 'fal';
}

export interface VideoJob extends VisualJobBase {
  kind: 'video';
  path: VideoPath;
  /** 故事时长内偏移(秒,链元累计)。 */
  offsetSeconds: number;
  /** 生成时长(秒,[4,15] 整数)。 */
  outputSeconds: number;
  prompt: VideoJobPrompt;
  /** i2v 必带:首帧来源——同计划内的首帧 job(fromJobId)或已生成资产
   *  (assetId,shot.firstFrame.assetId 回填后)。 */
  firstFrame?: { fromJobId: string; assetId?: string };
}

export type VisualJob = ImageJob | VideoJob;

/** 预检警告码(纯计划层;MP4/≤50MB 等字节级校验属运行时
 *  validateH3Submission,不进核心)。 */
export type PlanWarningCode =
  | 'REF_ASSET_MISSING'
  | 'REF_PACK_TRUNCATED'
  | 'IMAGE_PROMPT_LONG'
  | 'DIALOGUE_FLOOR_RAISES_DURATION'
  | 'AUDIO_TOO_LONG'
  | 'DIALOGUE_FLOOR_EXCEEDS_CHAIN_LINK';

export interface PlanWarning {
  code: PlanWarningCode;
  shotId?: string;
  message: string;
}

/** 镜头级计划:时长拟合摘要 + 本镜头的全部后端调用。 */
export interface VisualShotPlan {
  shotId: string;
  durationFit: ShotDurationFit;
  jobs: VisualJob[];
}

/** ①的产出:整片的后端调用计划。 */
export interface VisualCallPlan {
  version: VisualPlanVersion;
  mode: IRMode;
  shots: VisualShotPlan[];
  warnings: PlanWarning[];
}

export type { ChainLink, ShotDurationFit, AnchorSource };
