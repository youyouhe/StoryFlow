/**
 * ①视觉编译器产出(VisualCallPlan)的 zod 运行时校验 + 防漂移断言 ——
 * 复用 `src/ir/schema.ts` 的 Equal/NullChecksOn/Guard 模式(该模式仅在
 * strictNullChecks 下武装:zod v4 在 non-strict 配置下类型推断退化)。
 */
import { z } from 'zod';

import type {
  ImageJob, ImageJobPrompt, MaterialsPack, PlanWarning, RefSlot, SeedPlan,
  VideoJob, VideoJobPrompt, VisualCallPlan, VisualJob, VisualJobBase,
  VisualShotPlan,
} from './types';
import type { ChainLink, ShotDurationFit } from '../shared';
import { VISUAL_PLAN_VERSION } from './types';

// ── fragments ───────────────────────────────────────────────────────────────

const chainLinkSchema = z.strictObject({
  chainIndex: z.number().int().min(1),
  chainCount: z.number().int().min(1),
  outputSeconds: z.number().int().min(4).max(15),
  offsetSeconds: z.number().min(0),
});

const shotDurationFitSchema = z.strictObject({
  wantSeconds: z.number().min(0),
  chain: z.array(chainLinkSchema).min(1),
  audioTooLong: z.boolean(),
  lowerBound: z.number().min(0),
});

const refSlotSchema = z.strictObject({
  index: z.number().int().min(1).max(9),
  refId: z.string().min(1),
  role: z.enum(['character', 'prop', 'scene', 'style', 'action']),
  name: z.string().min(1),
  tag: z.string().regex(/^<Picture \d+>$/),
});

const materialsPackSchema = z.strictObject({
  slots: z.array(refSlotSchema),
  primaryRefSlot: z.number().int().min(1).optional(),
});

const seedPlanSchema = z.strictObject({
  mode: z.enum(['fixed', 'reroll']),
  value: z.number().int().min(0).optional(),
});

const imageJobPromptSchema = z.strictObject({
  text: z.string().min(1),
  imagePrompt: z.string().min(1),
});

const videoJobPromptSchema = z.strictObject({
  text: z.string().min(1),
  motion: z.string().min(1),
  dialogue: z.string().min(1).optional(),
  cue: z.string().min(1).optional(),
  continuity: z.string().min(1),
  anchorText: z.string().min(1),
  anchorSource: z.enum(['dialogue', 'motion']),
});

const jobBaseShape = {
  jobId: z.string().regex(/^vj-\d{3,}$/),
  shotId: z.string().regex(/^SHOT_\d{3,}$/),
  backend: z.enum(['comfyui', 'minimax', 'grok']),
  chainIndex: z.number().int().min(1),
  chainCount: z.number().int().min(1),
  materials: materialsPackSchema,
  seed: seedPlanSchema,
  vendor: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  estimatedCostFen: z.number().int().min(0).optional(),
};

const imageJobSchema = z.strictObject({
  ...jobBaseShape,
  kind: z.literal('image'),
  prompt: imageJobPromptSchema,
  provider: z.enum(['minimax', 'fal']).optional(),
});

const videoJobSchema = z.strictObject({
  ...jobBaseShape,
  kind: z.literal('video'),
  path: z.enum(['i2v', 't2v', 'r2v']),
  offsetSeconds: z.number().min(0),
  outputSeconds: z.number().int().min(4).max(15),
  prompt: videoJobPromptSchema,
  firstFrame: z.strictObject({
    fromJobId: z.string().regex(/^vj-\d{3,}$/),
    assetId: z.string().min(1).optional(),
  }).optional(),
});

const visualJobSchema = z.discriminatedUnion('kind', [imageJobSchema, videoJobSchema]);

const planWarningSchema = z.strictObject({
  code: z.enum([
    'REF_ASSET_MISSING',
    'REF_PACK_TRUNCATED',
    'IMAGE_PROMPT_LONG',
    'DIALOGUE_FLOOR_RAISES_DURATION',
    'AUDIO_TOO_LONG',
    'DIALOGUE_FLOOR_EXCEEDS_CHAIN_LINK',
  ]),
  shotId: z.string().regex(/^SHOT_\d{3,}$/).optional(),
  message: z.string().min(1),
});

const visualShotPlanSchema = z.strictObject({
  shotId: z.string().regex(/^SHOT_\d{3,}$/),
  durationFit: shotDurationFitSchema,
  jobs: z.array(visualJobSchema).min(1),
});

const basePlanSchema = z.strictObject({
  version: z.literal(VISUAL_PLAN_VERSION),
  mode: z.enum(['express', 'pro']),
  shots: z.array(visualShotPlanSchema),
  warnings: z.array(planWarningSchema),
});

/** 跨字段不变量:i2v 必带 firstFrame;链元号自洽。 */
export const visualCallPlanSchema = basePlanSchema.superRefine((plan, ctx) => {
  for (const [si, shot] of plan.shots.entries()) {
    for (const [ji, job] of shot.jobs.entries()) {
      const path = ['shots', si, 'jobs', ji];
      if (job.kind === 'video' && job.path === 'i2v' && !job.firstFrame) {
        ctx.addIssue({ code: 'custom', message: 'i2v 任务必须带 firstFrame(首帧来源)', path });
      }
      if (job.chainIndex > job.chainCount) {
        ctx.addIssue({ code: 'custom', message: 'chainIndex 不得大于 chainCount', path });
      }
      if (job.seed.mode === 'fixed' && job.seed.value == null) {
        ctx.addIssue({ code: 'custom', message: "seed.mode='fixed' 时必须给 value", path: [...path, 'seed'] });
      }
      if (job.materials.primaryRefSlot != null
        && !job.materials.slots.some(s => s.index === job.materials.primaryRefSlot)) {
        ctx.addIssue({ code: 'custom', message: 'primaryRefSlot 必须指向存在的槽位', path: [...path, 'materials'] });
      }
    }
  }
});

/** 校验或抛错。 */
export const parseVisualCallPlan = (input: unknown): VisualCallPlan =>
  visualCallPlanSchema.parse(input) as VisualCallPlan;

export type VisualPlanValidation =
  | { ok: true; plan: VisualCallPlan }
  | { ok: false; issues: string[] };

/** 门禁式校验(与 P0 validateStoryFlowIR 同形)。 */
export const validateVisualCallPlan = (input: unknown): VisualPlanValidation => {
  const r = visualCallPlanSchema.safeParse(input);
  if (r.success) return { ok: true, plan: r.data as VisualCallPlan };
  return {
    ok: false,
    issues: r.error.issues.map(i => {
      const path = i.path.length ? `${i.path.map(String).join('.')}: ` : '';
      return `${path}${i.message}`;
    }),
  };
};

// ── 防漂移断言(仅 strict 下武装,见 src/ir/schema.ts 同名模式) ──────────────

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type NullChecksOn = [undefined] extends [1] ? false : true;
type Guard<T> = NullChecksOn extends true ? T : true;
type InferOf<T extends z.ZodType> = z.infer<T>;

/** jobBaseShape 的独立 schema 镜像(供 _assertJobBase 的 Equal 对照)。 */
const jobBaseShapeSchema = z.strictObject(jobBaseShape);

const _assertPlan: Guard<Equal<VisualCallPlan, InferOf<typeof basePlanSchema>>> = true;
const _assertShotPlan: Guard<Equal<VisualShotPlan, InferOf<typeof visualShotPlanSchema>>> = true;
const _assertJob: Guard<Equal<VisualJob, InferOf<typeof visualJobSchema>>> = true;
const _assertImageJob: Guard<Equal<ImageJob, InferOf<typeof imageJobSchema>>> = true;
const _assertVideoJob: Guard<Equal<VideoJob, InferOf<typeof videoJobSchema>>> = true;
const _assertJobBase: Guard<Equal<VisualJobBase, InferOf<typeof jobBaseShapeSchema>>> = true;
const _assertImagePrompt: Guard<Equal<ImageJobPrompt, InferOf<typeof imageJobPromptSchema>>> = true;
const _assertVideoPrompt: Guard<Equal<VideoJobPrompt, InferOf<typeof videoJobPromptSchema>>> = true;
const _assertMaterials: Guard<Equal<MaterialsPack, InferOf<typeof materialsPackSchema>>> = true;
const _assertRefSlot: Guard<Equal<RefSlot, InferOf<typeof refSlotSchema>>> = true;
const _assertSeed: Guard<Equal<SeedPlan, InferOf<typeof seedPlanSchema>>> = true;
const _assertWarning: Guard<Equal<PlanWarning, InferOf<typeof planWarningSchema>>> = true;
const _assertChain: Guard<Equal<ChainLink, InferOf<typeof chainLinkSchema>>> = true;
const _assertFit: Guard<Equal<ShotDurationFit, InferOf<typeof shotDurationFitSchema>>> = true;

export const VISUAL_TYPE_GUARDS_VERIFIED = [
  _assertPlan, _assertShotPlan, _assertJob, _assertImageJob, _assertVideoJob,
  _assertJobBase, _assertImagePrompt, _assertVideoPrompt, _assertMaterials,
  _assertRefSlot, _assertSeed, _assertWarning, _assertChain, _assertFit,
] as const;
