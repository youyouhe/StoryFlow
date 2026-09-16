import { Screenplay, ScriptBlock, ExportOptions, GrayboxData, GrayboxCamera } from '../types';

/**
 * Batch export helpers for a screenplay — Markdown and JSON. PDF export lives
 * in `pdfExport.ts` (it needs the print pipeline); this module handles the
 * text-based formats that bundle AI payloads (image prompts + graybox) so the
 * user doesn't have to copy them block-by-block.
 *
 * Downloads are triggered by building a Blob and clicking a temporary <a>;
 * both formats share the same option set (`ExportOptions`).
 */

/** Sanitize a string into a safe filename stem. */
const safeName = (s: string): string =>
  s.replace(/[^a-z0-9一-龥]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'screenplay';

/** Build the base filename (no extension) from metadata + date. */
const baseName = (title: string): string =>
  `${safeName(title)}_${new Date().toISOString().split('T')[0]}`;

/** Trigger a browser download of textual content. */
const downloadText = (content: string, mime: string, filename: string): void => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // revoke on next tick so the click has flushed
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---------------------------------------------------------------------------
// Graybox summary
// ---------------------------------------------------------------------------

/** One-line human-readable summary of a graybox payload, e.g.
 *  `shot · close-up · pan · 3.0s · focus: 萧萧` or
 *  `scene · 8 objects · 3 characters`. */
export const summarizeGraybox = (g: GrayboxData): string => {
  if (g.error) return `error: ${g.error}`;
  if (g.kind === 'scene') {
    const objs = g.layout?.length ?? 0;
    const chars = g.characters?.length ?? 0;
    return `scene · ${objs} object${objs === 1 ? '' : 's'} · ${chars} character${chars === 1 ? '' : 's'}`;
  }
  // shot
  const cam = g.camera;
  if (!cam) return 'shot · (no camera)';
  const parts: string[] = ['shot', cam.shotType, cam.movement.type];
  if (cam.movement.duration > 0) parts.push(`${cam.movement.duration}s`);
  if (cam.focus) parts.push(`focus: ${cam.focus}`);
  // flag lens sweep (pan/tilt lookPath) so the summary reflects the new model
  if (cam.movement.lookPath && cam.movement.lookPath.length >= 2) {
    parts.push('lens-sweep');
  }
  return parts.join(' · ');
};

/** "Overview first, detail on demand" layer (borrowed from Blender-MCP-style
 *  scene summaries): a compact one-line overview of a graybox payload.
 *  Scenes get per-role object counts, the ground extent in meters, and the
 *  blocked character roster; shots delegate to `summarizeGraybox`. Cheap and
 *  pure — safe to render beside any raw-JSON view. */
export const grayboxOverviewLine = (g: GrayboxData): string => {
  if (g.error) return `error: ${g.error}`;
  if (g.kind === 'shot') return summarizeGraybox(g);
  const layout = g.layout ?? [];
  const chars = g.characters ?? [];
  if (!layout.length && !chars.length) return 'scene · (empty)';
  const roleCounts = new Map<string, number>();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const o of layout) {
    roleCounts.set(o.role, (roleCounts.get(o.role) ?? 0) + 1);
    const [w, , d] = o.size ?? [1, 1, 1];
    const [x, , z] = o.position ?? [0, 0, 0];
    minX = Math.min(minX, x - w / 2); maxX = Math.max(maxX, x + w / 2);
    minZ = Math.min(minZ, z - d / 2); maxZ = Math.max(maxZ, z + d / 2);
  }
  const roles = [...roleCounts.entries()].map(([r, n]) => `${r}×${n}`).join(', ');
  const parts = [`scene · ${layout.length} object${layout.length === 1 ? '' : 's'}${roles ? ` (${roles})` : ''}`];
  if (Number.isFinite(minX)) {
    const w = Math.max(0, maxX - minX);
    const d = Math.max(0, maxZ - minZ);
    parts.push(`≈${w.toFixed(0)}×${d.toFixed(0)}m`);
  }
  if (chars.length) {
    parts.push(`${chars.length} character${chars.length === 1 ? '' : 's'}: ${chars.map(c => c.name).join(', ')}`);
  }
  return parts.join(' · ');
};

// ---------------------------------------------------------------------------
// Per-block payload rendering (shared by Markdown)
// ---------------------------------------------------------------------------

const BLOCK_TYPE_LABEL: Record<string, string> = {
  SCENE_HEADING: 'SCENE',
  ACTION: 'ACTION',
  CHARACTER: 'CHARACTER',
  DIALOGUE: 'DIALOGUE',
  PARENTHETICAL: 'PARENTHETICAL',
  TRANSITION: 'TRANSITION',
};

/** Render a block's AI payloads as Markdown, gated by options. Returns empty
 *  string when nothing is included. */
const renderPayloadsMarkdown = (block: ScriptBlock, opts: ExportOptions, index: number): string => {
  const lines: string[] = [];
  const wantPrompt = opts.includeImagePrompts && block.imagePrompt?.trim();
  const wantGraybox = opts.includeGraybox && block.graybox;
  const wantDub = opts.includeDubbing && !!block.dubEmotion;
  if (!wantPrompt && !wantGraybox && !wantDub) return '';

  const anchor = opts.includeBlockIds ? ` #${block.id}` : '';
  lines.push(`<details><summary>AI payloads (block ${index + 1} · ${BLOCK_TYPE_LABEL[block.type] ?? block.type}${anchor})</summary>`);
  if (wantPrompt) {
    lines.push('');
    lines.push(`**Storyboard prompt:**`);
    lines.push('');
    lines.push('```');
    lines.push(block.imagePrompt!.trim());
    lines.push('```');
  }
  if (wantGraybox) {
    lines.push('');
    lines.push(`**Graybox:** ${opts.grayboxFormat === 'summary' ? summarizeGraybox(block.graybox!) : ''}`);
    if (opts.grayboxFormat !== 'summary') {
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(block.graybox, null, 2));
      lines.push('```');
    }
  }
  if (wantDub && block.dubEmotion) {
    const d = block.dubEmotion;
    lines.push('');
    lines.push(`**Dubbing:** ${d.emotion} · intensity ${d.intensity}/10 · ${d.delivery || '—'}${d.parenthetical ? ` (${d.parenthetical})` : ''}`);
  }
  lines.push('');
  lines.push('</details>');
  lines.push('');
  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

/** Render the full screenplay as Markdown, with AI payloads folded under each
 *  block per `opts`. */
export const screenplayToMarkdown = (sp: Screenplay, opts: ExportOptions): string => {
  const { metadata, blocks } = sp;
  const lines: string[] = [];

  lines.push(`# ${metadata.title || 'Untitled'}`);
  lines.push('');
  lines.push(`*Written by ${metadata.author || '—'} · ${metadata.draft || ''} · ${new Date(sp.lastModified || Date.now()).toLocaleDateString()}*`);
  lines.push('');
  lines.push(`Language: ${metadata.scriptLanguage}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  blocks.forEach((block, i) => {
    const content = block.content;
    switch (block.type) {
      case 'SCENE_HEADING':
        lines.push(`## ${content || '(empty scene)'}`);
        lines.push('');
        break;
      case 'ACTION':
        lines.push(content || '(empty action)');
        lines.push('');
        break;
      case 'CHARACTER':
        lines.push('');
        lines.push(`**${content || 'CHARACTER'}**`);
        break;
      case 'DIALOGUE':
        lines.push(`> ${content || ''}`);
        lines.push('');
        break;
      case 'PARENTHETICAL':
        lines.push(`*(${content || ''})*`);
        break;
      case 'TRANSITION':
        lines.push('');
        lines.push(`**${content || 'CUT TO:'}**`);
        lines.push('');
        break;
      default:
        lines.push(content || '');
        lines.push('');
    }
    const payload = renderPayloadsMarkdown(block, opts, i);
    if (payload) lines.push(payload);
  });

  return lines.join('\n');
};

/** Download the screenplay as a .md file. */
export const exportMarkdown = (sp: Screenplay, opts: ExportOptions): void => {
  const md = screenplayToMarkdown(sp, opts);
  downloadText(md, 'text/markdown;charset=utf-8', `${baseName(sp.metadata.title)}.md`);
};

// ---------------------------------------------------------------------------
// JSON export
// ---------------------------------------------------------------------------

/** Full screenplay as pretty-printed JSON. Every block carries its
 *  `imagePrompt` + `graybox` as stored, so this is a lossless dump — ideal for
 *  backup or for handing the whole AI-payload set to an evaluator. */
export const screenplayToJSON = (sp: Screenplay, opts: ExportOptions): string => {
  // Always strip to honor the per-format gates — the source screenplay can carry
  // imagePrompt/graybox/dubEmotion, so returning `sp` raw would leak any payload
  // the user chose to exclude. Copy only the included ones.
  const stripped: Screenplay = {
    ...sp,
    blocks: sp.blocks.map(b => {
      const nb: ScriptBlock = { id: b.id, type: b.type, content: b.content };
      if (opts.includeImagePrompts && b.imagePrompt) nb.imagePrompt = b.imagePrompt;
      if (opts.includeGraybox && b.graybox) nb.graybox = b.graybox;
      if (opts.includeDubbing && b.dubEmotion) nb.dubEmotion = b.dubEmotion;
      return nb;
    }),
  };
  return JSON.stringify(stripped, null, 2);
};

/** Download the screenplay as a .json file. */
export const exportJSON = (sp: Screenplay, opts: ExportOptions): void => {
  const json = screenplayToJSON(sp, opts);
  downloadText(json, 'application/json;charset=utf-8', `${baseName(sp.metadata.title)}.json`);
};

// ---------------------------------------------------------------------------
// Shared option defaults
// ---------------------------------------------------------------------------

/** Sensible defaults: bundle everything, graybox as JSON (lossless). */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeImagePrompts: true,
  includeGraybox: true,
  grayboxFormat: 'json',
  includeBlockIds: true,
  includeDubbing: true,
};

// re-export for the PDF appendix path
export type { GrayboxCamera };
