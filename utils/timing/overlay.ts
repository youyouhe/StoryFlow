/**
 * Block timing overlays — manual 校时 and audio-aligned windows
 * (P2b of docs/storyflow-adoption-plan.md).
 *
 * These are authored/measured writes into `block.timing`, and they participate
 * in reflow like any other author value: change the words and the projection
 * re-fits the overlay's block-local windows into the new envelope; change a
 * window and the shot lengths re-derive from it.
 */
import type { BlockTiming, ScriptBlock, TimedToken } from '../../types';
import { alignTokensToAsr, mergeTimedTokens, type AsrWord } from './align';
import { tokenizeBlock } from './tokenize';

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Overlay duration = explicit durationSec, else the last window's end. */
export const overlayDuration = (timing: BlockTiming): number => {
  if (timing.durationSec > 0) return timing.durationSec;
  return Math.max(0, ...timing.tokens.map(t => t.end));
};

/**
 * Upsert one token window. `source: 'manual'` marks it an author write (校时)
 * which later re-alignments keep unless the user clears it; 'aligned' entries
 * are replaced freely by newer measurements.
 */
export const upsertTokenTiming = (block: ScriptBlock, entry: TimedToken): ScriptBlock => {
  const rounded: TimedToken = {
    ...entry,
    start: round3(entry.start),
    end: round3(Math.max(entry.end, entry.start)),
  };
  const existing = block.timing;
  const merged = mergeTimedTokens(existing?.tokens, [rounded]);
  return {
    ...block,
    timing: {
      tokens: merged,
      durationSec: Math.max(existing?.durationSec ?? 0, ...merged.map(t => t.end)),
      source: entry.source,
      takeRef: existing?.takeRef,
    },
  };
};

/** Remove one token's overlay entry (that word falls back to estimation). */
export const clearTokenTiming = (block: ScriptBlock, index: number): ScriptBlock => {
  if (!block.timing) return block;
  const tokens = block.timing.tokens.filter(t => t.index !== index);
  if (!tokens.length) {
    const { timing: _drop, ...rest } = block;
    return rest as ScriptBlock;
  }
  return { ...block, timing: { ...block.timing, tokens } };
};

export interface AppliedTiming {
  block: ScriptBlock;
  /** Token indices with confidence < 0.6 — flagged for manual review (校时). */
  lowConfidence: number[];
}

/**
 * Write pre-aligned windows into the block. Manual entries win per token (a
 * human correction outranks a re-run); aligned entries replace stale ones.
 */
export const applyAlignedTokens = (
  block: ScriptBlock,
  aligned: TimedToken[],
  opts?: { takeRef?: string; durationSec?: number },
): AppliedTiming => {
  const manual = new Set((block.timing?.tokens ?? []).filter(t => t.source === 'manual').map(t => t.index));
  const kept = aligned.filter(t => !manual.has(t.index));
  const merged = mergeTimedTokens(block.timing?.tokens, kept);
  const lowConfidence = merged
    .filter(t => t.source === 'aligned' && typeof t.confidence === 'number' && t.confidence < 0.6)
    .map(t => t.index);
  const measured = opts?.durationSec && opts.durationSec > 0
    ? opts.durationSec
    : Math.max(block.timing?.durationSec ?? 0, ...merged.map(t => t.end));
  return {
    block: {
      ...block,
      timing: {
        tokens: merged,
        durationSec: measured,
        source: 'aligned',
        takeRef: opts?.takeRef ?? block.timing?.takeRef,
      },
    },
    lowConfidence,
  };
};

/** Single-block convenience: ASR words → matched overlay in one step. */
export const applyAsrToBlock = (
  block: ScriptBlock,
  words: AsrWord[],
  opts?: { takeRef?: string; durationSec?: number },
): AppliedTiming => {
  const aligned = alignTokensToAsr(tokenizeBlock(block), words);
  return applyAlignedTokens(block, aligned, opts);
};
