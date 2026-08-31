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

/** Options shared across the non-PDF exporters. Controls which AI payloads
 *  are bundled and how graybox is rendered. */
export interface ExportOptions {
  includeImagePrompts?: boolean;
  includeGraybox?: boolean;
  grayboxFormat?: 'json' | 'summary';
  includeBlockIds?: boolean;
}