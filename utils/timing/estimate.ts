/**
 * Deterministic speech-duration estimation (P2a's default time source).
 *
 * With no recorded audio (and before P2b's alignment service), spoken length
 * is estimated from the words themselves — the same role CMUdict counting
 * plays in Hypit's `estimate` package. Editing a line therefore changes its
 * duration, which is exactly the "words own time" reflow promise.
 *
 * Every constant here is a documented heuristic, never a hidden learned
 * value: same input → same seconds, in the editor, the plan and the tests.
 */
import type { ScriptBlock, ScriptToken } from '../../types';

/** CJK character: ~5 字/秒. */
const CJK_CHAR_SECONDS = 0.2;
/** Latin word: base + per-syllable, clamped (≈3 words/second prose). */
const WORD_BASE_SECONDS = 0.12;
const SYLLABLE_SECONDS = 0.08;
const WORD_MIN_SECONDS = 0.12;
const WORD_MAX_SECONDS = 0.6;
/** Breath pauses attached to punctuation. */
const COMMA_PAUSE_SECONDS = 0.1;
const SENTENCE_PAUSE_SECONDS = 0.3;

/** Coarse syllable count (vowel-group heuristic) — deterministic, not
 *  linguistic truth; good enough to order word lengths. */
const syllables = (word: string): number => {
  const groups = word.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
};

const isSentenceEnd = (p: string): boolean => /[。.!?？!…]/.test(p);
const isComma = (p: string): boolean => /[，,、;；:：]/.test(p);

const CJK_RE_TEST = (s: string): boolean => /[぀-ヿ㐀-䶿一-鿿豈-﫿]/.test(s);

/** One whitespace-separated spoken unit: CJK characters or a Latin word. */
const estimateUnitSeconds = (unit: string): number => {
  const cjkChars = [...unit].filter(c => CJK_RE_TEST(c)).length;
  if (cjkChars > 0) return CJK_CHAR_SECONDS * cjkChars;
  const s = WORD_BASE_SECONDS + SYLLABLE_SECONDS * syllables(unit);
  return Math.min(WORD_MAX_SECONDS, Math.max(WORD_MIN_SECONDS, s));
};

/** Estimated spoken seconds for one token (punctuation contributes only its
 *  pause; a Dual Text token is measured by its SPOKEN side, which may hold
 *  several words — "B C C" is three spoken units, not one). */
export const estimateTokenSeconds = (token: ScriptToken): number => {
  if (token.kind === 'punct') {
    if (isSentenceEnd(token.text)) return SENTENCE_PAUSE_SECONDS;
    if (isComma(token.text)) return COMMA_PAUSE_SECONDS;
    return 0;
  }
  const spoken = token.spokenText || token.text;
  const units = spoken.split(/\s+/).filter(Boolean);
  return units.reduce((n, unit) => n + estimateUnitSeconds(unit), 0);
};

/** Block-type delivery multipliers: dialogue is neutral, parentheticals are
 *  quicker aside, performed action breathes a little slower than narration. */
const BLOCK_MULTIPLIER: Record<ScriptBlock['type'], number> = {
  DIALOGUE: 1,
  PARENTHETICAL: 0.85,
  ACTION: 1.15,
  CHARACTER: 1,
  SCENE_HEADING: 1,
  TRANSITION: 1,
};

const MIN_BLOCK_SECONDS = 0.3;

/** Estimated spoken seconds for a block's tokens. */
export const estimateBlockSeconds = (tokens: ScriptToken[], type: ScriptBlock['type']): number => {
  const sum = tokens.reduce((n, t) => n + estimateTokenSeconds(t), 0);
  return Math.max(MIN_BLOCK_SECONDS, sum * (BLOCK_MULTIPLIER[type] ?? 1));
};
