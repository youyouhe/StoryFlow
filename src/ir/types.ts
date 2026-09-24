/**
 * StoryFlowIR — the explicit JSON contract of StoryFlow's video-production
 * pipeline (P0). This is the COMPILER INPUT format: the P1 instances (visual
 * compiler / audio compiler / declarative format) all consume documents that
 * validate against this schema, so the field set below is a locked contract,
 * not an internal convenience.
 *
 * Everything here was EXTRACTED from structures that already exist in the
 * codebase, not invented:
 *
 *   IR concept        │ extracted from
 *   ──────────────────┼──────────────────────────────────────────────────
 *   mode              │ Screenplay.productionMode ('simple'→express,
 *                     │ 'cinematic'→pro)                    — types.ts
 *   style             │ ScriptMetadata.styleHead: StyleHead — types.ts
 *   refs              │ RefImage v4 identity model (kind/charName/variant/
 *                     │ versionGroup) + RefBindings + CharacterWardrobe
 *   shots             │ VideoPlan/VideoSegment/PlannedBeat (utils/videoPlan.ts),
 *                     │ ExpressShot (first frame + lifecycle),
 *                     │ block.imagePrompt, i2v prompt (services/expressService.ts)
 *   shots.camera      │ GrayboxCamera (shotType/position/lookAt/movement)
 *   shots.dialogue    │ PlannedBeat.dialogues + the TTS-floor rule
 *                     │ (utils/proAudio.ts fitSegmentSeconds)
 *   audio             │ ProSegmentAudio (tts/bgm/sfx) + the three adapters
 *                     │ glmTtsService / falMusicService / sfxService
 *   transitions       │ TRANSITION blocks + videoPlan scene boundaries
 *   spatial           │ GrayboxData kind='scene' (layout + characters)
 *
 * ── DESIGN PRINCIPLES (the three the schema is held to) ────────────────────
 *  1. 后端无关: the core carries NO ComfyUI/MiniMax/Grok-specific parameters.
 *     Vendor knobs live in `Shot.generation.vendor` as a flat string/number/
 *     boolean bag, so swapping a backend never changes the document shape.
 *  2. 词级锚定, 非秒级: events that hang off speech (SFX placement, subtitle
 *     sync) anchor at WORD indices inside a shot's anchor text — never at
 *     absolute seconds. Seconds are DERIVED at compile time from the probed
 *     TTS durations, so changing a voice or speed never invalidates anchors.
 *     (Inherent durations — a shot's length, a dissolve's length — are of
 *     course plain seconds.)
 *  3. 金额分整数: the IR carries no money. Any future cost field MUST be an
 *     integer in the smallest currency unit (分), never a float in 元.
 *
 * Extension policy: additive OPTIONAL fields only (minor version). Renames,
 * removals and semantic changes bump the major version. `version` is pinned
 * by the zod schema, so a stale document fails validation loudly.
 */

/** 契约版本并集(extension policy「旧文档照常通过」):旧档 0.1.0 原样通过,
 *  当前版 0.2.0(P7 additive:Shot.whiteModel 等)。 */
export type IRVersion = '0.1.0' | '0.2.0';
export const IR_VERSION: IRVersion = '0.2.0';

/** Compile profile. Maps 1:1 to Screenplay.productionMode:
 *  'express' = 简易抽卡流水线(无 graybox/白模/音轨必需项);
 *  'pro'     = 导演全流程(参考系 + SHOT_LIST + 一致性 + TTS/BGM/SFX)。 */
export type IRMode = 'express' | 'pro';

export type Vec3 = [number, number, number];

// ── style: the global style anchor ──────────────────────────────────────────

/** 全局风格锚 — verbatim from `StyleHead` (types.ts). `promptPrefix` is the
 *  ready-to-use English prefix injected verbatim into EVERY shot's
 *  imagePrompt; the schema enforces that prefix on all shots. */
export interface StyleRef {
  /** Short display name, e.g. "银盐晨光" / "水墨武侠". */
  name: string;
  /** Art style (画风): medium, palette, rendering language. */
  artStyle: string;
  /** World/scene preset (场景): era, location flavor, atmosphere. */
  scenePreset: string;
  /** English prompt prefix, prepended to every shot's imagePrompt. May be
   *  empty (then no prefix is enforced). */
  promptPrefix: string;
}

// ── refs: the reference registry ────────────────────────────────────────────

/** Where a reference asset came from — mirrors RefImage.source. */
export type AssetSource = 'upload' | 'ai-generate' | 'video-frame';

/** Provenance of the reference IMAGE backing an entry. The IR travels ids and
 *  text, never binaries — the asset itself stays in the shared library
 *  (refImageStore / folder backend), exactly like block.imageResult stores
 *  only the assetId. */
export interface AssetProvenance {
  /** Asset-library id (RefImage.id) that backs this entry. */
  assetId?: string;
  source?: AssetSource;
  /** For AI-generated assets: the prompt that produced them. */
  sourcePrompt?: string;
  /** Version-group identity (RefImage.versionGroup) — re-rolls of the same
   *  design share the group; exactly one isSelected per group in the library. */
  versionGroup?: string;
  version?: number;
}

/** One cast member design. 主/变体 is expressed the RefImage-v4 way: a base
 *  entry (`variant` absent) plus variant entries sharing `name` — 女主 and
 *  女主(战损) are DIFFERENT sheets (utils/videoSegmentSubmit.ts), never
 *  collapsed. */
export interface CharacterRef {
  /** Stable id: `char:{name}` for the base design, `char:{name}:{variant}`
   *  for a variant. Enforced by the schema. */
  id: string;
  /** Base character name as it appears in CHARACTER cues / scene blocking. */
  name: string;
  /** Costume/age variant label (装束/年纪), e.g. "战损", "青年". Absent =
   *  the base design. */
  variant?: string;
  /** 形象设定 — the identity text a prompt compiler injects for this ref. */
  description: string;
  asset?: AssetProvenance;
}

/** A key prop with its own continuity (道具锁定, 需求0901 §3.2). */
export interface PropRef {
  id: string;   // `prop:{name}`
  name: string;
  description: string;
  asset?: AssetProvenance;
}

/** A scene/location reference. `sceneHeading` is the originating SCENE_HEADING
 *  text; `spatialId` links into `spatial[]` for the 3D anchoring. */
export interface SceneRef {
  id: string;   // `scene:{name}`
  name: string;
  /** The SCENE_HEADING this ref answers to (binding resolution keys on it). */
  sceneHeading?: string;
  description: string;
  /** → SpatialLayout.id — how refs reference the spatial anchor. */
  spatialId?: string;
  asset?: AssetProvenance;
}

/** An EXTRA style reference image (composition/light/color/material/mood —
 *  the 风格类 axes of 需求0901 §3.2). The GLOBAL style anchor lives in
 *  `style`, not here; this array carries additional style refs bound
 *  per-shot via refBindings. */
export interface ExtraStyleRef {
  id: string;   // `style:{name}`
  name: string;
  description: string;
  asset?: AssetProvenance;
}

/** A motion/action reference (RefImage.kind='action'). */
export interface ActionRef {
  id: string;   // `action:{name}`
  name: string;
  description: string;
  asset?: AssetProvenance;
}

/** 五类 ref 注册表 (docs/pipeline-two-mode.md §1 Pro concept table).
 *  Category five = the global StyleRef in `style`; `styles` here holds only
 *  additional per-shot style refs. Ids are unique ACROSS the registry. */
export interface RefRegistry {
  characters: CharacterRef[];
  props: PropRef[];
  scenes: SceneRef[];
  styles: ExtraStyleRef[];
  /** Optional in v0.1 — action refs exist in the RefImage model but no
   *  pipeline stage consumes them yet. */
  actions?: ActionRef[];
}

// ── shots ───────────────────────────────────────────────────────────────────

/** IR-level shot lifecycle. Collapses ExpressShot.status's transient states
 *  (imaging/generating are runtime, not contract) with its `locked` flag and
 *  the export bookkeeping:
 *   draft     — planned, nothing generated yet
 *   generated — first frame / clip produced (ExpressShot 'image-ready'/'video-ready')
 *   locked    — 🔒 frozen against rerolls, pinned for export (ExpressShot.locked)
 *   exported  — included in a finished cut */
export type ShotStatus = 'draft' | 'generated' | 'locked' | 'exported';

/** One generated frame's description + (after generation) its asset.
 *  Mirrors ExpressShot.imageAssetId: only the durable id is stored, URLs are
 *  session-scoped and never enter the IR. */
export interface FrameDesc {
  /** 画面描述 — what this frame must show (feeds the image prompt / QC). */
  description: string;
  /** Asset-library id of the generated frame (回填 after generation). */
  assetId?: string;
}

/** Camera move for one shot (Pro) — extracted from `GrayboxCamera`. Same
 *  two-curve model: `movement.path` is where the camera BODY travels,
 *  `movement.lookPath` is where the LENS points; a pan/tilt is a stationary
 *  body with a sweeping lookPath.
 *
 *  Coordinates follow the graybox constitution (see SpatialLayout): meters,
 *  y up, radians about Y, aim as a lookAt TARGET point — never euler angles. */
export interface CameraMove {
  shotType: 'extreme-wide' | 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'over-the-shoulder' | 'top-down' | 'pov';
  /** WHY this shot serves the beat — the director's intent (GrayboxCamera.shotDescription). */
  description?: string;
  position: Vec3;
  /** Initial/default look TARGET point. */
  lookAt: Vec3;
  movement: {
    type: 'static' | 'pan' | 'tilt' | 'dolly' | 'tracking' | 'orbit' | 'crane' | 'handheld';
    /** Authored camera clock, seconds. */
    duration: number;
    /** STORY target length — decouples screen time from the video model's
     *  fixed output window (H3 hard-locks 4–15s). Absent = same as duration. */
    targetSeconds?: number;
    /** Ordered waypoints the camera BODY follows. */
    path?: Vec3[];
    /** Ordered lookAt waypoints the LENS sweeps through. */
    lookPath?: Vec3[];
  };
  /** Which character/object the shot focuses on. */
  focus?: string;
}

/** Generation parameters (Pro). Backend-agnostic by construction: the three
 *  fields above are the portable core; anything vendor-specific lives in
 *  `vendor` as a flat primitive bag and is READ ONLY by that backend's
 *  compiler — swapping 'comfyui'→'minimax' never reshapes the document.
 *  `steps` is meaningful only for self-hosted diffusion (comfyui); closed
 *  APIs store the conventional `1`. */
export interface GenerationParams {
  backend: 'comfyui' | 'minimax' | 'grok';
  /** Sampling steps (diffusion backends); ≥1 integer. */
  steps: number;
  /** Fixed seed; a reroll is a NEW seed, never a mutation (抽卡 semantics). */
  seed?: number;
  /** Vendor-specific knobs, e.g. { workflow: 'i2v-v3' } | { model: 'h3',
   *  resolution: '768P' }. Primitives only — no nested vendor schemas. */
  vendor?: Record<string, string | number | boolean>;
}

/** Spoken line bound to a shot, with the TTS duration floor. */
export interface ShotDialogue {
  /** The line, verbatim (feeds TTS and the H3 prompt). */
  text: string;
  /** TTS 时长下限(秒) — the 站长 rule: a clip must never cut its dialogue
   *  short (utils/proAudio.ts: L = ceil(Σ durations + 0.3s breath)). The
   *  compiler fills this after synthesis probing; 0 = not yet measured. */
  ttsFloor: number;
}

/** The core production unit — one numbered shot. Shape fixed by the P0 task;
 *  see docs/storyflow-ir-schema.md for the field-by-field contract. */
export interface Shot {
  /** `SHOT_001` format, zero-padded ≥3 digits. */
  id: string;
  /** 1-based order; the schema enforces a contiguous 1..N sequence. */
  sequence: number;
  /** 首帧生成 prompt — MUST start with `style.promptPrefix` (the StyleHead
   *  prefix is baked in upstream in the express pipeline). */
  imagePrompt: string;
  /** 画面内运动描述 — the in-frame motion the I2V stage animates. */
  motionPrompt: string;
  /** 镜头总时长(秒) — story time. Compile-time clamping to a model's
   *  output window (4–15s, utils/videoSegmentSubmit.ts) is the compiler's
   *  job and does NOT rewrite this field. */
  shotDuration: number;
  firstFrame: FrameDesc;
  /** 尾帧描述 — optional; used for endpoint-conditioned generation. */
  lastFrame?: FrameDesc;
  /** 运镜 (Pro, extracted from the segment/shot graybox). */
  camera?: CameraMove;
  /** Referenced registry ids (characters/props/scenes/styles/actions) —
   *  every id must exist in `refs`. */
  refBindings: string[];
  /** 说话人 (DIALOGUE shots) — base character name. */
  character?: string;
  /** 对白 (如有). Presence REQUIRES `character`. */
  dialogue?: ShotDialogue;
  /** R2V 白模参考视频(P7 additive):资产只存库 id(P0 惯例),Blob 在 IO
   *  边缘解算;durationSeconds = 白模时长(r2v 计费/校验口径)。 */
  whiteModel?: { assetId?: string; durationSeconds: number };
  /** 生成参数 (Pro); absent = compiler default. */
  generation?: GenerationParams;
  status: ShotStatus;
}

// ── audio: the three tracks as one flat, kind-tagged clip list ──────────────

/** Word-level anchor (设计原则 2). `wordIndex` indexes the shot's ANCHOR TEXT
 *  — `dialogue.text` when the shot has dialogue, else `motionPrompt` —
 *  counting words from 0: 中文按字, 英文按空白分词. The audio compiler
 *  converts the index to milliseconds from probed TTS timings, so re-voicing
 *  or re-timing never invalidates the anchor. */
export type SfxAnchor =
  | { kind: 'shot-start' }
  | { kind: 'shot-end' }
  | { kind: 'word'; wordIndex: number };

/** Dialogue clip — one synthesized line (GLM-TTS). Extracted from
 *  ProSegmentAudio.tts + GlmTtsOptions (services/glmTtsService.ts). */
export interface TtsClip {
  id: string;      // `aud-tts-001` …
  kind: 'tts';
  /** → Shot.id. */
  shotId: string;
  character?: string;
  text: string;
  /** Voice id — a GLM system voice (tongtong/chuichui/xiaochen/jam/kazi/
   *  douji/luodo) or a custom clone id passed through verbatim. */
  voice: string;
  /** Delivery knobs (official 0.6–2; the UI offers 0.5–2 — the schema
   *  accepts the UI range). */
  speed?: number;
  volume?: number;
  /** Watermark in the synthesized audio; default true per the adapter. */
  watermark?: boolean;
  /** Probed wav duration (秒), 回填 by the audio compiler. */
  measuredSeconds?: number;
  /** Mix gain; default 1.0 (docs/pipeline-two-mode.md §4). */
  gain?: number;
}

/** Music bed — one fal-sonilo request result. Extracted from
 *  ProSegmentAudio.bgm + buildBgmPrompt (services/falMusicService.ts).
 *  One BGM per scene, spanning from its first shot to the next bgm clip. */
export interface BgmClip {
  id: string;      // `aud-bgm-001` …
  kind: 'bgm';
  /** First shot the bed covers. */
  fromShotId: string;
  /** Last shot covered; absent = through end of film. */
  toShotId?: string;
  /** The text-to-music prompt (StyleHead scene preset + scene mood). */
  prompt: string;
  /** Loop under the segment; default true (mix plan §4). */
  loop?: boolean;
  /** Mix gain; default 0.25. */
  gain?: number;
}

/** Effect clip — one marker resolved against the sfx manifest. Extracted
 *  from ProSegmentAudio.sfx + services/sfxService.ts. Unresolvable names
 *  stay in the IR as `missing: true` (SFX_MISSING) instead of silently
 *  dropping. */
export interface SfxClip {
  id: string;      // `aud-sfx-001` …
  kind: 'sfx';
  /** → Shot.id. */
  shotId: string;
  /** Manifest name (whoosh/ding/impact …) or any marker name if missing. */
  name: string;
  /** 词级锚定 — where the effect lands inside the shot. */
  anchor: SfxAnchor;
  /** true = no manifest/file match (SFX_MISSING); absent/false = resolved. */
  missing?: boolean;
  /** Mix gain; default 0.8. */
  gain?: number;
}

/** Any audio clip. `audio` is ONE flat list tagged by `kind`; the three
 *  tracks (对白/BGM/SFX) are the kind-filtered views — this keeps every
 *  clip bound to its shot explicitly, which is what the audio compiler and
 *  the export muxer (exportProCut) consume. */
export type AudioTrack = TtsClip | BgmClip | SfxClip;

// ── transitions ─────────────────────────────────────────────────────────────

export type TransitionType =
  | 'cut'
  | 'dissolve'
  | 'fade-in'
  | 'fade-out'
  | 'wipe'
  | 'match-cut';

/** One transition, extracted from TRANSITION blocks ("CUT TO:", "DISSOLVE
 *  TO:" …) and the video planner's scene boundaries.
 *  `target` semantics: the shot the transition lands ON — cut/dissolve/
 *  fade-in/wipe/match-cut enter `target`; fade-out plays over `target`
 *  (normally the final shot). `from` absent = the shot with the previous
 *  sequence number. */
export interface Transition {
  id: string;      // `tr-001` …
  type: TransitionType;
  /** → Shot.id. */
  target: string;
  /** → Shot.id; absent = previous shot by sequence. */
  from?: string;
  /** Inherent length of the transition itself (dissolve/fade), seconds. */
  durationSeconds?: number;
}

// ── spatial: scene space anchoring ──────────────────────────────────────────

/** One primitive object in a scene layout — verbatim from GrayboxObject
 *  (meters, y up, floor at y=0). Three.js renders this directly. */
export interface SpatialObject {
  /** Stable within the layout, e.g. "wall_north". */
  id: string;
  type: 'box' | 'plane' | 'cylinder' | 'sphere';
  /** Semantic role — color/label without parsing geometry. */
  role: 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'prop' | 'furniture' | 'environment';
  /** Optional human hint, e.g. "柜台". */
  label?: string;
  position: Vec3;
  /** [w, h, d]; planes use w,h. */
  size: Vec3;
  /** Radians [rx, ry, rz]. */
  rotation?: Vec3;
  /** Hex "#8b7355". */
  color?: string;
}

/** A character's blocking position — verbatim from GrayboxCharacter. */
export interface SpatialCharacter {
  name: string;
  /** Ground-plane [x, z]; y defaults to 0. */
  position: [number, number];
  /** Radians about Y; 0 = +Z. */
  facing?: number;
  /** "sitting" / "standing" / "lying" — free text. */
  pose?: string;
}

/** 场景空间锚定 — one scene's 3D layout, extracted from GrayboxData
 *  kind='scene'. Deliberately NOT inside Shot: layouts are shared anchors
 *  that SCENE refs point at (`SceneRef.spatialId`), and shots reach them
 *  transitively through their bound scene ref.
 *
 *  ── COORDINATE & UNITS CONSTITUTION (interchange contract, verbatim from
 *  the graybox payload in types.ts) ──
 *    · Units: meters.          · Axes: y is UP; floor at y=0.
 *    · Origin: the scene's natural center (room center interior / action
 *      ground zero exterior).
 *    · Angles: radians; `facing` is rotation about Y, 0 = +Z.
 *    · Camera aim is a lookAt TARGET point — never euler angles.
 *  Converters must transform, never reinterpret, these numbers. */
export interface SpatialLayout {
  /** `spatial:{sceneName}`; referenced by SceneRef.spatialId. */
  id: string;
  /** The SCENE_HEADING this layout answers to. */
  sceneHeading: string;
  objects: SpatialObject[];
  characters: SpatialCharacter[];
}

// ── the document ────────────────────────────────────────────────────────────

/** StoryFlowIR — the full compiler-input document. Exactly the P0 top-level
 *  contract; every field above is reachable from here. */
export interface StoryFlowIR {
  /** Schema version — IRVersion 并集(0.1.0 旧档照常通过;当前 IR_VERSION)。 */
  version: IRVersion;
  /** 编译 profile: 'express' | 'pro'. */
  mode: IRMode;
  title: string;
  /** 全局风格锚. */
  style: StyleRef;
  /** 角色/道具/场景/风格 ref 注册表. */
  refs: RefRegistry;
  /** 编号镜头列表(不含 scene layout — layouts live in `spatial`). */
  shots: Shot[];
  /** 音频片段(对白/BGM/SFX 三轨的 kind 标记平铺). */
  audio: AudioTrack[];
  /** 转场列表. */
  transitions: Transition[];
  /** 场景空间锚定(不进 shots,供 refs 引用). */
  spatial: SpatialLayout[];
}
