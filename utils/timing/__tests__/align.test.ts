/**
 * P2b — editor offsets, ASR matching (N:M), timing overlays.
 * Acceptance targets: 对齐结果按词时间窗(2), 手动校时参与 reflow, 低置信标注.
 */
import { describe, expect, it } from 'vitest';
import type { ScriptBlock, TimedToken } from '../../../types';
import { alignTokensToAsr, type AsrWord } from '../align';
import { gapFromOffset, gapsFromRange, rangeFromGaps } from '../offsets';
import { applyAlignedTokens, applyAsrToBlock, clearTokenTiming, upsertTokenTiming } from '../overlay';
import { tokenizeBlock } from '../tokenize';
import { blockTokenWindows, buildTimeline } from '../timeline';
import { applyReflow } from '../reflow';

const block = (id: string, type: ScriptBlock['type'], content: string): ScriptBlock => ({ id, type, content });

describe('offsets ↔ gaps (the editor gesture)', () => {
  it('maps a textarea selection to whole-token gaps', () => {
    const b = block('d1', 'DIALOGUE', 'Hello there world');
    const tokens = tokenizeBlock(b);
    // select "there" (offsets 6..11)
    expect(gapsFromRange(tokens, 6, 11)).toEqual({ startGap: 1, endGap: 2 });
    // select across "there world"
    expect(gapsFromRange(tokens, 6, 16)).toEqual({ startGap: 1, endGap: 3 });
    // whitespace-only selection → no mark
    expect(gapsFromRange(tokens, 5, 6)).toBeNull();
  });

  it('accounts for the beat timestamp prefix in raw offsets', () => {
    const b = block('a1', 'ACTION', '00:00-00:03。She enters.');
    const tokens = tokenizeBlock(b);
    expect(tokens[0].text).toBe('She');
    // "She" starts after the 15-char prefix "00:00-00:03。"
    expect(b.content.slice(tokens[0].rawStart, tokens[0].rawEnd)).toBe('She');
  });

  it('snaps carets to gaps and round-trips gaps to raw ranges', () => {
    const b = block('d1', 'DIALOGUE', 'Hi there');
    const tokens = tokenizeBlock(b);
    expect(gapFromOffset(tokens, 0)).toBe(0);
    expect(gapFromOffset(tokens, 3)).toBe(1); // inside "there" snaps to its start
    expect(gapFromOffset(tokens, 99)).toBe(2);
    const range = rangeFromGaps(tokens, 1, 2)!;
    expect(b.content.slice(range.start, range.end)).toBe('there');
  });
});

describe('ASR matching (N:M, Dual Text, CJK)', () => {
  it('spans one Dual Text token over several ASR words', () => {
    const b = block('d1', 'DIALOGUE', 'say <BCC | B C C> now');
    const tokens = tokenizeBlock(b);
    const words: AsrWord[] = [
      { word: 'say', start: 0, end: 0.3 },
      { word: 'B', start: 0.4, end: 0.5 },
      { word: 'C', start: 0.55, end: 0.65 },
      { word: 'C', start: 0.7, end: 0.8 },
      { word: 'now', start: 0.9, end: 1.1 },
    ];
    const timed = alignTokensToAsr(tokens, words);
    const dual = timed.find((_, i) => tokens[i].text === 'BCC')!;
    expect(dual.start).toBe(0.4);
    expect(dual.end).toBe(0.8); // covers all three spoken letters (N:M)
  });

  it('matches Chinese characters to words and interpolates punctuation', () => {
    const b = block('d1', 'DIALOGUE', '是的，没错');
    const tokens = tokenizeBlock(b);
    const words: AsrWord[] = [
      { word: '是的', start: 0, end: 0.4, confidence: 0.9 },
      { word: '没错', start: 0.6, end: 1.0, confidence: 0.4 },
    ];
    const timed = alignTokensToAsr(tokens, words);
    expect(timed[0].start).toBe(0);
    expect(timed[1].end).toBe(0.4);
    expect(timed[2].end).toBeGreaterThan(timed[2].start); // comma interpolated
    expect(timed[3].start).toBe(0.6);
    // low confidence propagates for review
    expect(timed[3].confidence).toBeCloseTo(0.4, 5);
  });

  it('is deterministic', () => {
    const tokens = tokenizeBlock(block('d1', 'DIALOGUE', 'Hello there world'));
    const words: AsrWord[] = [{ word: 'hello there', start: 0, end: 0.5 }, { word: 'world', start: 0.6, end: 1 }];
    expect(alignTokensToAsr(tokens, words)).toEqual(alignTokensToAsr(tokens, words));
  });
});

describe('overlays participate in reflow (手动校时是作者写入)', () => {
  const base = (): ScriptBlock => block('d1', 'DIALOGUE', 'Hello there world');

  it('upserts manual windows and preserves them across re-alignment', () => {
    let b = upsertTokenTiming(base(), { index: 0, start: 0, end: 0.5, source: 'manual' });
    expect(b.timing?.tokens[0].source).toBe('manual');
    // a re-run must NOT clobber a human correction
    b = applyAsrToBlock(b, [{ word: 'hello there world', start: 0, end: 2 }]).block;
    expect(b.timing?.tokens[0].source).toBe('manual');
    expect(b.timing?.tokens[0].end).toBe(0.5);
    // clearing returns the word to estimation
    b = clearTokenTiming(b, 0);
    expect(b.timing?.tokens.find(t => t.index === 0)).toBeUndefined();
  });

  it('manual windows drive the projection and thus shot lengths', () => {
    const withCam: ScriptBlock = {
      ...block('d1', 'DIALOGUE', 'Hello there world'),
      graybox: {
        kind: 'shot',
        camera: {
          shotType: 'medium',
          position: [0, 1, 3],
          lookAt: [0, 1, 0],
          movement: { type: 'static', duration: 1, targetSeconds: 1, path: [[0, 0, 0]] },
        },
      },
    };
    // author stretches the words over 3 seconds (校时)
    let b = upsertTokenTiming(withCam, { index: 0, start: 0, end: 1, source: 'manual' });
    b = upsertTokenTiming(b, { index: 1, start: 1, end: 2, source: 'manual' });
    b = upsertTokenTiming(b, { index: 2, start: 2, end: 3, source: 'manual' });

    const tl = buildTimeline({
      id: 'sp', metadata: { title: 't', author: 'a', draft: '1', scriptLanguage: 'en' },
      blocks: [b], lastModified: 0,
    });
    const words = blockTokenWindows(tl, 'd1');
    expect(words[0].start).toBe(0);
    expect(words[2].end).toBeCloseTo(3, 1);

    const retimed = applyReflow({
      id: 'sp', metadata: { title: 't', author: 'a', draft: '1', scriptLanguage: 'en' },
      blocks: [b], lastModified: 0,
    });
    expect(retimed.blocks[0].graybox!.camera!.movement.duration).toBeCloseTo(3, 1);
  });

  it('flags low-confidence words for review', () => {
    const applied = applyAsrToBlock(base(), [{ word: 'hello there world', start: 0, end: 1, confidence: 0.3 }]);
    expect(applied.lowConfidence.length).toBeGreaterThan(0);
  });

  it('applyAlignedTokens keeps block-local indices after a multi-block run', () => {
    const aligned: TimedToken[] = [
      { index: 0, start: 0, end: 0.2, source: 'aligned' },
      { index: 1, start: 0.2, end: 0.4, source: 'aligned' },
      { index: 2, start: 0.4, end: 0.6, source: 'aligned' },
    ];
    const applied = applyAlignedTokens(base(), aligned, { takeRef: 'task-1', durationSec: 0.6 });
    expect(applied.block.timing?.takeRef).toBe('task-1');
    expect(applied.block.timing?.durationSec).toBe(0.6);
    expect(applied.block.timing?.tokens.map(t => t.index)).toEqual([0, 1, 2]);
  });
});

describe('ASR JSON import shapes (the zero-service path)', () => {
  it('parses OpenAI verbose_json, whisper.cpp and HF segment shapes', async () => {
    const { parseAsrResult, AlignmentError } = await import('../../../services/alignment');
    const openai = parseAsrResult({
      words: [{ word: 'hi', start: 0, end: 0.2 }, { word: 'there', start: 0.3, end: 0.6, confidence: 0.9 }],
      text: 'hi there', duration: 0.8,
    });
    expect(openai.words).toHaveLength(2);
    expect(openai.durationSec).toBe(0.8);

    const whisperCpp = parseAsrResult({
      transcription: [{ offsets: { from: 100, to: 400 }, text: 'hi' }],
    });
    expect(whisperCpp.words[0]).toMatchObject({ start: 1, end: 4 });

    const hf = parseAsrResult({
      segments: [{ words: [{ word: 'hi', start: 0, end: 0.2 }] }],
    });
    expect(hf.words).toHaveLength(1);

    expect(() => parseAsrResult({ text: 'no timestamps' })).toThrow(AlignmentError);
  });
});
