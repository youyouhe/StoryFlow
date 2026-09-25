/**
 * P2 接入层 —— 调用形状 + 运行时注入物(code-locked 接口清单,
 * docs/storyflow-ir-p2.md §2 的代码半边)。
 *
 * 防漂移手法:服务调用形状的参数类型**直接从 services 的函数签名推导**
 * (`Parameters<typeof import(…)>`)——services 签名变了,本文件编译即红,
 * 修桥不修 services(边界总则:不碰生产)。本层是 `src/ir/`「不 import
 * services」线的唯一有意跨越(strict 门禁面扩到本层,预检过 --strict)。
 */
import type { SfxAnchor } from '../ir/types';

// ── 服务签名推导源(只读依赖) ──────────────────────────────────────────────

type GenerateImagesFn = typeof import('../../services/minimaxService').generateImages;
type CreateH3TaskFn = typeof import('../../services/minimaxService').createH3Task;
type ComfyPatchFn = typeof import('../../services/comfyService').comfyPatchWorkflow;
type ComfyQueuePromptFn = typeof import('../../services/comfyService').comfyQueuePrompt;
type SynthesizeSpeechFn = typeof import('../../services/glmTtsService').synthesizeSpeech;
type ResolveSfxFn = typeof import('../../services/sfxService').resolveSfx;
type RequestMusicFn = typeof import('../../services/falMusicService').requestMusic;

// ── 运行时注入物(映射函数内零 IO;密钥/上传名/解算 Blob 由调用方提供) ─────

/** 槽序解算好的参考图(assets 库 → Blob 属 IO 边缘,映射外完成)。 */
export interface ResolvedRef {
  refId: string;
  /** 显示名(RefSlot.name 同源)。 */
  name: string;
  blob: Blob;
}

export interface ImageCallRuntime {
  /** minimax = image-01;fal = 队列 /edit。 */
  provider: NonNullable<Parameters<GenerateImagesFn>[0]['provider']>;
  apiKey: string;
  /** MiniMaxConfig.baseUrl 必填(minimaxService:32-35)。 */
  baseUrl: string;
  falKey?: string;
  falModel?: string;
  falQuality?: 'high' | 'low';
  aspectRatio?: string;
  /** 槽序参考图。 */
  refs?: ResolvedRef[];
}

export interface H3CallRuntime {
  apiKey: string;
  baseUrl: string;
  /** r2v 白模(Pro);t2v/i2v 缺省。fileUri 由 uploadH3Video 先行产出。 */
  whiteModel?: { blob: Blob; seconds: number; fileUri?: string };
  refs?: ResolvedRef[];
  resolution?: Extract<Parameters<CreateH3TaskFn>[1]['resolution'], string>;
  model?: string;
}

export interface ComfyCallRuntime {
  serverUrl: string;
  /** 对应路径(i2v/t2v/r2v)的 API-format 工作流 JSON。 */
  graphJson: string;
  /** 已上传参考(comfyUploadImage 返回名,按 refId 对齐;无解算槽由映射过滤)。 */
  uploadedRefNames?: { refId: string; name: string }[];
  /** i2v:首帧已上传文件名。 */
  uploadedFirstFrameName?: string;
  /** r2v:白模已上传文件名。 */
  uploadedVideoName?: string;
}

// ── ①视觉桥调用形状 ────────────────────────────────────────────────────────

export interface GenerateImagesCall {
  kind: 'images';
  cfg: Parameters<GenerateImagesFn>[0];
  prompt: Parameters<GenerateImagesFn>[1];
  /** 调用形状恒带 opts(映射必产出);服务侧参数本为可选。 */
  opts: NonNullable<Parameters<GenerateImagesFn>[2]>;
}

export interface CreateH3Call {
  kind: 'h3';
  cfg: Parameters<CreateH3TaskFn>[0];
  params: Parameters<CreateH3TaskFn>[1];
  videoFileUri: Parameters<CreateH3TaskFn>[2];
}

export interface ComfyPatchCall {
  kind: 'comfy';
  cfg: Parameters<ComfyQueuePromptFn>[0];
  graphJson: Parameters<ComfyPatchFn>[0];
  patch: Parameters<ComfyPatchFn>[1];
}

export type VideoCall = CreateH3Call | ComfyPatchCall;

/** 调用时序步(docs/storyflow-ir-p2.md §3)。`needs` = 前置 jobId
 *  (Express 的 i2v 依赖首帧 image job);其余互相独立(并行安全)。 */
export interface CallStep {
  jobId: string;
  call: 'generateImages' | 'createH3Task' | 'comfyQueuePrompt' | 'unsupported';
  /** 无映射后端(grok 等)时的拒绝理由;`call:'unsupported'` 专属。 */
  reason?: string;
  needs: string[];
}

// ── ②音频桥调用形状(边界桩) ───────────────────────────────────────────────

export interface TtsCallRuntime {
  apiKey: string;
}

export interface TtsCall {
  clipId: string;
  /** TtsJob.parts 下标(逐 part 一调用,同参 wav 后拼杆)。 */
  partIndex: number;
  apiKey: Parameters<SynthesizeSpeechFn>[0];
  input: Parameters<SynthesizeSpeechFn>[1];
  opts: Parameters<SynthesizeSpeechFn>[2];
}

export interface SfxCall {
  clipId: string;
  name: Parameters<ResolveSfxFn>[0];
}

export interface BgmCallRuntime {
  falKey: string;
}

export interface BgmCall {
  clipId: string;
  falKey: Parameters<RequestMusicFn>[0];
  prompt: Parameters<RequestMusicFn>[1];
}

export interface MixCallRuntime {
  /** shotId → 段成片 URL(exportProCut 的 videoUrl)。 */
  videoUrlOf: (shotId: string) => string;
  /** clipId → 会话存储键(ProSegmentCut.ttsKeys 的取键口径)。 */
  keyOf: (clipId: string) => string;
  /** clipId → SFX wav;**undefined = 不可解算**(SFX_MISSING 等),映射层
   *  过滤出 cut(live exportCut「missing sfx filtered out」同口径)。 */
  blobOf: (clipId: string) => Blob | undefined;
  /** clipId → BGM URL。 */
  bgmUrlOf: (clipId: string) => string;
}

// ── ③导出桥选项(边界桩) ───────────────────────────────────────────────────

export interface StoryFlowXmlExportOptions {
  /** 下载文件名;缺省 `<title>.storyflow.xml`。 */
  filename?: string;
  pretty?: boolean;
}
