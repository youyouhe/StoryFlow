/**
 * ②AudioMixPlan 的 zod 校验 + 防漂移断言(同 `src/ir/schema.ts` 的
 * Equal/NullChecksOn/Guard 模式,strict 下武装)。
 */
import { z } from 'zod';

import type {
  AudioJob, AudioMixPlan, AudioShotFit, AudioWarning, BgmJob, SfxJob,
  TimelineEntry, SegmentMix, TtsJob,
} from './types';
import type { ChainLink, ShotDurationFit } from '../shared';
import { AUDIO_MIX_PLAN_VERSION, MIX_GAIN_BGM, MIX_GAIN_SFX, MIX_GAIN_TTS, MIX_BGM_LOOP } from './types';

const sfxAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('shot-start') }),
  z.strictObject({ kind: z.literal('shot-end') }),
  z.strictObject({ kind: z.literal('word'), wordIndex: z.number().int().min(0) }),
]);

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

const ttsJobSchema = z.strictObject({
  kind: z.literal('tts'),
  clipId: z.string().regex(/^aud-tts-\d{3,}$/),
  shotId: z.string().regex(/^SHOT_\d{3,}$/),
  character: z.string().min(1).optional(),
  text: z.string().min(1),
  parts: z.array(z.string().min(1)).min(1),
  voice: z.string().min(1),
  speed: z.number().min(0.5).max(2).optional(),
  volume: z.number().min(0.5).max(2).optional(),
  watermark: z.boolean().optional(),
});

const bgmJobSchema = z.strictObject({
  kind: z.literal('bgm'),
  clipId: z.string().regex(/^aud-bgm-\d{3,}$/),
  fromShotId: z.string().regex(/^SHOT_\d{3,}$/),
  toShotId: z.string().regex(/^SHOT_\d{3,}$/).optional(),
  prompt: z.string().min(1),
  loop: z.boolean(),
  gain: z.number().min(0).max(2),
});

const sfxJobSchema = z.strictObject({
  kind: z.literal('sfx'),
  clipId: z.string().regex(/^aud-sfx-\d{3,}$/),
  shotId: z.string().regex(/^SHOT_\d{3,}$/),
  name: z.string().min(1),
  anchor: sfxAnchorSchema,
  missing: z.boolean().optional(),
  gain: z.number().min(0).max(2),
});

const audioJobSchema = z.discriminatedUnion('kind', [ttsJobSchema, bgmJobSchema, sfxJobSchema]);

const timelineEntrySchema = z.strictObject({
  clipId: z.string().regex(/^aud-(tts|bgm|sfx)-\d{3,}$/),
  startMs: z.number().min(0),
  durationMs: z.number().min(0).optional(),
});

const segmentMixSchema = z.strictObject({
  shotId: z.string().regex(/^SHOT_\d{3,}$/),
  tts: z.array(z.strictObject({ clipId: z.string().regex(/^aud-tts-\d{3,}$/), gain: z.number().min(0).max(2) })),
  bgm: z.strictObject({ clipId: z.string().regex(/^aud-bgm-\d{3,}$/), gain: z.number().min(0).max(2), loop: z.boolean() }).optional(),
  sfx: z.array(z.strictObject({ clipId: z.string().regex(/^aud-sfx-\d{3,}$/), atMs: z.number().min(0), gain: z.number().min(0).max(2) })),
});

const audioWarningSchema = z.strictObject({
  code: z.enum(['TTS_ANCHOR_UNMATCHED', 'AUDIO_TOO_LONG', 'SFX_MISSING', 'SFX_ANCHOR_OUT_OF_RANGE', 'ALIGNMENT_UNUSABLE']),
  shotId: z.string().regex(/^SHOT_\d{3,}$/).optional(),
  message: z.string().min(1),
});

const audioShotFitSchema = z.strictObject({
  shotId: z.string().regex(/^SHOT_\d{3,}$/),
  durationFit: shotDurationFitSchema,
});

const basePlanSchema = z.strictObject({
  version: z.literal(AUDIO_MIX_PLAN_VERSION),
  jobs: z.array(audioJobSchema),
  timeline: z.array(timelineEntrySchema),
  mix: z.array(segmentMixSchema),
  fits: z.array(audioShotFitSchema),
  warnings: z.array(audioWarningSchema),
});

export const audioMixPlanSchema = basePlanSchema.superRefine((plan, ctx) => {
  // 混音增益必须钉死在契约值上(执行器数值与声明一致性)。
  for (const [i, seg] of plan.mix.entries()) {
    for (const [j, t] of seg.tts.entries()) {
      if (t.gain !== MIX_GAIN_TTS) {
        ctx.addIssue({ code: 'custom', message: `tts gain 必须为 ${MIX_GAIN_TTS}`, path: ['mix', i, 'tts', j] });
      }
    }
    if (seg.bgm && (seg.bgm.gain !== MIX_GAIN_BGM || seg.bgm.loop !== MIX_BGM_LOOP)) {
      ctx.addIssue({ code: 'custom', message: `bgm 必须 gain=${MIX_GAIN_BGM} loop=${MIX_BGM_LOOP}`, path: ['mix', i, 'bgm'] });
    }
    for (const [j, s] of seg.sfx.entries()) {
      if (s.gain !== MIX_GAIN_SFX) {
        ctx.addIssue({ code: 'custom', message: `sfx gain 必须为 ${MIX_GAIN_SFX}`, path: ['mix', i, 'sfx', j] });
      }
    }
  }
});

export const parseAudioMixPlan = (input: unknown): AudioMixPlan =>
  audioMixPlanSchema.parse(input) as AudioMixPlan;

export type AudioPlanValidation =
  | { ok: true; plan: AudioMixPlan }
  | { ok: false; issues: string[] };

export const validateAudioMixPlan = (input: unknown): AudioPlanValidation => {
  const r = audioMixPlanSchema.safeParse(input);
  if (r.success) return { ok: true, plan: r.data as AudioMixPlan };
  return {
    ok: false,
    issues: r.error.issues.map(i => {
      const path = i.path.length ? `${i.path.map(String).join('.')}: ` : '';
      return `${path}${i.message}`;
    }),
  };
};

// ── 防漂移断言(仅 strict 下武装) ──────────────────────────────────────────

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type NullChecksOn = [undefined] extends [1] ? false : true;
type Guard<T> = NullChecksOn extends true ? T : true;
type InferOf<T extends z.ZodType> = z.infer<T>;

const _assertPlan: Guard<Equal<AudioMixPlan, InferOf<typeof basePlanSchema>>> = true;
const _assertAudioJob: Guard<Equal<AudioJob, InferOf<typeof audioJobSchema>>> = true;
const _assertTts: Guard<Equal<TtsJob, InferOf<typeof ttsJobSchema>>> = true;
const _assertBgm: Guard<Equal<BgmJob, InferOf<typeof bgmJobSchema>>> = true;
const _assertSfx: Guard<Equal<SfxJob, InferOf<typeof sfxJobSchema>>> = true;
const _assertTimeline: Guard<Equal<TimelineEntry, InferOf<typeof timelineEntrySchema>>> = true;
const _assertMix: Guard<Equal<SegmentMix, InferOf<typeof segmentMixSchema>>> = true;
const _assertWarning: Guard<Equal<AudioWarning, InferOf<typeof audioWarningSchema>>> = true;
const _assertFit: Guard<Equal<AudioShotFit, InferOf<typeof audioShotFitSchema>>> = true;
const _assertChain: Guard<Equal<ChainLink, InferOf<typeof chainLinkSchema>>> = true;
const _assertShotFit: Guard<Equal<ShotDurationFit, InferOf<typeof shotDurationFitSchema>>> = true;

export const AUDIO_TYPE_GUARDS_VERIFIED = [
  _assertPlan, _assertAudioJob, _assertTts, _assertBgm, _assertSfx,
  _assertTimeline, _assertMix, _assertWarning, _assertFit, _assertChain,
  _assertShotFit,
] as const;
