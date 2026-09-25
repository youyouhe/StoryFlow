/**
 * Program timeline projection — seconds are DERIVED from words
 * (P2 of docs/storyflow-adoption-plan.md).
 *
 * One projection answers "when does every word happen":
 *
 *   blocks → tokenize → beat groups → envelopes → block windows → token windows
 *              ↓                                        ↓
 *           estimates (speech)              authored beat prefixes WIN
 *
 * Beat groups mirror utils/videoPlan.ts: a timestamped ACTION opens an
 * AUTHORED envelope ("00:00-00:03"), continuations attach to the open beat,
 * a scene heading is a hard boundary. The P2 upgrade over videoPlan: an
 * untimed action with no open beat opens an ESTIMATED envelope instead of
 * being "时长未知" — word count owns its length. Within an envelope, member
 * blocks divide time by estimated speech weight; within a block, tokens do
 * the same. Editing words re-runs this projection and everything downstream
 * re-arranges — no one drags a timeline.
 */
import type {
  MarkRef,
  Screenplay,
  ScriptBlock,
  ScriptMarks,
  ScriptToken,
} from '../../types';
import { buildAnchors, type SemanticAnchor } from './anchor';
import { clampMarks } from './selection';
import { estimateBlockSeconds, estimateTokenSeconds } from './estimate';
import { tokenizeBlocks } from './tokenize';
import { parseBeatTiming } from '../videoPlan';

export interface TokenWindow {
  tokenId: string;
  blockId: string;
  index: number;
  start: number;
  end: number;
}

export interface BlockWindow {
  blockId: string;
  start: number;
  end: number;
  /** 'authored' = a beat timestamp prefix pinned this window; 'estimated' =
   *  word estimates placed it (the reflowable case). */
  source: 'authored' | 'estimated';
  /** Prefix as written, when authored ("00:00-00:03"). */
  range?: string;
}

export interface BeatGroup {
  blockIds: string[];
  openerBlockId: string;
  source: 'authored' | 'estimated' | 'scene' | 'leading';
  start: number;
  end: number;
  range?: string;
}

export interface ProgramTimeline {
  blockIds: string[];
  tokensByBlock: Map<string, ScriptToken[]>;
  /** Program extent; program start is always 0. */
  durationSec: number;
  beats: BeatGroup[];
  blocks: BlockWindow[];
  tokens: TokenWindow[];
  /** Anchor identity → projected seconds (2M+2N+2 entries). */
  anchors: Map<string, number>;
  anchorList: SemanticAnchor[];
  /** Marks clamped into the current token ranges, projected to seconds. */
  marks: ScriptMarks;
  selectionSpans: Map<string, { start: number; end: number }>;
  momentTimes: Map<string, number>;
}

const EPS = 1e-9;

/** Timeline `at="12f"` style display helper: "0:03.5". */
export const formatSeconds = (s: number): string => {
  const total = Math.round(s * 10) / 10;
  const mm = Math.floor(total / 60);
  const ss = total - mm * 60;
  return `${mm}:${ss % 1 === 0 ? String(ss).padStart(2, '0') : ss.toFixed(1).padStart(4, '0')}`;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** A block's time contribution inside its beat envelope: a measured overlay
 *  duration (manual 校时 / audio alignment) wins over the speech estimate. */
const blockContribution = (block: ScriptBlock, tokens: ScriptToken[]): number => {
  const measured = block.timing?.durationSec;
  if (measured && measured > 0) return measured;
  return estimateBlockSeconds(tokens, block.type);
};

/** Place a block's tokens inside [w0, w1]: overlay windows (block-local
 *  seconds) land exactly and scale to fit; unoverlaid tokens fill the holes
 *  by estimate weight. Without an overlay this is pure estimate weighting. */
const placeTokens = (
  tokens: ScriptToken[],
  block: ScriptBlock,
  w0: number,
  w1: number,
): { start: number; end: number }[] => {
  const overlay = block.timing;
  if (!overlay || !overlay.tokens.length || !(overlay.durationSec > 0)) {
    // estimate weights (P2a behavior)
    const weights = tokens.map(estimateTokenSeconds);
    const sum = weights.reduce((a, b) => a + b, 0);
    const out: { start: number; end: number }[] = [];
    let cursor = w0;
    tokens.forEach((_, i) => {
      const share = sum > EPS ? (weights[i] / sum) * (w1 - w0) : (w1 - w0) / Math.max(1, tokens.length);
      const start = cursor;
      const end = i === tokens.length - 1 ? w1 : cursor + share;
      cursor = end;
      out.push({ start: round1(start), end: round1(end) });
    });
    return out;
  }

  // overlay path: local windows on [0, durationSec], then scaled to [w0, w1]
  const duration = overlay.durationSec;
  const byIndex = new Map(overlay.tokens.map(e => [e.index, e]));
  const locals: { start: number; end: number }[] = new Array(tokens.length);
  tokens.forEach((t, i) => {
    const e = byIndex.get(i);
    if (e) locals[i] = { start: Math.min(e.start, e.end), end: Math.max(e.start, e.end) };
  });
  let i = 0;
  while (i < tokens.length) {
    if (locals[i]) { i++; continue; }
    const runStart = i;
    while (i < tokens.length && !locals[i]) i++;
    const runEnd = i;
    const gapStart = runStart > 0 ? locals[runStart - 1].end : 0;
    const gapEnd = runEnd < tokens.length ? locals[runEnd].start : duration;
    const free = Math.max(0, gapEnd - gapStart);
    const weights = tokens.slice(runStart, runEnd).map(estimateTokenSeconds);
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = gapStart;
    for (let k = runStart; k < runEnd; k++) {
      const w = (weights[k - runStart] / sum) * free;
      locals[k] = { start: cursor, end: cursor + w };
      cursor += w;
    }
  }
  const scale = duration > 0 ? (w1 - w0) / duration : 1;
  return locals.map((l, idx) => ({
    start: idx === 0 ? w0 : round3(w0 + l.start * scale),
    end: idx === locals.length - 1 ? w1 : round3(w0 + l.end * scale),
  }));
};

// ---------------------------------------------------------------------------
// Beat grouping (videoPlan semantics + estimated openers)
// ---------------------------------------------------------------------------

interface RawGroup {
  blockIds: string[];
  openerBlockId: string;
  source: BeatGroup['source'];
  range?: string;
  authored?: { start: number; end: number };
}

const groupBeats = (blocks: ScriptBlock[]): RawGroup[] => {
  const groups: RawGroup[] = [];
  let current: RawGroup | null = null;

  for (const b of blocks) {
    if (b.type === 'SCENE_HEADING') {
      current = {
        blockIds: [b.id], openerBlockId: b.id, source: 'scene',
      };
      groups.push(current);
      current = null; // scene heading group is closed immediately
      continue;
    }
    const timing = b.type === 'ACTION' ? parseBeatTiming(b.content) : null;
    if (timing) {
      current = {
        blockIds: [b.id], openerBlockId: b.id, source: 'authored',
        range: timing.range, authored: { start: timing.start, end: timing.end },
      };
      groups.push(current);
      continue;
    }
    if (b.type === 'ACTION' && !current) {
      // P2 upgrade: an untimed action with no open beat used to be "时长未知".
      current = { blockIds: [b.id], openerBlockId: b.id, source: 'estimated' };
      groups.push(current);
      continue;
    }
    if (current) {
      current.blockIds.push(b.id);
    } else {
      current = { blockIds: [b.id], openerBlockId: b.id, source: 'leading' };
      groups.push(current);
    }
  }
  return groups;
};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

const groupWeight = (group: RawGroup, tokensByBlock: Map<string, ScriptToken[]>, blocksById: Map<string, ScriptBlock>): number =>
  group.blockIds.reduce((n, id) => {
    const block = blocksById.get(id);
    return n + (block ? blockContribution(block, tokensByBlock.get(id) ?? []) : 0);
  }, 0);

/** Project a full screenplay into the program timeline. Pure. */
export const buildTimeline = (screenplay: Screenplay): ProgramTimeline => {
  const { blocks, marks } = screenplay;
  const tokensByBlock = tokenizeBlocks(blocks);
  const blocksById = new Map(blocks.map(b => [b.id, b]));
  const rawGroups = groupBeats(blocks);

  // ---- envelopes -----------------------------------------------------------
  const beats: BeatGroup[] = [];
  let cursor = 0;
  for (const g of rawGroups) {
    let start: number;
    let end: number;
    if (g.source === 'authored' && g.authored) {
      start = g.authored.start; // authored prefix is authoritative
      end = g.authored.end;
      cursor = Math.max(cursor, end);
    } else {
      const weight = groupWeight(g, tokensByBlock, blocksById);
      start = cursor;
      end = cursor + weight;
      cursor = end;
    }
    beats.push({
      blockIds: g.blockIds, openerBlockId: g.openerBlockId, source: g.source,
      start, end, range: g.range,
    });
  }

  // ---- block + token windows (weights scaled into each envelope) -----------
  const blocksOut: BlockWindow[] = [];
  const tokensOut: TokenWindow[] = [];

  for (const beat of beats) {
    const weights = beat.blockIds.map(id => {
      const block = blocksById.get(id);
      return block ? blockContribution(block, tokensByBlock.get(id) ?? []) : 0;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const span = beat.end - beat.start;

    let cursorIn = beat.start;
    beat.blockIds.forEach((blockId, i) => {
      const share = totalWeight > EPS ? (weights[i] / totalWeight) * span : span / beat.blockIds.length;
      const blockStart = cursorIn;
      const blockEnd = i === beat.blockIds.length - 1 ? beat.end : cursorIn + share;
      cursorIn = blockEnd;

      blocksOut.push({
        blockId,
        start: round1(blockStart),
        end: round1(blockEnd),
        source: beat.source === 'authored' ? 'authored' : 'estimated',
        range: beat.source === 'authored' ? beat.range : undefined,
      });

      // tokens land by overlay windows (manual/aligned) or estimate weights
      const tokens = tokensByBlock.get(blockId) ?? [];
      const block = blocksById.get(blockId);
      const placed = block
        ? placeTokens(tokens, block, blockStart, blockEnd)
        : tokens.map((token, ti) => ({ tokenId: token.id, start: 0, end: 0, index: ti }));
      tokens.forEach((token, ti) => {
        tokensOut.push({
          tokenId: token.id, blockId, index: ti,
          start: placed[ti].start, end: placed[ti].end,
        });
      });
    });
  }

  const durationSec = round1(Math.max(cursor, 0));

  // ---- anchors -------------------------------------------------------------
  const blockIds = blocks.map(b => b.id);
  const anchorList = buildAnchors(blockIds, tokensByBlock);
  const windowOfBlock = new Map(blocksOut.map(w => [w.blockId, w]));
  const windowOfToken = new Map(tokensOut.map(w => [w.tokenId, w]));

  const anchors = new Map<string, number>();
  for (const a of anchorList) {
    switch (a.kind) {
      case 'program-start': anchors.set(a.id, 0); break;
      case 'program-end': anchors.set(a.id, durationSec); break;
      case 'block-start': anchors.set(a.id, windowOfBlock.get(a.blockId!)?.start ?? 0); break;
      case 'block-end': anchors.set(a.id, windowOfBlock.get(a.blockId!)?.end ?? durationSec); break;
      case 'token-start': anchors.set(a.id, windowOfToken.get(`t_${a.blockId}_${a.tokenIndex}`)?.start ?? 0); break;
      case 'token-end': anchors.set(a.id, windowOfToken.get(`t_${a.blockId}_${a.tokenIndex}`)?.end ?? 0); break;
    }
  }

  // ---- marks (clamp into current ranges, then project) ---------------------
  const clamped = marks
    ? clampMarks(marks, tokensByBlock)
    : { selections: [], moments: [] };

  const refSeconds = (ref: MarkRef, snapSide?: 'left' | 'right'): number => {
    const tokens = tokensByBlock.get(ref.blockId) ?? [];
    const window = windowOfBlock.get(ref.blockId);
    const snap = snapSide ?? ref.snap;
    if (ref.gap <= 0) return snap === 'right' && tokens.length ? (windowOfToken.get(tokens[0].id)?.start ?? window?.start ?? 0) : (window?.start ?? 0);
    if (ref.gap >= tokens.length) {
      const last = tokens[tokens.length - 1];
      return snap === 'left' && last ? (windowOfToken.get(last.id)?.end ?? window?.end ?? 0) : (window?.end ?? 0);
    }
    if (snap === 'left') {
      const prev = tokens[ref.gap - 1];
      return windowOfToken.get(prev.id)?.end ?? window?.start ?? 0;
    }
    const next = tokens[ref.gap];
    return windowOfToken.get(next.id)?.start ?? window?.end ?? 0;
  };

  const selectionSpans = new Map<string, { start: number; end: number }>();
  for (const s of clamped.selections) {
    selectionSpans.set(s.id, {
      start: refSeconds(s.start, 'right'),
      end: refSeconds(s.end, 'left'),
    });
  }
  const momentTimes = new Map<string, number>();
  for (const m of clamped.moments) {
    momentTimes.set(m.id, refSeconds(m.at));
  }

  return {
    blockIds,
    tokensByBlock,
    durationSec,
    beats,
    blocks: blocksOut,
    tokens: tokensOut,
    anchors,
    anchorList,
    marks: clamped,
    selectionSpans,
    momentTimes,
  };
};

// ---- typed accessors -------------------------------------------------------

export const blockWindow = (timeline: ProgramTimeline, blockId: string): BlockWindow | undefined =>
  timeline.blocks.find(w => w.blockId === blockId);

/** Word windows of one block (display + spoken surfaces included). */
export const blockTokenWindows = (timeline: ProgramTimeline, blockId: string): {
  token: ScriptToken; start: number; end: number;
}[] => {
  const tokens = timeline.tokensByBlock.get(blockId) ?? [];
  return tokens.map(token => {
    const w = timeline.tokens.find(t => t.tokenId === token.id);
    return { token, start: w?.start ?? 0, end: w?.end ?? 0 };
  });
};

export interface CaptionCue {
  blockId: string;
  start: number;
  end: number;
  /** Display words with their projected windows (karaoke substrate). */
  words: { text: string; start: number; end: number }[];
}

/** Caption cues = one cue per spoken block, words timed individually.
 *  (Cue Breaks `||` and per-role styling join in P5's caption family. */
export const projectCaptionCues = (timeline: ProgramTimeline): CaptionCue[] => {
  const cues: CaptionCue[] = [];
  for (const { blockId } of timeline.blocks) {
    const words = blockTokenWindows(timeline, blockId)
      .filter(({ token }) => token.kind !== 'punct' && token.text)
      .map(({ token, start, end }) => ({ text: token.text, start, end }));
    if (!words.length) continue;
    const window = blockWindow(timeline, blockId);
    cues.push({
      blockId,
      start: window?.start ?? 0,
      end: window?.end ?? 0,
      words,
    });
  }
  return cues;
};

/** Selection span by name — the `during={story.selection.x}` projection. */
export const selectionSpan = (timeline: ProgramTimeline, id: string): { start: number; end: number } | undefined =>
  timeline.selectionSpans.get(id);

/** Moment time by name — the `at={story.moment.x}` projection. */
export const momentTime = (timeline: ProgramTimeline, id: string): number | undefined =>
  timeline.momentTimes.get(id);
