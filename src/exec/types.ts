/**
 * P3 真执行器 —— ports(IO 接缝)+ 运行结果形状(docs/storyflow-ir-p3.md §2)。
 *
 * ports 覆盖执行器触碰的**每一个** services 函数(含纯侧,如
 * comfyPatchWorkflow/wavDuration)——单一接缝 ⇒ 全时序可 mock。签名自
 * services 推导(`Parameters<typeof import(…)>`),services 变则编译红,
 * 修执行器不修 services(不碰生产)。
 */
import type { SfxResolution } from '../../services/sfxService';
import type { ResolvedRef } from '../bridge/types';
import type { VisualCallPlan } from '../ir/visual/types';
import type { AlignmentTake } from '../ir/audio/types';

// ── 服务签名推导源 ─────────────────────────────────────────────────────────

type GenerateImagesFn = typeof import('../../services/minimaxService').generateImages;
type UploadH3VideoFn = typeof import('../../services/minimaxService').uploadH3Video;
type CreateH3TaskFn = typeof import('../../services/minimaxService').createH3Task;
type QueryH3TaskFn = typeof import('../../services/minimaxService').queryH3Task;
type ComfyUploadImageFn = typeof import('../../services/comfyService').comfyUploadImage;
type ComfyPatchFn = typeof import('../../services/comfyService').comfyPatchWorkflow;
type ComfyQueuePromptFn = typeof import('../../services/comfyService').comfyQueuePrompt;
type ComfyQueryTaskFn = typeof import('../../services/comfyService').comfyQueryTask;
type SynthesizeSpeechFn = typeof import('../../services/glmTtsService').synthesizeSpeech;
type ConcatWavsFn = typeof import('../../services/glmTtsService').concatWavs;
type WavDurationFn = typeof import('../../services/glmTtsService').wavDuration;
type ResolveSfxFn = typeof import('../../services/sfxService').resolveSfx;
type RequestMusicFn = typeof import('../../services/falMusicService').requestMusic;
type PollMusicFn = typeof import('../../services/falMusicService').pollMusic;
type ExportProCutFn = typeof import('../../services/videoExport').exportProCut;
type ConcatClipsFn = typeof import('../../services/videoExport').concatClipsToMp4;

// ── ports ──────────────────────────────────────────────────────────────────

export interface VisualExecPorts {
  generateImages: GenerateImagesFn;
  uploadH3Video: UploadH3VideoFn;
  createH3Task: CreateH3TaskFn;
  queryH3Task: QueryH3TaskFn;
  comfyUploadImage: ComfyUploadImageFn;
  comfyPatchWorkflow: ComfyPatchFn;
  comfyQueuePrompt: ComfyQueuePromptFn;
  comfyQueryTask: ComfyQueryTaskFn;
}

export interface AudioExecPorts {
  synthesizeSpeech: SynthesizeSpeechFn;
  concatWavs: ConcatWavsFn;
  wavDuration: WavDurationFn;
  resolveSfx: ResolveSfxFn;
  requestMusic: RequestMusicFn;
  pollMusic: PollMusicFn;
  /** P5 逐词对齐(WhisperX 类服务,IO 边缘);未绑定 = 不可对齐,② 编译层
   *  回退字素比例。真服务接线属命名扩展位(wiring 故意不绑)。 */
  alignTake?: (blob: Blob, text: string) => Promise<AlignmentTake>;
}

export interface ExportExecPorts {
  exportProCut: ExportProCutFn;
  concatClipsToMp4: ConcatClipsFn;
  /** P14 字幕烧录(libass;可选绑定)——默认 ffmpeg.wasm core 无 libass,
   *  桌面全量 ffmpeg/自管 worker 核心可切时才可用(docs/storyflow-ir-p14.md §1)。
   *  未绑定 = 不可烧录,执行步显式抛错(拒绝而非钳制)。 */
  burnSubtitles?: (input: {
    video: Blob;
    /** SRT/ASS 文本(由 captions 序列化器产出)。 */
    subtitles: string;
    format: 'srt' | 'ass';
  }) => Promise<Blob>;
}

// ── 执行选项/事件 ──────────────────────────────────────────────────────────

export interface ExecEvent {
  jobId?: string;
  shotId?: string;
  phase: 'submitting' | 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'skipped';
  detail?: string;
}

export interface ExecOptions {
  /** 轮询间隔(缺省 10_000 = live H3 口径)。 */
  pollIntervalMs?: number;
  /** 单任务总时限(缺省 30 分钟 = live stale guard 口径)。 */
  timeoutMs?: number;
  /** 测试注入假时钟。 */
  now?: () => number;
  /** 测试注入假睡眠。 */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (e: ExecEvent) => void;
  /** P6 预算闸门(分):非空 = 提交前判限,超限零提交抛 BudgetExceededError。 */
  budgetFen?: number;
  /** P6 并行提交 opt-in(缺省 1 = 严格顺序,live 同口径);>1 按 needs 依赖波次并发。 */
  concurrency?: number;
}

// ── 运行结果 ───────────────────────────────────────────────────────────────

export type JobRunStatus = 'succeeded' | 'failed' | 'timeout' | 'skipped';

export interface JobRunResult {
  jobId: string;
  shotId: string;
  status: JobRunStatus;
  /** 视频产物(H3 signed URL / comfy /view URL)。 */
  resultUrl?: string;
  /** 首帧产物(image job;供 i2v 交接)。 */
  resultBlob?: Blob;
  error?: string;
}

export interface VisualRunResult {
  results: JobRunResult[];
}

/** 视觉执行注入物:P2 运行时口径 + 资产解算(纯函数注入,零 IO 于解算处)。 */
export interface VisualExecDeps {
  ports: VisualExecPorts;
  /** refId → 图 Blob(资产库解算);undefined = 无资产槽(映射层过滤)。 */
  refBlob: (refId: string) => Blob | undefined;
  /** firstFrame.assetId → 已生成首帧 blob(i2v 回退源)。 */
  firstFrameBlob?: (assetId: string) => Blob | undefined;
  minimax: { apiKey: string; baseUrl: string };
  image?: {
    provider: NonNullable<Parameters<GenerateImagesFn>[0]['provider']>;
    aspectRatio?: string;
    falKey?: string;
    falModel?: string;
    falQuality?: 'high' | 'low';
  };
  comfy?: {
    serverUrl: string;
    /** 按 i2v/t2v/r2v 取 API-format 工作流 JSON。 */
    graphJsonOf: (path: 'i2v' | 't2v' | 'r2v') => string;
  };
  /** r2v 白模(Pro)。 */
  whiteModel?: { blob: Blob; seconds: number };
  resolution?: Parameters<CreateH3TaskFn>[1]['resolution'];
  model?: string;
}

export interface AudioExecDeps {
  ports: AudioExecPorts;
  ttsApiKey: string;
  falKey: string;
}

export interface AudioRunResult {
  /** clipId → 拼杆后的成 clip wav。 */
  clipBlobs: Record<string, Blob>;
  /** clipId → 探活秒数(供② reflow 回填 IR measuredSeconds)。 */
  measurements: Record<string, number>;
  /** clipId → SFX 解算(missing 如实保留)。 */
  sfxResolutions: Record<string, SfxResolution>;
  /** clipId → BGM 音频 URL。 */
  bgmUrls: Record<string, string>;
  /** 单 clip 失败不中断其余(P2「失败=新调用」)。 */
  failures: { clipId: string; error: string }[];
}

export interface ExportExecDeps {
  ports: ExportExecPorts;
}

// ── P6 批量编排 ─────────────────────────────────────────────────────────────

export interface BatchRequest {
  /** 进度/结果对账标识。 */
  id: string;
  plan: VisualCallPlan;
  deps: VisualExecDeps;
  opts?: ExecOptions;
}

export type BatchItemStatus = 'succeeded' | 'failed' | 'rejected';

export interface BatchItemResult {
  id: string;
  status: BatchItemStatus;
  /** 发起即计的记账额(分);rejected(未发起)= 0。 */
  chargedCostFen: number;
  result?: VisualRunResult;
  error?: string;
}

export interface BatchResult {
  items: BatchItemResult[];
  /** 发起即计累计(分)。 */
  totalChargedFen: number;
}

export interface BatchOptions {
  /** 批级总预算(分);缺省无上限。 */
  budgetFen?: number;
  /** P9 结算口径:'attempt'(缺省,P6 发起即计)| 'precise'(按实际产出)。
   *  批级预算闸门仍按计划估算判限。 */
  settlement?: 'attempt' | 'precise';
  /** P9 价目表(精确结算/图条目计价用)。 */
  books?: import('./pricing').PriceBooks;
  /** 首个 failed 后中止余项(缺省 false = 继续)。 */
  stopOnError?: boolean;
  onProgress?: (e: { id: string; phase: 'checking' | 'running' | 'done' | 'rejected' | 'failed' }) => void;
}
