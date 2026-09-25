import type { ScriptBlock, Screenplay } from '../types';

/**
 * Style-prefix composition + character-sheet resolution (issue #8 — 剧本 JSON
 * 去冗余, schemaVersion 3).
 *
 * v2 stored the styleHead prefix INLINE in every block's imagePrompt
 * ("Global Style: …" line, ~600 chars × every block). Two failure modes 站长
 * hit in手测: massive duplication, and — worse — STYLE DRIFT: after editing
 * styleHead the old blocks kept the stale prefix, so one screenplay showed
 * two eras. v3 fixes the source of truth:
 *
 *   · blocks store the INCREMENT only (Subject/Mood/Identity… lines, no
 *     "Global Style:" line);
 *   · the prefix is composed FROM the current styleHead at every read site
 *     (display, image generation, export) — editing styleHead updates every
 *     existing block instantly;
 *   · character design sheets live ONCE in `screenplay.characterSheets`
 *     (keyed by the CHARACTER cue's exact content), blocks reference them.
 *
 * Migration lives in utils/screenplayMigrate.ts; these helpers are the read
 * side and accept BOTH shapes (inline fallback → registry → compose), so any
 * un-migrated doc still renders correctly.
 */

/** Strip ONE leading "Global Style: …" line. Idempotent. */
export const stripStylePrefix = (prompt: string): string =>
  prompt.replace(/^\s*Global Style:[^\n]*\n?/, '').trimStart();

/** The character's design-sheet prompt for a block — registry first, inline
 *  fallback (pre-migration docs). Non-CHARACTER blocks read their own field. */
export const characterSheetOf = (
  b: ScriptBlock,
  sp: Pick<Screenplay, 'characterSheets'>,
): string | undefined => {
  if (b.type !== 'CHARACTER') return b.imagePrompt?.trim() || undefined;
  return sp.characterSheets?.[b.content.trim()] ?? b.imagePrompt?.trim() ?? undefined;
};

/** The prompt as it should be RENDERED/SENT to image models: sheet/increment
 *  resolved + `Global Style:` composed from the CURRENT styleHead. Blocks
 *  already carrying a prefix (un-migrated) are passed through untouched —
 *  never doubled. */
export const composeBlockImagePrompt = (
  b: ScriptBlock,
  sp: Pick<Screenplay, 'characterSheets' | 'metadata'>,
): string => {
  const stored = characterSheetOf(b, sp);
  if (!stored) return '';
  const prefix = sp.metadata?.styleHead?.promptPrefix?.trim();
  if (prefix && !stored.startsWith('Global Style:')) {
    return `Global Style: ${prefix}\n${stored}`;
  }
  return stored;
};

/** Payload presence for UI affordances (EditorBlock "View" chip, panel gating):
 *  true when the block resolves to ANY image prompt (inline or registry). */
export const hasImagePayload = (
  b: ScriptBlock,
  sp: Pick<Screenplay, 'characterSheets'>,
): boolean => !!characterSheetOf(b, sp);
