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
 *
 * issue #13(语速维度):朗读时长与台词语速解耦——基准语速是**一个可配置
 * 常量** `DEFAULT_SPEECH_RATE`(4.5 字/秒,issue 原值),不散落魔法数:
 *   · `estimateTextSeconds(text, { charsPerSecond? })` —— 语速可按拍/按句
 *     注入(缺省 = 全局基准);情绪驱动语速(激动快/平稳慢)的后续注入点
 *     就是这个参数,调用方(拍长合成/字幕窗)逐句传"每句的有效语速"。
 *   · 行内括注(（低语）/（喘息)内容按 `BRACKET_RATE_FACTOR`(0.7)倍语速
 *     折算——表演括注读得更慢。
 *   · `estimateSpeechSeconds` = 朗读估时 + `SPEECH_MARGIN_SECONDS`(0.4s
 *     余量)——TTS 时长估算口径(issue #13 修复方向 1),字幕窗下限与拍长
 *     不足警告共用。
 */
import type { ScriptBlock, ScriptToken } from '../../types';

/** 基准语速(字/秒,issue #13):全局基准,可配置——改这一个常量即全局生效;
 *  更细粒度走各估算入口的 `charsPerSecond` 参数(按拍/按句注入)。 */
export const DEFAULT_SPEECH_RATE = 4.5;
/** 括注折算(issue #13 修复方向 4):（低语） 等表演括注按 0.7 倍语速朗读。 */
export const BRACKET_RATE_FACTOR = 0.7;
/** TTS 朗读时长余量(秒,issue #13 修复方向 1):句尾呼吸/起音延迟。 */
export const SPEECH_MARGIN_SECONDS = 0.4;

/** CJK character: 1/基准语速 秒/字(≈0.222s @ 4.5 字/秒)。 */
const cjkCharSeconds = (charsPerSecond?: number): number =>
  1 / Math.max(0.1, charsPerSecond ?? DEFAULT_SPEECH_RATE);
/** Latin word: base + per-syllable, clamped (≈3 words/second prose).
 *  语速参数是 CJK 字/秒口径(issue #13 的可读区间按中文字/秒定义);拉丁词
 *  模型保持固定启发式,不随语速参数缩放(记档于 docs/storyflow-speech-rate.md)。 */
const WORD_BASE_SECONDS = 0.12;
const SYLLABLE_SECONDS = 0.08;
const WORD_MIN_SECONDS = 0.12;
const WORD_MAX_SECONDS = 0.6;
/** Breath pauses attached to punctuation. */
const COMMA_PAUSE_SECONDS = 0.1;
const SENTENCE_PAUSE_SECONDS = 0.3;

/** 语速注入项(issue #13):按拍/按句传入有效语速;缺省 = 全局基准。 */
export interface SpeechRateOptions {
  /** 本句有效语速(字/秒);缺省 `DEFAULT_SPEECH_RATE`。 */
  charsPerSecond?: number;
}

export interface EstimateTextOptions extends SpeechRateOptions {
  /** 块型乘数(缺省 'ACTION');与旧位置参数 `estimateTextSeconds(text, type)` 等价。 */
  type?: ScriptBlock['type'];
}

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
const estimateUnitSeconds = (unit: string, charSec: number): number => {
  const cjkChars = [...unit].filter(c => CJK_RE_TEST(c)).length;
  if (cjkChars > 0) return charSec * cjkChars;
  const s = WORD_BASE_SECONDS + SYLLABLE_SECONDS * syllables(unit);
  return Math.min(WORD_MAX_SECONDS, Math.max(WORD_MIN_SECONDS, s));
};

/** Estimated spoken seconds for one token (punctuation contributes only its
 *  pause; a Dual Text token is measured by its SPOKEN side, which may hold
 *  several words — "B C C" is three spoken units, not one). */
export const estimateTokenSeconds = (token: ScriptToken, opts: SpeechRateOptions = {}): number => {
  if (token.kind === 'punct') {
    if (isSentenceEnd(token.text)) return SENTENCE_PAUSE_SECONDS;
    if (isComma(token.text)) return COMMA_PAUSE_SECONDS;
    return 0;
  }
  const spoken = token.spokenText || token.text;
  const units = spoken.split(/\s+/).filter(Boolean);
  const charSec = cjkCharSeconds(opts.charsPerSecond);
  return units.reduce((n, unit) => n + estimateUnitSeconds(unit, charSec), 0);
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
export const estimateBlockSeconds = (
  tokens: ScriptToken[],
  type: ScriptBlock['type'],
  opts: SpeechRateOptions = {},
): number => {
  const charSec = cjkCharSeconds(opts.charsPerSecond);
  const sum = tokens.reduce((n, t) => n + estimateTokenSeconds(t, opts), 0);
  return Math.max(MIN_BLOCK_SECONDS, sum * (BLOCK_MULTIPLIER[type] ?? 1));
};

/** 行内括注深度(（低语）/ (aside)):括注内容按 0.7 倍语速折算(issue #13)。
 *  括注字符本身是标点(不计时长)。 */
const isBracketOpen = (ch: string): boolean => ch === '（' || ch === '(';
const isBracketClose = (ch: string): boolean => ch === '）' || ch === ')';

/** Plain-text speech estimate (issue #11) — for beat synthesis where no
 *  tokenizer output exists (raw ACTION/DIALOGUE content). Mirrors the token
 *  path: CJK chars / latin words / punctuation pauses + block multiplier.
 *  issue #13:语速可注入(`charsPerSecond`,缺省全局基准)+ 行内括注 0.7 折算。 */
export const estimateTextSeconds = (
  text: string,
  typeOrOpts: ScriptBlock['type'] | EstimateTextOptions = 'ACTION',
): number => {
  const opts: EstimateTextOptions = typeof typeOrOpts === 'string'
    ? { type: typeOrOpts }
    : typeOrOpts;
  const charSec = cjkCharSeconds(opts.charsPerSecond);
  let sum = 0;
  let bracketDepth = 0;
  const re = /([぀-ヿ㐀-䶿一-鿿豈-﫿]|[^\s぀-ヿ㐀-䶿一-鿿豈-﫿]+)/g;
  for (const unit of text.match(re) ?? []) {
    if (unit.length === 1 && !CJK_RE_TEST(unit)) {
      // punctuation: pauses only(括注符号本身零时长)
      if (isBracketOpen(unit)) { bracketDepth += 1; continue; }
      if (isBracketClose(unit)) { bracketDepth = Math.max(0, bracketDepth - 1); continue; }
      if (isSentenceEnd(unit)) sum += SENTENCE_PAUSE_SECONDS;
      else if (isComma(unit)) sum += COMMA_PAUSE_SECONDS;
      continue;
    }
    sum += estimateUnitSeconds(unit, bracketDepth > 0 ? charSec / BRACKET_RATE_FACTOR : charSec);
  }
  return Math.max(MIN_BLOCK_SECONDS, sum * (BLOCK_MULTIPLIER[opts.type ?? 'ACTION'] ?? 1));
};

/** TTS 朗读时长估算(issue #13 修复方向 1):台词朗读估时(语速可注入、括注
 *  0.7 折算)+ 0.4s 余量。字幕窗下限(max(拍窗, TTS 估算))与拍长不足警告
 *  共用同一出处,不得另散魔法数。 */
export const estimateSpeechSeconds = (text: string, opts: SpeechRateOptions = {}): number =>
  estimateTextSeconds(text, { type: 'DIALOGUE', ...opts }) + SPEECH_MARGIN_SECONDS;
