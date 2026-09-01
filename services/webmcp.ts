import { BlockType, GrayboxData } from '../types';

/**
 * WebMCP (Web Model Context Protocol) support — expose StoryFlow's
 * capabilities as standardized in-browser tools so AI agents (ChatGPT's
 * built-in browser, etc.) can operate the app directly instead of
 * simulating clicks.
 *
 * Spec status: experimental (W3C WebML CG draft; Chrome Origin Trial).
 * The API lives on `document.modelContext` in current Chrome docs and on
 * `navigator.modelContext` in the earlier draft — we feature-detect both.
 * It only exists in SECURE contexts (https / localhost): on the LAN-IP dev
 * setup (http://192.168.x.x) registration quietly no-ops.
 *
 * Architecture: this module owns tool DEFINITIONS (names, schemas, arg
 * validation); App.tsx supplies a live accessor (via a latest-ref) that
 * implements the operations over real app state. Tools are read-mostly —
 * the single write tool is append-only (no overwrite/delete surface) and
 * rides the existing autosave.
 */

// ---- minimal ambient types for the experimental API -----------------------
// Kept local (instead of the `webmcp-types` npm package) because the surface
// is still moving; everything is optional so absent implementations typecheck.

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
  execute(args: Record<string, unknown>, context: { signal: AbortSignal }): Promise<string | null>;
}

interface WebMcpModelContext {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal; exposedTo?: string[] }): Promise<unknown>;
}

declare global {
  interface Document { modelContext?: WebMcpModelContext; }
  interface Navigator { modelContext?: WebMcpModelContext; }
}

// ---- what App.tsx must supply ---------------------------------------------

export interface BlockSummary {
  index: number;
  id: string;
  type: BlockType;
  content: string;
  hasGraybox: boolean;
  grayboxKind?: 'scene' | 'shot';
  hasImagePrompt: boolean;
}

export interface StoryflowWebMcpAccessor {
  /** Read-only snapshot of app + current script state. */
  getAppInfo(): {
    app: 'StoryFlow';
    uiLanguage: string;
    scriptLanguage: string;
    provider: string;
    currentScriptId: string;
    currentScriptTitle: string;
    blockCount: number;
    savedScriptCount: number;
  };
  /** Saved-script index (id/title/lastModified). */
  listScripts(): Array<{ id: string; title: string; lastModified: number }>;
  /** Current script's blocks, optionally ranged/filtered. */
  getBlocks(opts: { from?: number; to?: number; types?: BlockType[] }): { total: number; returned: number; blocks: BlockSummary[] };
  /** Full graybox payload for one block (by index or id). */
  getGraybox(ref: { blockIndex?: number; blockId?: string }): { blockIndex: number; blockType: BlockType; content: string; graybox: GrayboxData } | { error: string };
  /** Append blocks to the current script (the only write surface). */
  appendBlocks(blocks: Array<{ type: BlockType; content: string }>): { added: number; firstIndex: number; total: number } | { error: string };
  /** Build a Seedance / MiniMax H3 white-model prompt for a shot block. */
  generateVideoPrompt(ref: { blockIndex?: number; blockId?: string }, target: 'seedance' | 'h3'): { target: string; prompt: string } | { error: string };
  /** Run the white-model health check on a shot block (geometry/limits). */
  checkGrayboxHealth(ref: { blockIndex?: number; blockId?: string }): {
    passed: boolean;
    counts: { pass: number; warn: number; fail: number };
    items: Array<{ code: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
  } | { error: string };
}

// ---- helpers ----------------------------------------------------------------

const BLOCK_TYPE_ENUM: BlockType[] = ['SCENE_HEADING', 'ACTION', 'CHARACTER', 'DIALOGUE', 'PARENTHETICAL', 'TRANSITION'];

const asInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) ? v
    : typeof v === 'string' && /^-?\d+$/.test(v) ? parseInt(v, 10)
    : undefined;

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

const ok = (data: object): string => JSON.stringify({ ok: true, ...data }, null, 2);
const err = (message: string): string => JSON.stringify({ ok: false, error: message }, null, 2);

// ---- registration ------------------------------------------------------------

/**
 * Register StoryFlow's tool set. `accessorRef` is read on every execute, so
 * App state is always current without re-registration. Returns a cleanup
 * fn (aborts registration), or null when WebMCP is unavailable.
 */
export const registerStoryflowWebMcpTools = (
  accessorRef: { current: StoryflowWebMcpAccessor },
): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const mc = document.modelContext ?? navigator.modelContext;
  // Unavailable (non-secure context / no WebMCP): return a no-op cleanup so
  // callers can use this directly as a useEffect return value — React
  // forbids effect returns other than a function (a `null` here crashed the
  // app in dev mode on the LAN-IP setup).
  if (!mc || typeof mc.registerTool !== 'function') return () => {};

  const A = () => accessorRef.current;
  const RO = { readOnlyHint: true } as const;

  const tools: WebMcpTool[] = [
    {
      name: 'storyflow_get_app_info',
      description: 'Get StoryFlow app state: current script title/id, script language, AI provider, block count, and how many scripts are saved.',
      inputSchema: { type: 'object', properties: {} },
      annotations: RO,
      execute: async () => ok(A().getAppInfo()),
    },
    {
      name: 'storyflow_list_scripts',
      description: 'List all saved screenplays in StoryFlow (id, title, lastModified timestamp).',
      inputSchema: { type: 'object', properties: {} },
      annotations: RO,
      execute: async () => ok({ scripts: A().listScripts() }),
    },
    {
      name: 'storyflow_get_blocks',
      description: 'Get blocks of the currently open screenplay. Optionally range by index (from/to, inclusive) and filter by block types. Each block has index, id, type, content, and whether it carries a graybox (3D previs) or imagePrompt payload.',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'integer', description: 'Start index (0-based, inclusive). Default 0.' },
          to: { type: 'integer', description: 'End index (inclusive). Default: last block (capped at from+199).' },
          types: { type: 'array', items: { type: 'string', enum: BLOCK_TYPE_ENUM }, description: 'Filter to these block types.' },
        },
      },
      annotations: RO,
      execute: async (args) => {
        const from = asInt(args.from);
        const to = asInt(args.to);
        const types = Array.isArray(args.types)
          ? args.types.filter((t): t is BlockType => BLOCK_TYPE_ENUM.includes(t as BlockType))
          : undefined;
        const r = A().getBlocks({ from, to, types });
        return ok(r);
      },
    },
    {
      name: 'storyflow_get_graybox',
      description: 'Get the full graybox (3D previs) JSON of one block — scene layout + character blocking on a SCENE_HEADING, or camera/movement on an ACTION/DIALOGUE. Identify the block by index or id.',
      inputSchema: {
        type: 'object',
        properties: {
          blockIndex: { type: 'integer', description: '0-based block index in the current script.' },
          blockId: { type: 'string', description: 'Block id (alternative to blockIndex).' },
        },
      },
      annotations: RO,
      execute: async (args) => {
        const r = A().getGraybox({ blockIndex: asInt(args.blockIndex), blockId: asString(args.blockId) });
        return 'error' in r ? err(r.error) : ok(r);
      },
    },
    {
      name: 'storyflow_append_blocks',
      description: 'Append screenplay blocks to the end of the currently open script (append-only — cannot modify or delete existing blocks). Changes autosave immediately. Use standard screenplay block types; write scene headings as e.g. "INT. ROOM - DAY" or Chinese "内. 大殿 - 夜".',
      inputSchema: {
        type: 'object',
        properties: {
          blocks: {
            type: 'array',
            description: 'Blocks to append, in order (max 50).',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: BLOCK_TYPE_ENUM },
                content: { type: 'string', description: 'Block text (max 2000 chars).' },
              },
              required: ['type', 'content'],
            },
          },
        },
        required: ['blocks'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: async (args) => {
        const raw = Array.isArray(args.blocks) ? args.blocks : [];
        const blocks: Array<{ type: BlockType; content: string }> = [];
        for (const b of raw.slice(0, 50)) {
          if (!b || typeof b !== 'object') continue;
          const type = (b as Record<string, unknown>).type;
          const rawContent = (b as Record<string, unknown>).content;
          if (!BLOCK_TYPE_ENUM.includes(type as BlockType) || typeof rawContent !== 'string' || !rawContent.trim()) continue;
          blocks.push({ type: type as BlockType, content: rawContent.slice(0, 2000) });
        }
        if (!blocks.length) return err('No valid blocks supplied. Each needs type (one of ' + BLOCK_TYPE_ENUM.join('/') + ') and non-empty content.');
        return (() => {
          const r = A().appendBlocks(blocks);
          return 'error' in r ? err(r.error) : ok(r);
        })();
      },
    },
    {
      name: 'storyflow_generate_video_prompt',
      description: 'Build a white-model video prompt for a shot block (ACTION/DIALOGUE carrying a graybox), ready to paste into 即梦/Seedance 2.5 (@-reference syntax) or MiniMax H3 (numbered materials). Includes the capsule-color → reference-image character mapping and a timestamped beat line.',
      inputSchema: {
        type: 'object',
        properties: {
          blockIndex: { type: 'integer', description: '0-based index of the shot block.' },
          blockId: { type: 'string', description: 'Block id (alternative to blockIndex).' },
          target: { type: 'string', enum: ['seedance', 'h3'], description: 'Prompt dialect. Default: seedance.' },
        },
      },
      annotations: RO,
      execute: async (args) => {
        const target = args.target === 'h3' ? 'h3' : 'seedance';
        const r = A().generateVideoPrompt({ blockIndex: asInt(args.blockIndex), blockId: asString(args.blockId) }, target);
        return 'error' in r ? err(r.error) : ok(r);
      },
    },
    {
      name: 'storyflow_check_graybox_health',
      description: 'Run the white-model health check on a shot block: duration limits (30s model cap), camera-character overlap, movement-path continuity, first-frame subject framing, scene blocking presence, and shot-size variety. ❌ fail items would block a white-model export; ⚠️ warnings are advisory. Use this before generating video prompts or exporting.',
      inputSchema: {
        type: 'object',
        properties: {
          blockIndex: { type: 'integer', description: '0-based index of the shot block.' },
          blockId: { type: 'string', description: 'Block id (alternative to blockIndex).' },
        },
      },
      annotations: RO,
      execute: async (args) => {
        const r = A().checkGrayboxHealth({ blockIndex: asInt(args.blockIndex), blockId: asString(args.blockId) });
        return 'error' in r ? err(r.error) : ok(r);
      },
    },
  ];

  const controller = new AbortController();
  (async () => {
    for (const tool of tools) {
      // StrictMode double-mounts effects in dev: the first round's cleanup
      // aborts this controller BEFORE its async registrations settle, and
      // registerTool rejects with AbortError when handed an aborted signal.
      // Bail silently — the second mount registers a fresh tool set.
      if (controller.signal.aborted) return;
      try {
        await mc.registerTool(tool, { signal: controller.signal });
      } catch (e) {
        if (controller.signal.aborted) return;
        console.warn(`[WebMCP] failed to register ${tool.name}:`, e);
      }
    }
    if (!controller.signal.aborted) {
      console.info(`[WebMCP] StoryFlow exposed ${tools.length} tools (document.modelContext available in this context).`);
    }
  })();

  return () => controller.abort();
};

/** Convenience: is WebMCP live in this browsing context? (secure-context only) */
export const isWebMcpAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  !!(document.modelContext ?? navigator.modelContext);
