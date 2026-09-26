/**
 * StoryFlowIR zod schema (runtime validation) — the executable half of the
 * P0 contract. `src/ir/types.ts` is the human-readable half; the compile-time
 * `_assert` consts at the bottom fail the strict typecheck (`npm run
 * typecheck:ir`) the moment the two halves drift apart.
 *
 * Shape rules here go beyond field presence — the cross-field `superRefine`
 * encodes the invariants the pipeline actually relies on:
 *   · shot ids unique, sequence contiguous 1..N
 *   · every imagePrompt starts with style.promptPrefix (StyleHead baked in)
 *   · dialogue ⇒ character; refBindings/audio/transitions resolve
 *   · registry ids are well-formed (`char:苏晚:战损` …) and unique
 *   · SceneRef.spatialId → spatial[]
 *
 * zod v4 is assumed (z.strictObject rejects unknown keys — a contract, not a
 * suggestion).
 */
import { z } from 'zod';

import type {
  ActionRef, AudioTrack, BgmClip, CameraMove, CharacterRef, ExtraStyleRef,
  FrameDesc, GenerationParams, PropRef, RefRegistry, SceneRef, Shot,
  ShotDialogue, SfxAnchor, SfxClip, SpatialCharacter, SpatialLayout,
  SpatialObject, StyleRef, TtsClip, Transition, StoryFlowIR,
} from './types';
import type { IRVersion } from './types';
import { IR_VERSION } from './types';

// ── primitives ──────────────────────────────────────────────────────────────

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** Names never contain ':' — it is the id separator (see the id-shape refine). */
const nameSchema = z.string().min(1).refine(n => !n.includes(':'), {
  message: 'name 不能包含 ":"(它是 ref id 的分隔符)',
});

/** `char:苏晚` / `char:苏晚:战损` / `prop:海鸥相机` / `scene:照相馆` … */
const refIdSchema = z.string().min(1).regex(
  /^(char|prop|scene|style|action):[^:]+(:[^:]+)?$/,
  'ref id 形如 "kind:name" 或 "char:name:variant"',
);

const shotIdSchema = z.string().regex(/^SHOT_\d{3,}$/, 'shot id 形如 SHOT_001');
const audioIdSchema = z.string().regex(/^aud-(tts|bgm|sfx)-\d{3,}$/, 'audio id 形如 aud-tts-001');
const transitionIdSchema = z.string().regex(/^tr-\d{3,}$/, 'transition id 形如 tr-001');

// ── style / refs ────────────────────────────────────────────────────────────

export const styleRefSchema = z.strictObject({
  name: nameSchema,
  artStyle: z.string().min(1),
  scenePreset: z.string().min(1),
  promptPrefix: z.string(),
});

const assetProvenanceSchema = z.strictObject({
  assetId: z.string().min(1).optional(),
  source: z.enum(['upload', 'ai-generate', 'video-frame']).optional(),
  sourcePrompt: z.string().optional(),
  versionGroup: z.string().optional(),
  version: z.number().int().min(1).optional(),
});

export const characterRefSchema = z.strictObject({
  id: refIdSchema,
  name: nameSchema,
  variant: z.string().min(1).optional(),
  description: z.string().min(1),
  asset: assetProvenanceSchema.optional(),
});

export const propRefSchema = z.strictObject({
  id: refIdSchema,
  name: nameSchema,
  description: z.string().min(1),
  asset: assetProvenanceSchema.optional(),
});

export const sceneRefSchema = z.strictObject({
  id: refIdSchema,
  name: nameSchema,
  sceneHeading: z.string().min(1).optional(),
  description: z.string().min(1),
  spatialId: z.string().min(1).optional(),
  asset: assetProvenanceSchema.optional(),
});

export const extraStyleRefSchema = z.strictObject({
  id: refIdSchema,
  name: nameSchema,
  description: z.string().min(1),
  asset: assetProvenanceSchema.optional(),
});

export const actionRefSchema = z.strictObject({
  id: refIdSchema,
  name: nameSchema,
  description: z.string().min(1),
  asset: assetProvenanceSchema.optional(),
});

export const refRegistrySchema = z.strictObject({
  characters: z.array(characterRefSchema),
  props: z.array(propRefSchema),
  scenes: z.array(sceneRefSchema),
  styles: z.array(extraStyleRefSchema),
  actions: z.array(actionRefSchema).optional(),
});

// ── shots ───────────────────────────────────────────────────────────────────

export const frameDescSchema = z.strictObject({
  description: z.string().min(1),
  assetId: z.string().min(1).optional(),
});

export const cameraMoveSchema = z.strictObject({
  shotType: z.enum(['extreme-wide', 'wide', 'medium', 'close-up', 'extreme-close-up', 'over-the-shoulder', 'top-down', 'pov']),
  description: z.string().optional(),
  position: vec3,
  lookAt: vec3,
  movement: z.strictObject({
    type: z.enum(['static', 'pan', 'tilt', 'dolly', 'tracking', 'orbit', 'crane', 'handheld']),
    duration: z.number().positive(),
    targetSeconds: z.number().positive().optional(),
    path: z.array(vec3).min(1).optional(),
    lookPath: z.array(vec3).min(1).optional(),
  }),
  focus: z.string().optional(),
});

export const generationParamsSchema = z.strictObject({
  backend: z.enum(['comfyui', 'minimax', 'grok']),
  steps: z.number().int().min(1),
  seed: z.number().int().min(0).optional(),
  vendor: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const shotDialogueSchema = z.strictObject({
  text: z.string().min(1),
  display: z.string().min(1).optional(),
  ttsFloor: z.number().min(0),
});

export const whiteModelSchema = z.strictObject({
  assetId: z.string().min(1).optional(),
  durationSeconds: z.number().positive(),
});

export const shotSchema = z.strictObject({
  id: shotIdSchema,
  sequence: z.number().int().min(1),
  imagePrompt: z.string().min(1),
  motionPrompt: z.string().min(1),
  shotDuration: z.number().positive(),
  estimated: z.boolean().optional(),
  firstFrame: frameDescSchema,
  lastFrame: frameDescSchema.optional(),
  camera: cameraMoveSchema.optional(),
  refBindings: z.array(refIdSchema),
  character: z.string().min(1).optional(),
  dialogue: shotDialogueSchema.optional(),
  whiteModel: whiteModelSchema.optional(),
  generation: generationParamsSchema.optional(),
  status: z.enum(['draft', 'generated', 'locked', 'exported']),
});

// ── audio ───────────────────────────────────────────────────────────────────

export const sfxAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('shot-start') }),
  z.strictObject({ kind: z.literal('shot-end') }),
  z.strictObject({ kind: z.literal('word'), wordIndex: z.number().int().min(0) }),
]);

export const ttsClipSchema = z.strictObject({
  id: audioIdSchema,
  kind: z.literal('tts'),
  shotId: shotIdSchema,
  character: z.string().min(1).optional(),
  text: z.string().min(1),
  voice: z.string().min(1),
  speed: z.number().min(0.5).max(2).optional(),
  volume: z.number().min(0.5).max(2).optional(),
  watermark: z.boolean().optional(),
  measuredSeconds: z.number().min(0).optional(),
  gain: z.number().min(0).max(2).optional(),
});

export const bgmClipSchema = z.strictObject({
  id: audioIdSchema,
  kind: z.literal('bgm'),
  fromShotId: shotIdSchema,
  toShotId: shotIdSchema.optional(),
  prompt: z.string().min(1),
  loop: z.boolean().optional(),
  gain: z.number().min(0).max(2).optional(),
});

export const sfxClipSchema = z.strictObject({
  id: audioIdSchema,
  kind: z.literal('sfx'),
  shotId: shotIdSchema,
  name: z.string().min(1),
  anchor: sfxAnchorSchema,
  missing: z.boolean().optional(),
  gain: z.number().min(0).max(2).optional(),
});

export const audioTrackSchema = z.discriminatedUnion('kind', [
  ttsClipSchema,
  bgmClipSchema,
  sfxClipSchema,
]);

// ── transitions / spatial ───────────────────────────────────────────────────

export const transitionSchema = z.strictObject({
  id: transitionIdSchema,
  type: z.enum(['cut', 'dissolve', 'fade-in', 'fade-out', 'wipe', 'match-cut']),
  target: shotIdSchema,
  from: shotIdSchema.optional(),
  durationSeconds: z.number().positive().optional(),
});

export const spatialObjectSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(['box', 'plane', 'cylinder', 'sphere']),
  role: z.enum(['wall', 'floor', 'ceiling', 'door', 'window', 'prop', 'furniture', 'environment']),
  label: z.string().optional(),
  position: vec3,
  size: vec3,
  rotation: vec3.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color 是 #rrggbb 六位十六进制').optional(),
});

export const spatialCharacterSchema = z.strictObject({
  name: z.string().min(1),
  position: z.tuple([z.number(), z.number()]),
  facing: z.number().optional(),
  pose: z.string().optional(),
});

export const spatialLayoutSchema = z.strictObject({
  id: z.string().min(1),
  sceneHeading: z.string().min(1),
  objects: z.array(spatialObjectSchema),
  characters: z.array(spatialCharacterSchema),
});

// ── the document + cross-field invariants ───────────────────────────────────

const baseDocSchema = z.strictObject({
  // 版本并集:旧档照常通过(extension policy);当前 IR_VERSION = 0.3.0
  version: z.union([z.literal('0.1.0'), z.literal('0.2.0'), z.literal('0.3.0')], {
    message: `version 必须是 "0.1.0"/"0.2.0"/"${IR_VERSION}"(契约按 extension policy 升版)`,
  }),
  mode: z.enum(['express', 'pro']),
  title: z.string().min(1),
  style: styleRefSchema,
  refs: refRegistrySchema,
  shots: z.array(shotSchema),
  audio: z.array(audioTrackSchema),
  transitions: z.array(transitionSchema),
  spatial: z.array(spatialLayoutSchema),
});

export const storyFlowIRSchema = baseDocSchema.superRefine((ir, ctx) => {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: 'custom', message, path });

  // ---- shots: unique ids + contiguous 1..N sequence ------------------------
  const seenShotIds = new Set<string>();
  const seqs = new Set<number>();
  for (const [i, s] of ir.shots.entries()) {
    if (seenShotIds.has(s.id)) issue(`镜头 id 重复: ${s.id}`, ['shots', i, 'id']);
    seenShotIds.add(s.id);
    if (seqs.has(s.sequence)) issue(`sequence 重复: ${s.sequence}`, ['shots', i, 'sequence']);
    seqs.add(s.sequence);
    if (s.dialogue && !s.character) {
      issue('有 dialogue 的镜头必须给出 character(说话人)', ['shots', i]);
    }
  }
  for (let n = 1; n <= ir.shots.length; n++) {
    if (!seqs.has(n)) issue(`sequence 不连续:缺少 ${n}(应为 1..${ir.shots.length})`, ['shots']);
  }

  // ---- style prefix: the StyleHead head is baked into every imagePrompt ----
  if (ir.style.promptPrefix.length > 0) {
    for (const [i, s] of ir.shots.entries()) {
      if (!s.imagePrompt.startsWith(ir.style.promptPrefix)) {
        issue('imagePrompt 必须以 style.promptPrefix 开头(风格锚全量注入)', ['shots', i, 'imagePrompt']);
      }
    }
  }

  // ---- registry: id ↔ entry consistency, unique across the registry --------
  const registry = new Map<string, string>(); // id → where it was declared
  const claim = (id: string, where: string, path: (string | number)[]) => {
    if (registry.has(id)) issue(`ref id 跨类别重复: ${id}(已在 ${registry.get(id)} 声明)`, path);
    registry.set(id, where);
  };
  ir.refs.characters.forEach((c, i) => {
    const want = c.variant ? `char:${c.name}:${c.variant}` : `char:${c.name}`;
    if (c.id !== want) issue(`character id 应为 "${want}"`, ['refs', 'characters', i, 'id']);
    claim(c.id, 'characters', ['refs', 'characters', i, 'id']);
  });
  ir.refs.props.forEach((p, i) => {
    if (p.id !== `prop:${p.name}`) issue(`prop id 应为 "prop:${p.name}"`, ['refs', 'props', i, 'id']);
    claim(p.id, 'props', ['refs', 'props', i, 'id']);
  });
  ir.refs.scenes.forEach((s, i) => {
    if (s.id !== `scene:${s.name}`) issue(`scene id 应为 "scene:${s.name}"`, ['refs', 'scenes', i, 'id']);
    claim(s.id, 'scenes', ['refs', 'scenes', i, 'id']);
  });
  ir.refs.styles.forEach((s, i) => {
    if (s.id !== `style:${s.name}`) issue(`style id 应为 "style:${s.name}"`, ['refs', 'styles', i, 'id']);
    claim(s.id, 'styles', ['refs', 'styles', i, 'id']);
  });
  (ir.refs.actions ?? []).forEach((a, i) => {
    if (a.id !== `action:${a.name}`) issue(`action id 应为 "action:${a.name}"`, ['refs', 'actions', i, 'id']);
    claim(a.id, 'actions', ['refs', 'actions', i, 'id']);
  });

  // ---- spatial ids (for SceneRef.spatialId resolution) ----------------------
  const spatialIds = new Set(ir.spatial.map(sp => sp.id));
  ir.refs.scenes.forEach((s, i) => {
    if (s.spatialId && !spatialIds.has(s.spatialId)) {
      issue(`spatialId 指向不存在的空间布局: ${s.spatialId}`, ['refs', 'scenes', i, 'spatialId']);
    }
  });

  // ---- shot refBindings resolve into the registry ---------------------------
  for (const [i, s] of ir.shots.entries()) {
    for (const [j, ref] of s.refBindings.entries()) {
      if (!registry.has(ref)) {
        issue(`refBindings 指向未注册的 ref: ${ref}`, ['shots', i, 'refBindings', j]);
      }
    }
  }

  // ---- audio clips resolve into shots ---------------------------------------
  const byShot = new Set(ir.shots.map(s => s.id));
  ir.audio.forEach((clip, i) => {
    if (clip.kind === 'bgm') {
      if (!byShot.has(clip.fromShotId)) issue(`fromShotId 不存在: ${clip.fromShotId}`, ['audio', i, 'fromShotId']);
      if (clip.toShotId && !byShot.has(clip.toShotId)) issue(`toShotId 不存在: ${clip.toShotId}`, ['audio', i, 'toShotId']);
    } else if (!byShot.has(clip.shotId)) {
      issue(`shotId 不存在: ${clip.shotId}`, ['audio', i, 'shotId']);
    }
  });
  const audioIds = new Set<string>();
  for (const [i, clip] of ir.audio.entries()) {
    if (audioIds.has(clip.id)) issue(`audio id 重复: ${clip.id}`, ['audio', i, 'id']);
    audioIds.add(clip.id);
  }

  // ---- transitions resolve into shots ---------------------------------------
  for (const [i, t] of ir.transitions.entries()) {
    if (!byShot.has(t.target)) issue(`target 镜头不存在: ${t.target}`, ['transitions', i, 'target']);
    if (t.from && !byShot.has(t.from)) issue(`from 镜头不存在: ${t.from}`, ['transitions', i, 'from']);
  }
  const trIds = new Set<string>();
  for (const [i, t] of ir.transitions.entries()) {
    if (trIds.has(t.id)) issue(`transition id 重复: ${t.id}`, ['transitions', i, 'id']);
    trIds.add(t.id);
  }

  // ---- spatial: unique layout ids + unique object ids within a layout -------
  const seenSpatial = new Set<string>();
  ir.spatial.forEach((sp, i) => {
    if (seenSpatial.has(sp.id)) issue(`spatial id 重复: ${sp.id}`, ['spatial', i, 'id']);
    seenSpatial.add(sp.id);
    const objIds = new Set<string>();
    sp.objects.forEach((o, j) => {
      if (objIds.has(o.id)) issue(`布局内对象 id 重复: ${o.id}`, ['spatial', i, 'objects', j, 'id']);
      objIds.add(o.id);
    });
  });
});

/** Parse or throw (zod error with structured issues). */
export const parseStoryFlowIR = (input: unknown): StoryFlowIR => storyFlowIRSchema.parse(input) as StoryFlowIR;

export type IRValidation =
  | { ok: true; ir: StoryFlowIR }
  | { ok: false; issues: string[] };

/** Validate without throwing — the gate used by tooling and tests. */
export const validateStoryFlowIR = (input: unknown): IRValidation => {
  const r = storyFlowIRSchema.safeParse(input);
  if (r.success) return { ok: true, ir: r.data as StoryFlowIR };
  return {
    ok: false,
    issues: r.error.issues.map(i => {
      const path = i.path.length ? `${i.path.map(String).join('.')}: ` : '';
      return `${path}${i.message}`;
    }),
  };
};

// ── compile-time drift guard ────────────────────────────────────────────────
// The handwritten contract types (types.ts) and the zod inference must stay
// EXACTLY equal in both directions. Any schema/type edit that breaks the
// equation fails the strict gate (`npm run typecheck:ir`) here — not in
// production.
//
// The guards are armed ONLY under strictNullChecks: with null checks off,
// zod v4's inference visibly degrades (tuples widen to `[T?, T?, …unknown[]]`,
// union props turn optional) and Equal would false-positive on every schema.
// Under `--strict` the inference is exact, so Equal is a real equality proof.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** true iff strictNullChecks is on (`[undefined] extends [1]` only holds with
 *  null checks disabled). */
type NullChecksOn = [undefined] extends [1] ? false : true;

/** Unarmed under non-strict builds (evaluates to `true`), a real Equal proof
 *  under the strict gate. */
type Guard<T> = NullChecksOn extends true ? T : true;

type InferOf<T extends z.ZodType> = z.infer<T>;

const _assertDoc: Guard<Equal<StoryFlowIR, InferOf<typeof baseDocSchema>>> = true;
const _assertShot: Guard<Equal<Shot, InferOf<typeof shotSchema>>> = true;
const _assertCamera: Guard<Equal<CameraMove, InferOf<typeof cameraMoveSchema>>> = true;
const _assertGeneration: Guard<Equal<GenerationParams, InferOf<typeof generationParamsSchema>>> = true;
const _assertDialogue: Guard<Equal<ShotDialogue, InferOf<typeof shotDialogueSchema>>> = true;
const _assertWhiteModel: Guard<Equal<NonNullable<Shot['whiteModel']>, InferOf<typeof whiteModelSchema>>> = true;
const _assertFrame: Guard<Equal<FrameDesc, InferOf<typeof frameDescSchema>>> = true;
const _assertStyle: Guard<Equal<StyleRef, InferOf<typeof styleRefSchema>>> = true;
const _assertRegistry: Guard<Equal<RefRegistry, InferOf<typeof refRegistrySchema>>> = true;
const _assertCharacter: Guard<Equal<CharacterRef, InferOf<typeof characterRefSchema>>> = true;
const _assertProp: Guard<Equal<PropRef, InferOf<typeof propRefSchema>>> = true;
const _assertScene: Guard<Equal<SceneRef, InferOf<typeof sceneRefSchema>>> = true;
const _assertExtraStyle: Guard<Equal<ExtraStyleRef, InferOf<typeof extraStyleRefSchema>>> = true;
const _assertAction: Guard<Equal<ActionRef, InferOf<typeof actionRefSchema>>> = true;
const _assertAnchor: Guard<Equal<SfxAnchor, InferOf<typeof sfxAnchorSchema>>> = true;
const _assertTts: Guard<Equal<TtsClip, InferOf<typeof ttsClipSchema>>> = true;
const _assertBgm: Guard<Equal<BgmClip, InferOf<typeof bgmClipSchema>>> = true;
const _assertSfx: Guard<Equal<SfxClip, InferOf<typeof sfxClipSchema>>> = true;
const _assertAudio: Guard<Equal<AudioTrack, InferOf<typeof audioTrackSchema>>> = true;
const _assertTransition: Guard<Equal<Transition, InferOf<typeof transitionSchema>>> = true;
const _assertSpatialLayout: Guard<Equal<SpatialLayout, InferOf<typeof spatialLayoutSchema>>> = true;
const _assertSpatialObject: Guard<Equal<SpatialObject, InferOf<typeof spatialObjectSchema>>> = true;
const _assertSpatialChar: Guard<Equal<SpatialCharacter, InferOf<typeof spatialCharacterSchema>>> = true;

// referenced so the consts are not flagged as unused under strict builds
export const IR_TYPE_GUARDS_VERIFIED = [
  _assertDoc, _assertShot, _assertCamera, _assertGeneration, _assertDialogue,
  _assertFrame, _assertStyle, _assertRegistry, _assertCharacter, _assertProp,
  _assertScene, _assertExtraStyle, _assertAction, _assertAnchor, _assertTts,
  _assertBgm, _assertSfx, _assertAudio, _assertTransition,
  _assertSpatialLayout, _assertSpatialObject, _assertSpatialChar,
] as const;
