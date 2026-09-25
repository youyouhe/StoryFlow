/**
 * ①视觉桥 —— VisualCallPlan → minimax/fal/comfy 调用参数(P2 交付物 B)。
 *
 * 纯映射,零 IO:密钥/上传名/解算 Blob 由 `*CallRuntime` 注入(docs/
 * storyflow-ir-p2.md §2.1 字段映射表)。
 *
 * 参考打包(过滤重编,与 live resolveSegmentRefs「missing 不进 urls」同口径):
 *   · 无解算(= 无资产槽,计划层已 REF_ASSET_MISSING 警告)→ 过滤出包,
 *     tag 1..N 连续重编(renderComfyMaterials 同款严格序);
 *   · minimax 生图单 `subjectReference` = primaryRefSlot 身份锁;fal 多图
 *     `characters[]+landscape`——厂商不对称在此落地(P1 扩展策略所称
 *     imageRefPolicy 执行器侧)。
 *
 * 记档:两服务提交参数均无显式 seed 字段——`fixed` 仅 comfy `randomizeSeed:
 * false` 近似;H3 每任务即新抽卡。comfy t2v/r2v 也写 durationSeconds(live
 * 段路径漏传,comfyPatchWorkflow 本就支持)。grok 无 service → mapVideoCall
 * 显式拒绝(supports() 拒绝而非钳制)。
 */
import type { ImageJob, VideoJob, VisualCallPlan, RefSlot } from '../ir/visual/types';
import { renderComfyMaterials } from '../ir/visual/compile';
import type {
  CallStep, ComfyPatchCall, ComfyCallRuntime, CreateH3Call, GenerateImagesCall,
  H3CallRuntime, ImageCallRuntime, ResolvedRef, VideoCall,
} from './types';

/** resolution 合法枚举(H3SubmitParams.resolution 同集);非法值拒绝。 */
const RESOLUTIONS = ['480P', '768P', '2K'] as const;
type Resolution = (typeof RESOLUTIONS)[number];

const isResolution = (v: string): v is Resolution =>
  (RESOLUTIONS as readonly string[]).includes(v);

/** 槽序过滤出可解算的参考(无解算 = 无资产槽),并 1..N 重编 tag。 */
const filterAndRenumber = (
  slots: RefSlot[],
  resolvable: (refId: string) => boolean,
): RefSlot[] => {
  const kept = slots.filter(s => resolvable(s.refId));
  return kept.map((s, i) => ({ ...s, index: i + 1, tag: `<Picture ${i + 1}>` }));
};

const blobOf = (refs: ResolvedRef[] | undefined, refId: string): Blob | undefined =>
  refs?.find(r => r.refId === refId)?.blob;

/** ① ImageJob → generateImages(cfg, prompt, opts) 调用参数。 */
export const mapImageJobToGenerateImages = (
  job: ImageJob,
  rt: ImageCallRuntime,
): GenerateImagesCall => {
  const pack = filterAndRenumber(job.materials.slots, id => blobOf(rt.refs, id) != null);
  const primaryRefId = job.materials.slots.find(s => s.index === job.materials.primaryRefSlot)?.refId;

  const opts: NonNullable<GenerateImagesCall['opts']> = {
    n: 1,
    aspectRatio: rt.aspectRatio ?? '16:9',
  };
  if (rt.provider === 'minimax') {
    // image-01 单 subject_reference:身份关键槽(景在 prompt 文本,无槽)。
    const primary = primaryRefId ?? pack.find(s => s.role === 'character')?.refId ?? pack[0]?.refId;
    const blob = primary ? blobOf(rt.refs, primary) : undefined;
    if (blob) opts.subjectReference = blob;
  } else {
    // fal /edit:characters[] 全员 + landscape 场景图。
    const characters = pack.filter(s => s.role === 'character')
      .map(s => blobOf(rt.refs, s.refId)!)
      .filter((b): b is Blob => b != null);
    const landscape = pack.find(s => s.role === 'scene');
    opts.references = {
      ...(characters.length ? { characters } : {}),
      ...(landscape ? { landscape: blobOf(rt.refs, landscape.refId)! } : {}),
    };
  }

  return {
    kind: 'images',
    cfg: {
      apiKey: rt.apiKey,
      baseUrl: rt.baseUrl,
      provider: rt.provider,
      ...(rt.falKey != null ? { falKey: rt.falKey } : {}),
      ...(rt.falModel != null ? { falModel: rt.falModel } : {}),
      ...(rt.falQuality != null ? { falQuality: rt.falQuality } : {}),
    },
    prompt: job.prompt.text,
    opts,
  };
};

/** ① VideoJob → createH3Task(cfg, params, videoFileUri?) 调用参数。
 *  prompt = job.prompt.text(**不带** `<Picture N>` 材料块——那是 comfy 方言;
 *  H3 以 referenceImages 数组收参考)。无解算槽过滤出包,ref-N 按包内序。 */
export const mapVideoJobToH3 = (
  job: VideoJob,
  rt: H3CallRuntime,
): CreateH3Call => {
  const pack = filterAndRenumber(job.materials.slots, id => blobOf(rt.refs, id) != null);
  const rawRes = String(job.vendor?.resolution ?? rt.resolution ?? '768P');
  if (!isResolution(rawRes)) {
    throw new Error(`分辨率「${rawRes}」不在 H3 枚举(480P/768P/2K)——拒绝而非钳制`);
  }
  const whiteModel = job.path === 'r2v' ? rt.whiteModel : undefined;

  return {
    kind: 'h3',
    cfg: { apiKey: rt.apiKey, baseUrl: rt.baseUrl },
    params: {
      prompt: job.prompt.text,
      ...(whiteModel?.blob ? { videoBlob: whiteModel.blob } : {}),
      videoSeconds: whiteModel?.seconds ?? 0,
      referenceImages: pack.map((s, i) => ({ name: `ref-${i + 1}`, blob: blobOf(rt.refs, s.refId)! })),
      resolution: rawRes,
      outputSeconds: job.outputSeconds,
      ...(job.vendor?.model != null
        ? { model: String(job.vendor.model) }
        : rt.model != null ? { model: rt.model } : {}),
    },
    videoFileUri: whiteModel?.fileUri,
  };
};

/** ① VideoJob → comfyPatchWorkflow(graphJson, patch) 调用参数。
 *  prompt = text + `Reference materials:` tag 块(comfy 方言,①编译层
 *  renderComfyMaterials);i2v 必带首帧名,r2v 必带白模名(缺失即抛,
 *  时序契约 §3)。 */
export const mapVideoJobToComfy = (
  job: VideoJob,
  rt: ComfyCallRuntime,
): ComfyPatchCall => {
  const uploadedNameOf = (refId: string): string | undefined =>
    rt.uploadedRefNames?.find(u => u.refId === refId)?.name;
  const pack = filterAndRenumber(job.materials.slots, id => uploadedNameOf(id) != null);
  const hasVideo = job.path === 'r2v';
  const materials = renderComfyMaterials(pack, { hasVideo });
  const prompt = materials ? `${job.prompt.text}\n\n${materials}` : job.prompt.text;

  if (job.path === 'i2v' && !rt.uploadedFirstFrameName) {
    throw new Error('i2v 缺 uploadedFirstFrameName——先上传首帧再打包(comfy 时序 §3.1)');
  }
  if (hasVideo && !rt.uploadedVideoName) {
    throw new Error('r2v 缺 uploadedVideoName——先上传白模再打包(comfy 时序 §3.2)');
  }

  return {
    kind: 'comfy',
    cfg: { serverUrl: rt.serverUrl },
    graphJson: rt.graphJson,
    patch: {
      prompt,
      ...(pack.length ? { refImageNames: pack.map(s => uploadedNameOf(s.refId)!) } : {}),
      ...(hasVideo ? { refVideoNames: [rt.uploadedVideoName!] } : {}),
      ...(job.path === 'i2v' ? { firstFrameName: rt.uploadedFirstFrameName! } : {}),
      ...(job.path === 't2v' && !pack.length ? { stripFirstFrame: true } : {}),
      durationSeconds: job.outputSeconds,
      randomizeSeed: job.seed.mode === 'reroll',
    },
  };
};

/** 按 `job.backend` 分派;grok(无对应 service)→ 显式拒绝。 */
export const mapVideoCall = (
  job: VideoJob,
  rts: { h3?: H3CallRuntime; comfy?: ComfyCallRuntime },
): VideoCall => {
  if (job.backend === 'minimax') {
    if (!rts.h3) throw new Error('minimax 任务缺 H3CallRuntime 注入');
    return mapVideoJobToH3(job, rts.h3);
  }
  if (job.backend === 'comfyui') {
    if (!rts.comfy) throw new Error('comfyui 任务缺 ComfyCallRuntime 注入');
    return mapVideoJobToComfy(job, rts.comfy);
  }
  throw new Error(`backend「${job.backend}」无接入层映射(P2 范围 minimax/comfy;拒绝而非钳制,见 docs/storyflow-ir-p2.md §2.1)`);
};

/** ① 调用时序:计划序返回步进,`needs` 标依赖(仅 express 的 i2v←image);
 *  grok 步标 `unsupported` 保持全域(planCallSequence 不抛)。 */
export const planCallSequence = (plan: VisualCallPlan): CallStep[] => {
  const steps: CallStep[] = [];
  for (const shot of plan.shots) {
    for (const job of shot.jobs) {
      const call: CallStep['call'] = job.kind === 'image'
        ? 'generateImages'
        : job.backend === 'minimax' ? 'createH3Task'
          : job.backend === 'comfyui' ? 'comfyQueuePrompt'
            : 'unsupported';
      const needs = job.kind === 'video' && job.path === 'i2v' && job.firstFrame
        ? [job.firstFrame.fromJobId]
        : [];
      steps.push({
        jobId: job.jobId,
        call,
        ...(call === 'unsupported' ? { reason: `backend「${job.backend}」无 service 映射` } : {}),
        needs,
      });
    }
  }
  return steps;
};
