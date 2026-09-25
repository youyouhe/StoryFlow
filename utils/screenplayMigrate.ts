import type { Screenplay, ScriptBlock } from '../types';
import { stripStylePrefix } from './promptStyle';
import { parseCharacterMarker } from './beatCast';

/**
 * Screenplay migration → schemaVersion 3 (issue #8 — 剧本 JSON 去冗余).
 *
 * v1/v2 docs carry two redundancies the 手测 surfaced:
 *   1. the styleHead prefix INLINED in every block's imagePrompt — edit
 *      styleHead and old blocks keep the stale prefix (style drift) plus
 *      ~600 chars × blocks of duplication;
 *   2. one character's design sheet copied verbatim onto EVERY same-name
 *      CHARACTER block.
 *
 * v3: prefixes stripped (styleHead is the single style authority — composed
 * at read time by utils/promptStyle.composeBlockImagePrompt); sheets moved
 * ONCE into `screenplay.characterSheets` keyed by the cue's exact content;
 * off-screen cues gain the structured `characterMarker` field (cue text kept
 * — editor display and beat-cast name matching read it); schemaVersion = 3.
 *
 * PURE and IDEMPOTENT: run on every load/import without guarding. Never
 * invents content — a stripped prefix re-composes to the same bytes when the
 * styleHead still carries it; when the styleHead is gone/changed, the block
 * follows the new authority (that IS the fix).
 */

const stripBlockPrefix = (b: ScriptBlock): ScriptBlock =>
  b.imagePrompt ? { ...b, imagePrompt: stripStylePrefix(b.imagePrompt) } : b;

export const migrateScreenplay = (input: Screenplay): Screenplay => {
  if ((input.schemaVersion ?? 1) >= 3) return input;

  const characterSheets: Record<string, string> = { ...(input.characterSheets ?? {}) };
  const blocks = input.blocks.map(b => {
    let next = stripBlockPrefix(b);
    // CHARACTER design sheet → the registry (first sheet per cue slot wins;
    // same-content blocks were verbatim copies, so "first" is lossless)
    if (next.type === 'CHARACTER' && next.imagePrompt?.trim()) {
      const key = next.content.trim();
      if (key && !characterSheets[key]) characterSheets[key] = next.imagePrompt;
      const { imagePrompt, ...rest } = next;
      next = rest as ScriptBlock;
    }
    // off-screen marker → structured field (text unchanged — display +
    // beat-cast matching read the cue text)
    if (next.type === 'CHARACTER' && !next.characterMarker) {
      const marker = parseCharacterMarker(next.content);
      if (marker) next = { ...next, characterMarker: marker };
    }
    return next;
  });

  return {
    ...input,
    blocks,
    characterSheets,
    schemaVersion: 3,
    lastModified: input.lastModified,
  };
};
