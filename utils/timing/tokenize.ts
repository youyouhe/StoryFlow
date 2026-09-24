/**
 * Block tokenizer — the word-level foundation of the P2 time model
 * (docs/storyflow-adoption-plan.md).
 *
 * Tokens are the anchors' substrate: every English word, every CJK character
 * and every punctuation mark becomes one `ScriptToken` carrying its display
 * surface (`text`, what captions show) and its spoken surface (`spokenText`,
 * what owns duration). Dual Text `<BCC | B C C>` collapses to ONE token whose
 * two sides differ — the display side is never spoken and the spoken side is
 * never shown (Hypit's N:M Alignment Units; per-atom timing inside a group is
 * the P2b refinement).
 *
 * Pure and synchronous — tokenization must be identical in the editor, the
 * planner and the tests.
 */
import type { ScriptBlock, ScriptToken } from '../../types';

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
const LATIN_WORD_RE = /^[A-Za-z0-9']+/;
const PUNCT_RE = /^[^\sA-Za-z0-9']/;
const DUAL_TEXT_RE = /<([^|<>]*)\|([^>]*)>/;
const LEADING_TIMESTAMP_RE = /^\s*\d{1,2}:\d{2}(?:\.\d+)?\s*-\s*\d{1,2}:\d{2}(?:\.\d+)?\s*[。.，,]?\s*/;

/** Content with the beat timestamp prefix removed ("00:00-00:03。…" → "…").
 *  The prefix is an authored time envelope, never spoken text. */
export const stripBeatTimestamp = (content: string): string =>
  content.replace(LEADING_TIMESTAMP_RE, '');

/**
 * Tokenize one block's content into display/spoken tokens.
 *
 * - CJK runs split per character (Chinese never becomes one giant word);
 * - Latin/digit runs become words; everything else is punctuation;
 * - `<display | spoken>` Dual Text groups (and the `<same|>` shorthand) become
 *   one token each; markers never leak into either surface;
 * - leading beat timestamps are stripped before tokenizing;
 * - `spaceBefore` preserves author spacing exactly ("3 D" ≠ "3D").
 */
export const tokenizeBlock = (block: Pick<ScriptBlock, 'id' | 'content'>): ScriptToken[] => {
  const tokens: ScriptToken[] = [];
  const prefixLength = block.content.length - stripBeatTimestamp(block.content).length;
  const text = block.content.slice(prefixLength);
  let i = 0;
  let spaceBefore = false;

  const push = (display: string, spoken: string, kind: ScriptToken['kind'], rawStart: number, rawEnd: number): void => {
    tokens.push({
      id: `t_${block.id}_${tokens.length}`,
      blockId: block.id,
      index: tokens.length,
      text: display,
      spokenText: spoken,
      kind,
      spaceBefore,
      rawStart,
      rawEnd,
    });
    spaceBefore = false;
  };

  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      spaceBefore = tokens.length > 0 || spaceBefore;
      // A run of whitespace is one gap; remember it for the NEXT token only.
      if (tokens.length === 0) spaceBefore = false;
      i++;
      continue;
    }

    // Dual Text: one token, display | spoken (either side may be empty of
    // display, e.g. `< | um>` — spoken but never shown).
    if (ch === '<') {
      const rest = text.slice(i);
      const m = rest.match(DUAL_TEXT_RE);
      if (m) {
        const display = m[1].trim();
        const spoken = (m[2].trim() || display);
        push(display, spoken, 'word', prefixLength + i, prefixLength + i + m[0].length);
        i += m[0].length;
        continue;
      }
    }

    // Plain word / char / punct — Latin runs first, then one CJK char per
    // token, then any other single character as punctuation.
    const rest = text.slice(i);
    const latin = rest.match(LATIN_WORD_RE);
    if (latin) {
      push(latin[0], latin[0], 'word', prefixLength + i, prefixLength + i + latin[0].length);
      i += latin[0].length;
      continue;
    }
    if (CJK_RE.test(ch)) {
      push(ch, ch, 'char', prefixLength + i, prefixLength + i + 1);
      i++;
      continue;
    }
    const punct = rest.match(PUNCT_RE);
    if (punct) {
      push(punct[0], punct[0], 'punct', prefixLength + i, prefixLength + i + punct[0].length);
      i += punct[0].length;
      continue;
    }

    i++; // defensive: skip unknown char
  }

  return tokens;
};

/** Tokenize every block, keyed by block id. */
export const tokenizeBlocks = (blocks: ScriptBlock[]): Map<string, ScriptToken[]> => {
  const out = new Map<string, ScriptToken[]>();
  for (const b of blocks) out.set(b.id, tokenizeBlock(b));
  return out;
};

/** Display projection — what a caption shows (Dual Text left sides). */
export const displayText = (tokens: ScriptToken[]): string =>
  tokens.map(t => (t.spaceBefore && t.text ? ` ${t.text}` : t.text)).join('');

/** Spoken projection — what is said (Dual Text right sides). Feeds prompts
 *  and duration estimation. */
export const spokenText = (tokens: ScriptToken[]): string =>
  tokens.map(t => (t.spaceBefore && t.spokenText ? ` ${t.spokenText}` : t.spokenText)).join('');
