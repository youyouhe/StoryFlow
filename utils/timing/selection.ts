/**
 * Selections (named ranges) and Moments (named points) — the semantic marks
 * that bind visual content to words (P2 of docs/storyflow-adoption-plan.md).
 *
 * A mark names a GAP BETWEEN tokens (`gap` 0..tokenCount) with a `snap` side,
 * so two marks can sit at one instant and still keep distinct author identity
 * (Hypit's left/right absorption). Selections may cross each other and span
 * blocks; they are NOT XML tags and never nest.
 *
 * Marks store structural refs, not seconds: when text is edited and the token
 * count changes, refs CLAMP into the new range at projection time (ref stays
 * put; the world moves under it). True marker motion through edits — diff
 * tracking, Hypit's "writeback" — is the P2b refinement.
 */
import type { MarkRef, ScriptMarks, ScriptMoment, ScriptSelection, ScriptToken } from '../../types';

/** Clamp one ref's gap into the block's current token range. */
export const clampMarkRef = (ref: MarkRef, tokensByBlock: Map<string, ScriptToken[]>): MarkRef => {
  const count = tokensByBlock.get(ref.blockId)?.length ?? 0;
  const gap = Math.max(0, Math.min(count, ref.gap));
  return gap === ref.gap ? ref : { ...ref, gap };
};

/** Clamp every mark in a set (non-destructive: input is not mutated). */
export const clampMarks = (marks: ScriptMarks, tokensByBlock: Map<string, ScriptToken[]>): ScriptMarks => ({
  selections: marks.selections.map((s): ScriptSelection => ({
    ...s,
    start: clampMarkRef(s.start, tokensByBlock),
    end: clampMarkRef(s.end, tokensByBlock),
  })),
  moments: marks.moments.map((m): ScriptMoment => ({
    ...m,
    at: clampMarkRef(m.at, tokensByBlock),
  })),
});

/** Ref to a gap just AFTER the given token (start of next = "right" snap). */
export const refAfterToken = (token: ScriptToken, snap: MarkRef['snap'] = 'right'): MarkRef => ({
  blockId: token.blockId,
  gap: token.index + 1,
  snap,
});

/** Ref to the gap just BEFORE the given token (its own start = "right" snap). */
export const refBeforeToken = (token: ScriptToken, snap: MarkRef['snap'] = 'right'): MarkRef => ({
  blockId: token.blockId,
  gap: token.index,
  snap,
});

/** Build a selection covering a run of tokens within one block (the editor's
 *  "select text → mark range" gesture maps to consecutive token indices). */
export const selectionFromTokenRun = (
  id: string,
  blockId: string,
  startGap: number,
  endGap: number,
): ScriptSelection => ({
  id,
  start: { blockId, gap: Math.min(startGap, endGap), snap: 'right' },
  end: { blockId, gap: Math.max(startGap, endGap), snap: 'left' },
});

/** Build a moment at one gap. */
export const momentAtGap = (id: string, blockId: string, gap: number): ScriptMoment => ({
  id,
  at: { blockId, gap, snap: 'right' },
});

const MARK_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;

/** Author-visible mark names stay filesystem- and prompt-safe. */
export const isValidMarkName = (id: string): boolean => MARK_NAME_RE.test(id);
