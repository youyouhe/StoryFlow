/**
 * Editor offset ↔ token gap mapping (P2b) — how a textarea selection becomes
 * a Selection/Moment, and how a strip click becomes a caret jump.
 *
 * Token `rawStart`/`rawEnd` are offsets into the RAW block content (the same
 * coordinates a textarea uses), so every gesture maps without re-deriving the
 * tokenization. Pure and synchronous.
 */
import type { MarkRef, ScriptToken } from '../../types';

export interface TokenGapRange {
  /** Gap BEFORE the first covered token (0..tokenCount). */
  startGap: number;
  /** Gap AFTER the last covered token. */
  endGap: number;
}

/**
 * Map a character range [start, end) to token gaps. A partially selected
 * token counts as selected (whole-token granularity — marks never split a
 * word, matching Hypit's "a marker cannot split a speech Token").
 * Returns null when the range covers whitespace/syntax only.
 */
export const gapsFromRange = (tokens: ScriptToken[], start: number, end: number): TokenGapRange | null => {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  let first = -1;
  let last = -1;
  for (const t of tokens) {
    if (t.rawEnd <= lo || t.rawStart >= hi) continue; // no overlap
    if (first < 0) first = t.index;
    last = t.index;
  }
  if (first < 0) return null;
  return { startGap: first, endGap: last + 1 };
};

/** Gap at a bare caret position (the "mark a moment here" gesture). */
export const gapFromOffset = (tokens: ScriptToken[], offset: number): number => {
  for (const t of tokens) {
    if (offset <= t.rawStart) return t.index;
    if (offset < t.rawEnd) return t.index; // inside a word snaps to its start
  }
  return tokens.length;
};

/** Raw character range of a gap range (for jump-to-word selection). */
export const rangeFromGaps = (tokens: ScriptToken[], startGap: number, endGap: number): { start: number; end: number } | null => {
  const first = tokens[Math.max(0, Math.min(tokens.length - 1, startGap))];
  const lastIdx = Math.max(startGap, endGap) - 1;
  const last = tokens[Math.max(0, Math.min(tokens.length - 1, lastIdx))];
  if (!first || !last) return null;
  return { start: first.rawStart, end: last.rawEnd };
};

/** Convenience: MarkRef at an editor caret within one block. */
export const markRefFromOffset = (tokens: ScriptToken[], blockId: string, offset: number): MarkRef => ({
  blockId,
  gap: gapFromOffset(tokens, offset),
  snap: 'right',
});
