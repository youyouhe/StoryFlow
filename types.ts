export type BlockType = 
  | 'SCENE_HEADING'
  | 'ACTION'
  | 'CHARACTER'
  | 'DIALOGUE'
  | 'PARENTHETICAL'
  | 'TRANSITION';

export interface ScriptBlock {
  id: string;
  type: BlockType;
  content: string;
  /** Optional text-to-image prompt attached to ACTION blocks (storyboard). */
  imagePrompt?: string;
  /** AI-inferred dubbing metadata for a DIALOGUE block — emotion + delivery
   *  + intensity, saved so a dubbing sheet can be exported with stable
   *  voice-direction per character. Populated by the DUB analysis mode. */
  dubEmotion?: DubEmotion;
  /** Link from this block's imagePrompt to the generated asset in the library.
   *  Persists the generate result so the thumbnail survives regeneration of
   *  other blocks and reloads. The url is looked up from the live library at
   *  render (object urls are session-scoped), so only the id is stored. */
  imageResult?: { assetId: string; subject: string };
  /** Optional 3D gray-box (previs) payload.
   *  SCENE_HEADING stores a 'scene' graybox (layout + characters);
   *  ACTION/DIALOGUE store a 'shot' graybox (camera). Phase-1: data + AI only;
   *  Three.js rendering arrives in phase 2. */
  graybox?: GrayboxData;
}

/** A primitive object in a scene's gray-box layout. Three.js consumes this as a
 *  BoxGeometry / plane / cylinder / sphere positioned in world space. Numbers
 *  are scene units (meters-ish); y is up. Pragmatic, not physically exact. */
export interface GrayboxObject {
  id: string;          // stable within the scene, e.g. "wall_north"
  type: 'box' | 'plane' | 'cylinder' | 'sphere';
  /** semantic role so the renderer can color/label without parsing geometry */
  role: 'wall' | 'floor' | 'ceiling' | 'door' | 'window' | 'prop' | 'furniture' | 'environment';
  label?: string;      // e.g. "玉床", "throne" — optional human hint
  position: [number, number, number];   // [x, y, z]
  size: [number, number, number];       // [w, h, d] (plane uses w,h)
  rotation?: [number, number, number];  // radians [rx, ry, rz]; optional
  color?: string;      // hex like "#8b7355"; optional
}

/** A character's blocking position within a scene. x/z ground plane; y defaults
 *  to 0 (floor). facing is radians about Y (0 = +Z). */
export interface GrayboxCharacter {
  name: string;                 // matches the CHARACTER block content
  position: [number, number];   // [x, z]
  facing?: number;              // radians about Y; optional
  pose?: string;                // "sitting", "standing", "lying" — free text
}

/** Camera movement (运镜) for a single ACTION or DIALOGUE block.
 *
 *  Two independent curves describe the move:
 *  - `path`: where the camera BODY goes in world space (position over time).
 *  - `lookPath`: where the camera LENS points over time (lookAt target over
 *    time). This is what lets a true pan (原地转头) / tilt / orbit be
 *    expressed: the body stays put while the lookAt target sweeps.
 *
 *  When `lookPath` is omitted the lens locks onto `camera.lookAt` for the
 *  whole move (the Phase-1 behavior — fine for dolly/tracking where the
 *  subject stays framed). */
export interface GrayboxCamera {
  shotType: 'extreme-wide' | 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'over-the-shoulder' | 'top-down' | 'pov';
  /** one short sentence on WHY this shot serves the beat — the director's
   *  intent (e.g. "Crane up to reveal the seal cracking as the elders reel").
   *  Carried through normalize and surfaced in the UI so the previs reads as
   *  more than just coordinates. Optional; older payloads may lack it. */
  shotDescription?: string;
  position: [number, number, number];     // [x, y, z]
  lookAt: [number, number, number];       // [x, y, z] — initial / default look target
  movement: {
    type: 'static' | 'pan' | 'tilt' | 'dolly' | 'tracking' | 'orbit' | 'crane' | 'handheld';
    duration: number;                      // seconds
    /** STORY target length, seconds — decouples the shot's screen time from the
     *  video model's fixed output length. H3 output is hard-locked to integer
     *  4–15s (single segment ≤15s, reference video ≤15s), so a beat that reads
     *  5s / 7s / 30s over the story must be planned into one or more generation
     *  segments (see utils/grayboxPlan.ts). When absent, targetSeconds defaults
     *  to `duration` (the authored camera clock) and behavior is unchanged. */
    targetSeconds?: number;                // seconds (story length; ≥1)
    /** ordered path points the camera BODY follows. For 'static' a single-point
     *  array = [position]. For dolly/tracking/orbit/crane = the polyline.
     *  For pan/tilt the body is stationary, so path = [position, position]
     *  (or omitted). Empty/omitted tolerated as "no body move". */
    path?: [number, number, number][];
    /** ordered lookAt target points the LENS sweeps through. This is the
     *  defining curve for pan/tilt/orbit/handheld-look: e.g. a pan around a
     *  room = body fixed, lookPath = [front, left, back, right, front]. When
     *  omitted, the lens holds `camera.lookAt` for the whole move. */
    lookPath?: [number, number, number][];
  };
  /** which character/object the shot focuses on (name or object id) */
  focus?: string;
}

/** Full gray-box payload stored on a block.
 *  - SCENE_HEADING: `layout` + `characters` populated, `camera` absent.
 *  - ACTION / DIALOGUE: `camera` populated, `layout`/`characters` absent.
 *  `error` is populated only when AI generation degraded; the renderer should
 *  refuse to render an errored graybox.
 *
 *  ── COORDINATE & UNITS CONSTITUTION (the interchange contract) ─────────────
 *  Every downstream consumer — the Three.js renderer (Graybox3DView), the
 *  white-model health check, the Seedance/H3 prompt builders, and any future
 *  external-DCC exporter (e.g. Blender) — reads these numbers literally:
 *    · Units: meters.
 *    · Axes: y is UP. Origin = the scene's natural center (room center for an
 *      interior, the action's ground zero for an exterior). Floor at y=0.
 *    · Angles: radians. Character `facing` is rotation about Y; 0 = +Z.
 *    · Camera aim is expressed as a lookAt TARGET point (never euler angles).
 *  AI generation prompts must restate these conventions verbatim so generated
 *  payloads never drift; converters must transform (never reinterpret) them. */
export interface GrayboxData {
  kind: 'scene' | 'shot';
  layout?: GrayboxObject[];
  characters?: GrayboxCharacter[];
  camera?: GrayboxCamera;
  error?: string;
}

export type ScriptLanguage = 'en' | 'zh' | 'dual';

/** The fixed visual DNA of a screenplay, picked (from LLM-generated
 *  candidates) when writing starts. Once set, every text-to-image prompt is
 *  locked to this look so all generated art stays stylistically consistent. */
export interface StyleHead {
  /** Short display name, e.g. "赛博朋克霓虹夜" / "水墨武侠". */
  name: string;
  /** Art style (画风): medium, palette, rendering language. */
  artStyle: string;
  /** World/scene preset (场景): era, location flavor, atmosphere. */
  scenePreset: string;
  /** Ready-to-use English prompt prefix injected verbatim into every
   *  image-prompt call. */
  promptPrefix: string;
}

export interface ScriptMetadata {
  title: string;
  author: string;
  draft: string;
  templateId?: string;
  scriptLanguage: ScriptLanguage;
  /** Chosen visual style head; absent = not picked yet (prompts then infer
   *  style per-call, which can drift). */
  styleHead?: StyleHead;
}

export interface Screenplay {
  id: string;
  metadata: ScriptMetadata;
  blocks: ScriptBlock[];
  lastModified: number;
  /** White-model reference bindings (capsule → asset id). Lives INSIDE the
   *  screenplay so exports/imports carry it — assets stay in the shared
   *  library (folder or IndexedDB), bindings travel with the script. */
  referenceBindings?: RefBindings;
  /** Sequence segmentation + per-sequence wardrobe/age state. A Sequence is a
   *  bigger continuity granule than a scene: costume/age stay stable across it
   *  (LLM judges the change points from the narrative, e.g. muddy outdoors →
   *  bathing indoors = a new sequence), so frames in one sequence reuse the
   *  same wardrobe reference instead of drifting. Determined by
   *  utils/sequence.ts. Persisted with the script. */
  sequences?: ScriptSequence[];
  /** FROM_PROMPT origin: the raw production prompt the script was transcribed
   *  from. The transcription deliberately drops the video-model constraint
   *  sections (camera rules, subtitle UI, audio, NEGATIVE) — they live here so
   *  the final video-generation prompt can reuse them verbatim. */
  sourcePrompt?: string;
}

/** One segment's per-character costume/age continuity state. */
export interface CharacterWardrobe {
  /** Costume this character wears throughout this sequence, e.g. "浴袍".
   *  Absent = the character's base design (no change from the global sheet). */
  costume?: string;
  /** Age stage this character is at, e.g. "青年" | "中年" | "晚年". Maps to a
   *  distinct library asset (`名字/年纪`); absent = default age. */
  age?: string;
}

/** A continuity granule spanning multiple scenes where characters do NOT change
 *  costume/age. `start`/`end` are block indices [start, end) over screenplay.blocks. */
export interface ScriptSequence {
  id: string;
  start: number;
  end: number;
  /** Per-character wardrobe/age within this granule. */
  wardrobe: Record<string, CharacterWardrobe>;
  /** A short label, e.g. the representative scene heading. */
  label?: string;
}

export interface ScriptTemplate {
  id: string;
  nameKey: string; // Key for translation
  descKey: string; // Key for translation
  systemPrompt: string; // The "Master" persona
  initialBlocks: ScriptBlock[];
  initialBlocksZh?: ScriptBlock[];
}

export type Theme = 'light' | 'dark';

export type Language = 'en' | 'zh';

export type LLMProvider = 'gemini' | 'deepseek';

/** Gemini reasoning effort (maps to @google/genai thinkingLevel). 'none' disables thinking. */
export type GeminiThinkingLevel = 'none' | 'low' | 'medium' | 'high';

export type ColorSettings = Record<BlockType, string>;

export interface KeyboardShortcuts {
  aiContinue: string;
  aiIdeas: string;
  aiRewrite: string;
  aiStoryboard: string;
  /** Alt+G by default. Triggers graybox generation on a focused block. */
  aiGraybox: string;
  /** Alt+Y by default. Pushes the current script to the cloud (first push
   *  creates the cloud copy; later pushes flush pending edits). */
  syncCloud: string;
}

/** AI assistant operating modes.
 *  STORYBOARD generates a text-to-image prompt;
 *  GRAYBOX generates a structured 3D previs JSON (scene layout or shot camera);
 *  DUB infers per-line dubbing metadata (emotion/delivery/intensity). */
export type AIMode = 'CONTINUE' | 'IDEAS' | 'REWRITE' | 'STORYBOARD' | 'GRAYBOX' | 'DUB' | 'FROM_PROMPT';

export interface AppSettings {
  provider: LLMProvider;
  deepseekApiKey: string;
  deepseekModel: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiThinkingLevel: GeminiThinkingLevel;
  /** MiniMax H3 video-generation BYOK (white-model submission). Empty until
   *  the user fills it; the H3 submit flow gates on it. */
  minimaxApiKey: string;
  /** MiniMax endpoint: CN 'https://api.minimaxi.com' | intl 'https://api.minimax.io'. */
  minimaxBaseUrl: string;
  /** FAL text-to-image BYOK (queue API). Empty until the user fills it; only
   *  used when imageProvider === 'fal'. Get a key at fal.ai (billing required). */
  falKey: string;
  /** FAL application model path; defaults to openai/gpt-image-2.5/flare. */
  falModel: string;
  /** FAL image quality tier — the COST lever ('low' economy ≈$0.004/img,
   *  'high' ≈$0.05/img). Defaults to 'low'. Only used when imageProvider='fal'. */
  falQuality: 'low' | 'high';
  /** Which backend generates storyboard images. 'minimax' = MiniMax image-01
   *  (page-held key, base64 response); 'fal' = FAL queue (gpt-image-2.5 etc.,
   *  async submit→poll, CDN download). */
  imageProvider: 'minimax' | 'fal';
  colorSettings: ColorSettings;
  shortcuts: KeyboardShortcuts;
  autoAcceptAI: boolean;
  aiContextBlocks: number;
  aiOutputBlocks: number;
}

/** AI-inferred dubbing metadata for a DIALOGUE line. Stored on the block so
 *  the same emotion/delivery persists across exports and re-analysis, keeping
 *  a character's voice direction stable. Fields are free-form but constrained
 *  to short, TTS-actionable phrasing. */
export interface DubEmotion {
  /** Primary emotion label, e.g. "anger", "sadness", "joy" — drives the TTS
   *  emotional preset, so keep to a small stable vocabulary. */
  emotion: string;
  /** Delivery direction: how to vocalize — e.g. "low, slow, threatening",
   *  "bright and fast", "breathy whisper". */
  delivery: string;
  /** 1–10 intensity of the delivery, mapped to TTS speed/energy. */
  intensity: number;
  /** Parenthetical/director cue baked in (may be empty). */
  parenthetical?: string;
}

export interface SceneTransitionDecision {
  action: 'continue' | 'transition';
  reason: string;
  sceneHeading?: string; // only present when action === 'transition'
}

export interface AIState {
  isLoading: boolean;
  suggestion: string | null;
  error: string | null;
  /** CONTINUE-only intermediate state: the transition decision shown to the
   *  user before the continuation is actually generated. Cleared once the
   *  continuation runs or the user discards/switches mode. */
  decision: SceneTransitionDecision | null;
  /** GRAYBOX-only intermediate state: the structured draft produced by
   *  `generateGraybox`, shown as pretty JSON and saved verbatim. Never set
   *  together with `suggestion`. Cleared on save / discard / mode switch. */
  grayboxDraft: GrayboxData | null;
  /** GRAYBOX-only: when a scene-heading cascade is running (scene graybox +
   *  every shot in the scene), this carries 1-based progress so the modal can
   *  show "shot 3/7…". Null when no batch is active. */
  batchProgress: { current: number; total: number } | null;
  /** Neutral status message (e.g. "nothing left to generate in this scene").
   *  Unlike `error` it is not a failure; optional so existing call sites that
   *  omit it stay valid. */
  info?: string | null;
}

export interface PDFOptions {
  titlePage?: boolean;
  filename?: string;
  colors?: ColorSettings;
  /** Include each block's storyboard imagePrompt in a PDF appendix. */
  includeImagePrompts?: boolean;
  /** Include each block's graybox payload in a PDF appendix. */
  includeGraybox?: boolean;
  /** How to render graybox in PDF appendix: raw JSON or a one-line summary. */
  grayboxFormat?: 'json' | 'summary';
  /** Annotate each appendix entry with its block type + id. */
  includeBlockIds?: boolean;
}

/** Export target format. PDF goes through the print pipeline; Markdown and
 *  JSON are assembled as text and downloaded via Blob. */
export type ExportFormat = 'pdf' | 'markdown' | 'json';

/** A reference image resolved for UI display — the IndexedDB record's blob
 *  turned into an object URL. Managed in App state, not persisted here.
 *  `subject` is the global identity axis ("林枫" / "环境" / "道具:古镜") that
 *  makes smart binding work across scripts. */
export interface RefImage {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  url: string; // object URL, valid for the session
  /** DERIVED display/search string (名字 / 名字/装束 / 环境 / 道具:X). */
  subject?: string;
  // ---- identity v2 ----
  kind?: 'character' | 'environment' | 'prop' | 'action';
  charName?: string;
  variant?: string;
  sceneKey?: string;
  /** Screenplays this asset is pinned to ([] = global). */
  scriptIds?: string[];
  // ---- versions ----
  versionGroup?: string;
  version?: number;
  isSelected?: boolean;
  source?: 'upload' | 'ai-generate' | 'video-frame';
  /** For AI-generated assets: the prompt that produced them. */
  sourcePrompt?: string;
}

/** White-model reference bindings, persisted per screenplay in localStorage
 *  (`ref_bindings_{scriptId}`). Keys are character names as they appear in
 *  the scene's character blocking; values are RefImage ids. */
/** Per-scene override layer for costume variants (asset subjects use the
 *  "角色名/装束名" convention, e.g. "林枫/战损"). Resolution: scene override
 *  wins, else the script-wide default. */
export interface SceneRefBindings {
  characters?: Record<string, string>;
  environment?: string;
}
export interface RefBindings {
  characters: Record<string, string>;
  environment?: string;
  /** Keyed by the owning SCENE_HEADING text. */
  scenes?: Record<string, SceneRefBindings>;
}

/** An in-app MiniMax H3 generation task — the browser-BYOK white-model
 *  submission pipeline (upload video → create task → poll → download).
 *  Persisted in localStorage `h3_tasks`; polling resumes on reload for
 *  tasks still queued/running. */
export interface H3Task {
  id: string;                     // local id
  taskId?: string;                // MiniMax task_id once created
  blockId: string;                // originating shot block id
  blockContent: string;           // beat text snapshot (identification in lists)
  status: 'uploading' | 'submitting' | 'queued' | 'running' | 'succeeded' | 'failed';
  error?: string;
  prompt: string;                 // submitted prompt (audit/retry)
  resolution: '768P' | '2K';
  videoSeconds: number;           // input white-model length (billed!)
  outputSeconds: number;
  /** Story length this task's real-screen time sits inside. When > the model
   *  max (15s) or when the planner split one beat into a chain, multiple
   *  tasks share one `rank` group; `segmentIndex`/`segmentCount` order them. */
  targetSeconds?: number;
  /** 1-based index within the planned generation chain for this shot, and the
   *  chain's total (1 when single-segment). Displayed as "2/3" on the task. */
  segmentIndex?: number;
  segmentCount?: number;
  /** Identifies tasks that belong to one planned generation chain (the shot's
   *  blockId + plan fingerprint). Chains poll independently; when a segment
   *  succeeds its URL is offered for manual concat — H3 does not deliver
   *  frame-continuous continuation, so stitching is left to the user. */
  chainId?: string;
  estimatedCost: number;          // CNY, pre-submit estimate
  resultUrl?: string;             // signed video URL when succeeded
  createdAt: number;
}

/** Options shared across the non-PDF exporters. Controls which AI payloads
 *  are bundled and how graybox is rendered. */
export interface ExportOptions {
  includeImagePrompts?: boolean;
  includeGraybox?: boolean;
  grayboxFormat?: 'json' | 'summary';
  includeBlockIds?: boolean;
  /** Bundle per-DIALOGUE dubbing direction (emotion/delivery/intensity) so a
   *  dubbing sheet can be exported for stable-voice voice work. */
  includeDubbing?: boolean;
}

// ── Gallery cloud sync (P1) ────────────────────────────────────────────────

/** Lifecycle of a script relative to the cloud.
 *  - `local`    never synced (no ScriptSyncState persisted)
 *  - `synced`   local copy reflects `baseRevision` on the server
 *  - `dirty`    edited locally since last sync, queued for push
 *  - `pushing`  transient, runtime-only, never persisted
 *  - `conflict` push got 409 and auto-resolution failed; needs user attention */
export type SyncStatus = 'local' | 'synced' | 'dirty' | 'pushing' | 'conflict';

/** Per-script cloud sync state, persisted as `sync_{scriptId}`. Absent = local. */
export interface ScriptSyncState {
  cloudId: string;
  /** Last server revision this local copy is known to reflect. */
  baseRevision: number;
  status: Exclude<SyncStatus, 'local' | 'pushing'>;
  /** Server updatedAt at last successful sync. */
  syncedAt?: number;
}

export interface GalleryUser {
  id: string;
  email: string;
  displayName: string;
}

export interface GalleryTokens {
  accessToken: string;
  refreshToken: string;
}