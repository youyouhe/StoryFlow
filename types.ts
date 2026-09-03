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
  shotType: 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'over-the-shoulder' | 'top-down' | 'pov';
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
 *  refuse to render an errored graybox. */
export interface GrayboxData {
  kind: 'scene' | 'shot';
  layout?: GrayboxObject[];
  characters?: GrayboxCharacter[];
  camera?: GrayboxCamera;
  error?: string;
}

export type ScriptLanguage = 'en' | 'zh' | 'dual';

export interface ScriptMetadata {
  title: string;
  author: string;
  draft: string;
  templateId?: string;
  scriptLanguage: ScriptLanguage;
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
}

/** AI assistant operating modes.
 *  STORYBOARD generates a text-to-image prompt;
 *  GRAYBOX generates a structured 3D previs JSON (scene layout or shot camera). */
export type AIMode = 'CONTINUE' | 'IDEAS' | 'REWRITE' | 'STORYBOARD' | 'GRAYBOX';

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
  colorSettings: ColorSettings;
  shortcuts: KeyboardShortcuts;
  autoAcceptAI: boolean;
  aiContextBlocks: number;
  aiOutputBlocks: number;
}

/** AI's scene-transition judgment for the CONTINUE two-step flow.
 *  Produced by `decideSceneTransition` before a continuation is written. */
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
}