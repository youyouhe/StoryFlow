/**
 * ①视觉编译器入口 —— StoryFlowIR → 后端调用计划(纯函数,零 IO)。
 *
 * 规则全部钉死在 docs/storyflow-ir-p1.md §2-3:路径分派、refSlots 1..N
 * 打包、prompt 组装(H3 方言)、时长拟合(ttsFloor 下限)+ 超窗拆链、seed
 * 策略、vendor 透传、minimax 整数分成本。
 */
import type { StoryFlowIR, Shot, GenerationParams } from '../types';
import type {
  ImageJob, MaterialsPack, PlanWarning, RefSlot, SeedPlan, VideoJob,
  VisualBackend, VisualCallPlan, VisualJob, VisualShotPlan,
} from './types';
import { VISUAL_PLAN_VERSION } from './types';
import { anchorTextOf, fitShotDuration } from '../shared';
import { estimateVideoCostFen } from './cost';

export interface VisualCompileOptions {
  /** 白模参考视频(R2V 的运行时输入,永不进 IR)。仅 Pro 模式生效。 */
  whiteModelRef?: { durationSeconds: number };
  /** 刊例计价分辨率(vendor.resolution 优先);缺省 '768P'。 */
  priceResolution?: string;
  /** 刊例计价模型(vendor.model 优先);缺省非 Max 档。 */
  priceModel?: string;
  /** shot.generation 缺省时的后端;缺省 'minimax'。 */
  defaultBackend?: GenerationParams['backend'];
}

/** 连续性锁句 —— H3 方言收束句,逐字自 utils/videoSegmentSubmit.ts:40。 */
export const CONTINUITY_LOCK_LINE = '画面连续、机位不切换；人物外形严格保持参考图设定。';

/** imagePrompt 长度告警阈(= minimaxService clampImagePrompt 的 1450 上限;
 *  计划层只警告不截断,截剪属执行器)。 */
export const IMAGE_PROMPT_WARN_CHARS = 1450;

/** 参考槽打包序位:scene > character > prop > style > action(同类保持绑定序)。 */
const ROLE_RANK: Record<RefSlot['role'], number> = {
  scene: 0,
  character: 1,
  prop: 2,
  style: 3,
  action: 4,
};

const refRoleOf = (refId: string): RefSlot['role'] => {
  const kind = refId.split(':')[0];
  switch (kind) {
    case 'char': return 'character';
    case 'prop': return 'prop';
    case 'scene': return 'scene';
    case 'style': return 'style';
    case 'action': return 'action';
    default: return 'prop'; // schema 已拒非法 id;防御位
  }
};

/** 注册表查找:refId → 显示名(角色变体带「名(变体)」限定,对齐
 *  utils/videoSegmentSubmit.ts:137 的显示约定)。 */
const resolveRefName = (ir: StoryFlowIR, refId: string): { name: string; hasAsset: boolean } | null => {
  const [kind, name, variant] = refId.split(':');
  if (kind === 'char') {
    const hit = ir.refs.characters.find(c => c.id === refId);
    if (!hit) return null;
    return { name: hit.variant ? `${hit.name}（${hit.variant}）` : hit.name, hasAsset: !!hit.asset?.assetId };
  }
  const pool = kind === 'prop' ? ir.refs.props
    : kind === 'scene' ? ir.refs.scenes
      : kind === 'style' ? ir.refs.styles
        : ir.refs.actions ?? [];
  const hit = pool.find(r => r.id === refId);
  if (!hit) return null;
  void name; void variant;
  return { name: hit.name, hasAsset: !!hit.asset?.assetId };
};

interface PackedRefs {
  materials: MaterialsPack;
  warnings: PlanWarning[];
}

/** refSlots 打包(P1 统一规则):稳定排序 scene→character→其余,严格 1..N,
 *  上限 9(截断出 REF_PACK_TRUNCATED);无资产 ref 出 REF_ASSET_MISSING。 */
const packRefs = (ir: StoryFlowIR, shot: Shot): PackedRefs => {
  const warnings: PlanWarning[] = [];
  const resolved = shot.refBindings
    .map(refId => {
      const r = resolveRefName(ir, refId);
      return r ? { refId, role: refRoleOf(refId), name: r.name, hasAsset: r.hasAsset } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const ordered = [...resolved].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
  const truncated = ordered.length > 9;
  const kept = ordered.slice(0, 9);

  const missingAssets = kept.filter(r => !r.hasAsset);
  if (missingAssets.length) {
    warnings.push({
      code: 'REF_ASSET_MISSING',
      shotId: shot.id,
      message: `绑定 ref 缺少资产库图(仅剩文本身份,生成一致性无保障):${missingAssets.map(r => r.refId).join(', ')}`,
    });
  }
  if (truncated) {
    warnings.push({
      code: 'REF_PACK_TRUNCATED',
      shotId: shot.id,
      message: `参考槽打包超过 9 张上限,仅保留前 9 个:${kept.map(r => r.refId).join(', ')}…`,
    });
  }

  const slots: RefSlot[] = kept.map((r, i) => ({
    index: i + 1,
    refId: r.refId,
    role: r.role,
    name: r.name,
    tag: `<Picture ${i + 1}>`,
  }));
  const primaryRefSlot = slots.find(s => s.role === 'character')?.index ?? slots[0]?.index;
  return {
    materials: primaryRefSlot != null ? { slots, primaryRefSlot } : { slots },
    warnings,
  };
};

/** ComfyUI R2V/T2V 材料 tag 块(执行器以 `\n\n` 接在 prompt 后提交)。
 *  统一自 hooks/useH3VideoPlan.ts:151-155(白模序号正确)与 :300-303
 *  (段路径跳号 bug + env tag 写死故事文案)——编号严格 1..N 跟 slots,
 *  env 文案通用化(deviation 记档 docs/storyflow-ir-p1.md §3)。
 *  `<Video 1>` 独立轴,仅 hasVideo(=r2v)时输出。 */
export const renderComfyMaterials = (
  slots: RefSlot[],
  opts: { hasVideo?: boolean } = {},
): string => {
  const lines = slots.map(s => {
    if (s.role === 'scene') {
      return `${s.tag} is the scene/background reference — keep the environment, lighting and composition exactly as shown.`;
    }
    if (s.role === 'character') {
      return `${s.tag} is the design sheet of ${s.name} — the character's identity and face must come from it.`;
    }
    return `${s.tag} is a design reference for ${s.name} — preserve the identity and details shown in it.`;
  });
  if (opts.hasVideo) {
    lines.push('<Video 1> is the white-model motion reference — follow its staging, camera move and timing exactly.');
  }
  return lines.length ? `Reference materials:\n${lines.join('\n')}` : '';
};

/** 视频 prompt 组装(H3 方言):motion + 台词行(cue 引号逐字)+
 *  连续性锁句。台词**逐字**嵌入引号(词锚基文本保持独立字段,永不对
 *  组装文本分词——①⇄② 缝合不变量)。 */
const composeVideoPrompt = (shot: Shot): VideoJob['prompt'] => {
  const anchor = anchorTextOf(shot);
  const lines = [shot.motionPrompt];
  if (shot.dialogue) {
    const line = shot.character ? `${shot.character}："${shot.dialogue.text}"` : `"${shot.dialogue.text}"`;
    lines.push(line);
  }
  lines.push(CONTINUITY_LOCK_LINE);
  return {
    text: lines.join('\n'),
    motion: shot.motionPrompt,
    ...(shot.dialogue ? { dialogue: shot.dialogue.text } : {}),
    ...(shot.character ? { cue: shot.character } : {}),
    continuity: CONTINUITY_LOCK_LINE,
    anchorText: anchor.text,
    anchorSource: anchor.source,
  };
};

const seedOf = (shot: Shot): SeedPlan =>
  shot.generation?.seed != null
    ? { mode: 'fixed', value: shot.generation.seed }
    : { mode: 'reroll' };

let jobCounter = 0;
const nextJobId = (): string => {
  jobCounter += 1;
  return `vj-${String(jobCounter).padStart(3, '0')}`;
};

/** 编译整个计划。 */
export const compileVisualPlan = (
  ir: StoryFlowIR,
  opts: VisualCompileOptions = {},
): VisualCallPlan => {
  jobCounter = 0;
  const warnings: PlanWarning[] = [];
  const shots: VisualShotPlan[] = [];

  for (const shot of ir.shots) {
    const backend: VisualBackend = shot.generation?.backend ?? opts.defaultBackend ?? 'minimax';
    const ttsFloor = shot.dialogue?.ttsFloor ?? 0;
    const fit = fitShotDuration(shot.shotDuration, ttsFloor);

    if (fit.audioTooLong) {
      warnings.push({
        code: 'AUDIO_TOO_LONG',
        shotId: shot.id,
        message: `对白 TTS 下限 ${ttsFloor}s 超模型窗上限 15s——该镜头放不下对白,需拆句或提速。`,
      });
    }
    if (ttsFloor > shot.shotDuration) {
      warnings.push({
        code: 'DIALOGUE_FLOOR_RAISES_DURATION',
        shotId: shot.id,
        message: `对白下限 ${ttsFloor}s 高于镜头故事时长 ${shot.shotDuration}s——输出时长抬到 ${fit.wantSeconds}s。`,
      });
    }
    if (fit.chain.length > 1 && ttsFloor > fit.chain[0].outputSeconds) {
      warnings.push({
        code: 'DIALOGUE_FLOOR_EXCEEDS_CHAIN_LINK',
        shotId: shot.id,
        message: `对白下限 ${ttsFloor}s 超出链元 1 的 ${fit.chain[0].outputSeconds}s(对白只挂链元 1)——建议拆链或提速。`,
      });
    }
    if (shot.imagePrompt.length > IMAGE_PROMPT_WARN_CHARS) {
      warnings.push({
        code: 'IMAGE_PROMPT_LONG',
        shotId: shot.id,
        message: `imagePrompt ${shot.imagePrompt.length} 字符超 1450 建议上限(执行器可能截剪尾部 Material/Mood)。`,
      });
    }

    const { materials, warnings: packWarnings } = packRefs(ir, shot);
    warnings.push(...packWarnings);

    const seed = seedOf(shot);
    const vendor = shot.generation?.vendor ? { ...shot.generation.vendor } : undefined;
    const jobs: VisualJob[] = [];

    // ── Express:每镜 首帧 T2I + I2V(对);链元拆在 I2V 侧 ──────────────────
    if (ir.mode === 'express') {
      const imageJob: ImageJob = {
        jobId: nextJobId(),
        shotId: shot.id,
        kind: 'image',
        backend,
        chainIndex: 1,
        chainCount: 1,
        materials,
        seed,
        ...(vendor ? { vendor } : {}),
        prompt: { text: shot.imagePrompt, imagePrompt: shot.imagePrompt },
      };
      jobs.push(imageJob);
      for (const link of fit.chain) {
        const videoJob: VideoJob = {
          jobId: nextJobId(),
          shotId: shot.id,
          kind: 'video',
          path: 'i2v',
          backend,
          chainIndex: link.chainIndex,
          chainCount: link.chainCount,
          offsetSeconds: link.offsetSeconds,
          outputSeconds: link.outputSeconds,
          materials,
          seed,
          ...(vendor ? { vendor } : {}),
          prompt: composeVideoPrompt(shot),
          firstFrame: {
            fromJobId: imageJob.jobId,
            ...(shot.firstFrame.assetId ? { assetId: shot.firstFrame.assetId } : {}),
          },
        };
        // P9 补齐:express 的 minimax 视频同样按刊例镜像计价(P1 文档口径
        // 「仅 minimax 视频任务计价」本就该覆盖 express 路,此处为遗漏修补)
        if (backend === 'minimax') {
          const resolution = String(vendor?.resolution ?? opts.priceResolution ?? '768P');
          const model = vendor?.model != null ? String(vendor.model) : opts.priceModel;
          videoJob.estimatedCostFen = estimateVideoCostFen({
            outputSeconds: link.outputSeconds,
            imageCount: materials.slots.length,
            resolution,
            model,
          });
        }
        jobs.push(videoJob);
      }
      shots.push({ shotId: shot.id, durationFit: fit, jobs });
      continue;
    }

    // ── Pro:T2V(+白模 R2V);对白挂链元 1 ─────────────────────────────────
    const path = opts.whiteModelRef ? 'r2v' : 't2v';
    for (const link of fit.chain) {
      const basePrompt = composeVideoPrompt(shot);
      // 对白只进链元 1:链元 2+ 剥掉台词行,保留 motion + 锁句。
      const promptForLink: VideoJob['prompt'] = link.chainIndex === 1 ? basePrompt : {
        ...basePrompt,
        text: [shot.motionPrompt, CONTINUITY_LOCK_LINE].join('\n'),
      };
      if (link.chainIndex !== 1) {
        delete promptForLink.dialogue;
        delete promptForLink.cue;
      }
      const videoJob: VideoJob = {
        jobId: nextJobId(),
        shotId: shot.id,
        kind: 'video',
        path,
        backend,
        chainIndex: link.chainIndex,
        chainCount: link.chainCount,
        offsetSeconds: link.offsetSeconds,
        outputSeconds: link.outputSeconds,
        materials,
        seed,
        ...(vendor ? { vendor } : {}),
        prompt: promptForLink,
      };
      if (backend === 'minimax') {
        const resolution = String(vendor?.resolution ?? opts.priceResolution ?? '768P');
        const model = vendor?.model != null ? String(vendor.model) : opts.priceModel;
        videoJob.estimatedCostFen = estimateVideoCostFen({
          outputSeconds: link.outputSeconds,
          imageCount: materials.slots.length,
          resolution,
          model,
          videoSeconds: path === 'r2v' ? opts.whiteModelRef?.durationSeconds ?? 0 : 0,
        });
      }
      jobs.push(videoJob);
    }
    shots.push({ shotId: shot.id, durationFit: fit, jobs });
  }

  return { version: VISUAL_PLAN_VERSION, mode: ir.mode, shots, warnings };
};
