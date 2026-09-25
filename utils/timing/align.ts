/**
 * Word-level audio alignment (P2b) — match authored tokens to ASR words.
 *
 * The matcher is character-stream LCS (the same waist Hypit's speech-alignment
 * uses): both sides are normalized to bare letters/digits, aligned by content,
 * then each token inherits the window of the ASR words its characters cover.
 * That handles N:M naturally — Dual Text `<BCC | B C C>` is one token spanning
 * three ASR words, and a two-character Chinese word covers the same ASR word
 * as its two character tokens.
 *
 * Pure and deterministic — the network lives in services/alignment.ts.
 */
import type { ScriptToken, TimedToken } from '../../types';

/** One word as measured by an ASR service (seconds, take-local). */
export interface AsrWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

const normalizeChar = (c: string): string => {
  const lower = c.toLowerCase();
  return /[\p{L}\p{N}]/u.test(lower) ? lower : '';
};

interface StreamEntry {
  char: string;
  /** owner index — ARRAY POSITION (tokens) or word index (ASR), so flattened
   *  multi-block runs keep owners unique even when block-local indices repeat */
  owner: number;
}

const tokenStream = (tokens: ScriptToken[]): StreamEntry[] => {
  const out: StreamEntry[] = [];
  tokens.forEach((t, position) => {
    if (t.kind === 'punct') return; // punctuation is never spoken
    for (const c of t.spokenText) {
      const n = normalizeChar(c);
      if (n) out.push({ char: n, owner: position });
    }
  });
  return out;
};

const asrStream = (words: AsrWord[]): StreamEntry[] => {
  const out: StreamEntry[] = [];
  words.forEach((w, wi) => {
    for (const c of w.word) {
      const n = normalizeChar(c);
      if (n) out.push({ char: n, owner: wi });
    }
  });
  return out;
};

/** Classic LCS with backtracking — ≤ a few hundred chars per block, cheap. */
const lcsPairs = (a: StreamEntry[], b: StreamEntry[]): [number, number][] => {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i].char === b[j].char
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].char === b[j].char) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
};

/**
 * Align tokens to ASR words (tokens may span several blocks — owners are
 * array positions, and the returned `index` is the position within `tokens`).
 * Tokens whose characters find no ASR counterpart (punctuation, unrecognized)
 * get interpolated windows with confidence 0 so the UI can flag them for
 * manual review (校时).
 */
export const alignTokensToAsr = (tokens: ScriptToken[], words: AsrWord[]): TimedToken[] => {
  if (!tokens.length) return [];
  const ts = tokenStream(tokens);
  const as = asrStream(words);
  const pairs = lcsPairs(ts, as);

  // token position → matched ASR word indices
  const matched = new Map<number, number[]>();
  for (const [ti, ai] of pairs) {
    const owner = ts[ti].owner;
    const list = matched.get(owner) ?? [];
    const wordOwner = as[ai].owner;
    if (list[list.length - 1] !== wordOwner) list.push(wordOwner);
    matched.set(owner, list);
  }

  const out: TimedToken[] = tokens.map((t, position): TimedToken => {
    if (t.kind === 'punct') {
      return { index: position, start: 0, end: 0, source: 'aligned' };
    }
    const hits = matched.get(position);
    if (hits && hits.length) {
      let start = Infinity;
      let end = -Infinity;
      let conf = 0;
      let confN = 0;
      for (const wi of hits) {
        const w = words[wi];
        start = Math.min(start, w.start);
        end = Math.max(end, w.end);
        if (typeof w.confidence === 'number') {
          conf += w.confidence;
          confN++;
        }
      }
      return {
        index: position,
        start: round3(start),
        end: round3(Math.max(end, start)),
        source: 'aligned',
        confidence: confN ? round3(conf / confN) : undefined,
      };
    }
    return { index: position, start: 0, end: 0, source: 'aligned' };
  });

  // interpolate unmatched words/punct (zero-width entries) between neighbors
  for (let i = 0; i < out.length; i++) {
    if (out[i].end > out[i].start) continue;
    const prev = findNeighbor(out, i, -1);
    const next = findNeighbor(out, i, 1);
    const start = prev ? prev.end : next ? Math.max(0, next.start - 0.15) : 0;
    const end = next ? next.start : prev ? prev.end + 0.15 : 0.15;
    out[i] = { ...out[i], start: round3(Math.min(start, end)), end: round3(Math.max(start, end)) };
  }
  return out;
};

const findNeighbor = (out: TimedToken[], i: number, dir: -1 | 1): TimedToken | null => {
  for (let j = i + dir; j >= 0 && j < out.length; j += dir) {
    if (out[j].end > out[j].start) return out[j];
  }
  return null;
};

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Merge aligned windows into an overlay entry list (aligned wins over stale
 *  manual entries at the same index — the newer measurement is the truth;
 *  a manual re-correction afterwards overwrites it again). */
export const mergeTimedTokens = (existing: TimedToken[] | undefined, aligned: TimedToken[]): TimedToken[] => {
  const byIndex = new Map<number, TimedToken>();
  for (const t of existing ?? []) byIndex.set(t.index, t);
  for (const t of aligned) byIndex.set(t.index, t);
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
};
