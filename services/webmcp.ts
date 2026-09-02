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
  /** Continue the current script with the app's OWN AI (provider/key from
   *  Settings; BYOK — the key never leaves the page). Returns a DRAFT,
   *  never inserts; the agent decides via append_blocks. */
  continueScript(opts: { hint?: string }): Promise<{ ok: boolean; raw?: string; blocks?: Array<{ type: BlockType; content: string }>; error?: string }>;
  /** Adopt a screenplay JSON (Screenplay shape) as the current script. */
  importScript(payload: { json: string }): { ok: boolean; title?: string; blockCount?: number; error?: string };
  /** Full current screenplay as JSON. */
  exportScript(): { ok: boolean; json?: string; error?: string };
  /** Edit a block's content/type. Optimistic-concurrency guarded: the call
   *  must echo the block's CURRENT content — mismatch means it drifted
   *  (human edited since the agent last read) and the edit is refused. */
  updateBlock(ref: { blockIndex?: number; blockId?: string }, patch: { content?: string; type?: BlockType }, expectedContent: string): { ok: boolean; error?: string };
  /** Delete one block (refuses the last remaining block). Same content-match
   *  guard as updateBlock. */
  deleteBlock(ref: { blockIndex?: number; blockId?: string }, expectedContent: string): { ok: boolean; error?: string };
  /** Insert blocks at a position (0 = start; clamped to length = append). */
  insertBlocks(atIndex: number, blocks: Array<{ type: BlockType; content: string }>): { ok: boolean; firstIndex?: number; total?: number; error?: string };
  /** Trigger graybox AI generation on a block (scene heading -> scene layout;
   *  ACTION/DIALOGUE -> shot camera with owning-scene context). Consumes the
   *  user's configured AI quota; result is written straight onto the block. */
  generateGraybox(ref: { blockIndex?: number; blockId?: string }): Promise<{ ok: boolean; kind?: 'scene' | 'shot'; error?: string }>;
  /** Generate the storyboard image prompt for a block (SCENE_HEADING ->
   *  environment sheet, CHARACTER -> design sheet w/ same-name propagation,
   *  ACTION -> storyboard frame). Consumes AI quota; saved to block.imagePrompt. */
  generateImagePrompt(ref: { blockIndex?: number; blockId?: string }): Promise<{ ok: boolean; kind?: 'environment' | 'character' | 'action'; error?: string }>;
  /** Generate the IMAGE for a block's existing imagePrompt via MiniMax
   *  image-01 (page-held BYOK key). Saves to the asset library with subject +
   *  provenance. ACTION beats auto-attach the nearest established character
   *  sheet as subject_reference (bound asset first, subject-name fallback). */
  generateImage(ref: { blockIndex?: number; blockId?: string }): Promise<{ ok: boolean; subject?: string; characterLock?: string; error?: string }>;
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
    {
      name: 'storyflow_continue_script',
      description: 'Continue the current screenplay using StoryFlow\'s built-in AI (the provider/model/key configured in Settings — BYOK, consumes that account\'s API quota, same prompt pipeline as the in-app Alt+C). Returns a DRAFT as parsed blocks — it does NOT insert anything. Review the draft, then write it with storyflow_append_blocks. Alternatively the agent can write continuation itself and append directly.',
      inputSchema: {
        type: 'object',
        properties: {
          hint: { type: 'string', description: 'Optional one-line direction for the continuation, e.g. "add a plot twist before the duel".' },
        },
      },
      annotations: RO, // produces a draft only — no state change
      execute: async (args) => {
        const r = await A().continueScript({ hint: asString(args.hint) });
        return ok(r);
      },
    },
    {
      name: 'storyflow_import_script',
      description: 'Import a screenplay JSON (the Screenplay shape StoryFlow exports: { id?, metadata: { title, author, draft, templateId?, scriptLanguage }, blocks: [{ type, content }] }) and make it the currently open script. Autosave persists it and adds it to the script index. The previous current script stays saved in the index.',
      inputSchema: {
        type: 'object',
        properties: {
          json: { type: 'string', description: 'The screenplay JSON string (as produced by storyflow_export_script or the app\'s JSON export).' },
        },
        required: ['json'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: async (args) => {
        const json = asString(args.json);
        if (!json) return err('Missing "json" string.');
        const r = A().importScript({ json });
        return ok(r);
      },
    },
    {
      name: 'storyflow_export_script',
      description: 'Export the currently open screenplay as full JSON (metadata + every block with its id, type, content, and any graybox/imagePrompt payloads). Round-trips with storyflow_import_script and the app\'s JSON import/export.',
      inputSchema: { type: 'object', properties: {} },
      annotations: RO,
      execute: async () => ok(A().exportScript()),
    },
    {
      name: 'storyflow_update_block',
      description: 'Edit one block\'s content (and optionally its type). GUARDED: you must pass expectedContent = the block\'s CURRENT content verbatim — if the text drifted (a human edited it since you last read), the edit is refused; re-read via storyflow_get_blocks and retry. This protects human writing from blind overwrites.',
      inputSchema: {
        type: 'object',
        properties: {
          blockIndex: { type: 'integer', description: '0-based block index.' },
          blockId: { type: 'string', description: 'Block id (alternative to blockIndex).' },
          expectedContent: { type: 'string', description: 'The block\'s current content, verbatim (optimistic-concurrency guard).' },
          content: { type: 'string', description: 'New content (max 2000 chars).' },
          type: { type: 'string', enum: BLOCK_TYPE_ENUM, description: 'Optional new block type.' },
        },
        required: ['expectedContent', 'content'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: async (args) => {
        const r = A().updateBlock(
          { blockIndex: asInt(args.blockIndex), blockId: asString(args.blockId) },
          {
            ...(typeof args.content === 'string' ? { content: args.content.slice(0, 2000) } : {}),
            ...(BLOCK_TYPE_ENUM.includes(args.type as BlockType) ? { type: args.type as BlockType } : {}),
          },
          typeof args.expectedContent === 'string' ? args.expectedContent : '',
        );
        return ok(r);
      },
    },
    {
      name: 'storyflow_delete_block',
      description: 'Delete ONE block. DESTRUCTIVE and guarded: requires expectedContent = the block\'s current content verbatim (refuses on drift); refuses to delete the last remaining block of the script. Prefer narrowing scope with the agent\'s own appended blocks.',
      inputSchema: {
        type: 'object',
        properties: {
          blockIndex: { type: 'integer', description: '0-based block index.' },
          blockId: { type: 'string', description: 'Block id (alternative to blockIndex).' },
          expectedContent: { type: 'string', description: 'The block\'s current content, verbatim (optimistic-concurrency guard).' },
        },
        required: ['expectedContent'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      execute: async (args) => {
        const r = A().deleteBlock(
          { blockIndex: asInt(args.blockIndex), blockId: asString(args.blockId) },
          typeof args.expectedContent === 'string' ? args.expectedContent : '',
        );
        return ok(r);
      },
    },
    {
      name: 'storyflow_insert_blocks',
      description: 'Insert screenplay blocks AT a position (0 = script start; clamped to length = append). Same block shape as storyflow_append_blocks. Use when new content belongs mid-script rather than at the end.',
      inputSchema: {
        type: 'object',
        properties: {
          atIndex: { type: 'integer', description: 'Insertion index (0-based, clamped to current length).' },
          blocks: {
            type: 'array',
            description: 'Blocks to insert, in order (max 50).',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: BLOCK_TYPE_ENUM },
                content: { type: 'string' },
              },
              required: ['type', 'content'],
            },
          },
        },
        required: ['atIndex', 'blocks'],
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
        const at = asInt(args.atIndex);
        if (at == null) return err('atIndex must be an integer.');
        if (!blocks.length) return err('No valid blocks supplied.');
        return ok(A().insertBlocks(at, blocks));
      },
    },
    {
      name: 'storyflow_generate_image_prompt',
      description: 'Generate the storyboard IMAGE PROMPT for one block — SCENE_HEADING -> environment-establishing sheet, CHARACTER -> character design sheet (turnaround, propagated to same-name CHARACTER blocks), ACTION -> storyboard frame (injects established character designs for identity consistency). English six-element prompt, saved to the block and viewable in the prompt panel. CONSUMES the user\'s configured AI quota.',
      inputSchema: {
        type: 'object',
        properties: {
          blockIndex: { type: 'integer', description: '0-based index of the target block.' },
          blockId: { type: 'string', description: 'Block id (alternative to blockIndex).' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: async (args) => {
        const r = await A().generateImagePrompt({ blockIndex: asInt(args.blockIndex), blockId: asString(args.blockId) });
        return ok(r);
      },
    },
    {
      name: 'storyflow_generate_image',
      description: 'Generate the IMAGE for a block\'s existing imagePrompt via MiniMax image-01 (the page\'s BYOK key — billed per image, base64 response). Saves straight into the asset library with auto subject (character name / 环境) and sourcePrompt provenance. For ACTION beats, automatically attaches the nearest preceding character\'s design sheet as subject_reference (identity lock) when a bound or subject-matched asset exists. Run storyflow_generate_image_prompt first if the block has no prompt.',
      inputSchema: {
        type: 'object',
        properties: {
          blockIndex: { type: 'integer', description: '0-based index of the target block.' },
          blockId: { type: 'string', description: 'Block id (alternative to blockIndex).' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: async (args) => {
        const r = await A().generateImage({ blockIndex: asInt(args.blockIndex), blockId: asString(args.blockId) });
        return ok(r);
      },
    },
    {
      name: 'storyflow_generate_graybox',
      description: 'Trigger StoryFlow\'s graybox (3D previs) AI generation on one block — a SCENE_HEADING produces the scene layout + character blocking; an ACTION/DIALOGUE produces the shot camera (with owning-scene context and prior shots for rhythm). Result is written straight onto the block. CONSUMES the user\'s configured AI quota (BYOK provider from Settings). Use storyflow_get_graybox to read the result.',
      inputSchema: {
        type: 'object',
        properties: {
          blockIndex: { type: 'integer', description: '0-based index of the target block.' },
          blockId: { type: 'string', description: 'Block id (alternative to blockIndex).' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: async (args) => {
        const r = await A().generateGraybox({ blockIndex: asInt(args.blockIndex), blockId: asString(args.blockId) });
        return ok(r);
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
