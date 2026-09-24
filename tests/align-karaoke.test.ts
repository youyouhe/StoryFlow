import { describe, it, expect } from 'vitest';

import type { AlignmentTake } from '../src/ir/audio/types';
import { buildWordCues, placeWordCues } from '../src/align/karaoke';
import { splitAnchorWords } from '../src/ir/shared';

const LINE = '拍一张证件照,要赶九点的火车。';
const words = splitAnchorWords(LINE);

const takeOf = (over: Partial<AlignmentTake> = {}): AlignmentTake => ({
  text: LINE,
  clipId: 'aud-tts-001',
  durationMs: 3400,
  tokens: words.map((text, i) => ({ tokenIndex: i, text, startMs: i * 100, endMs: i * 100 + 90 })),
  ...over,
});

describe('buildWordCues — 逐词字幕/karaoke', () => {
  it('作者词形 + 窗口 + 置信逐词投影', () => {
    const cues = buildWordCues(takeOf({
      tokens: words.map((_, i) => ({
        tokenIndex: i, startMs: i * 100, endMs: i * 100 + 90,
        ...(i === 10 ? { confidence: 0.42 } : {}),
      })),
    }));
    expect(cues).toHaveLength(13);
    expect(cues[10]).toEqual({ tokenIndex: 10, text: '的', startMs: 1000, endMs: 1090, confidence: 0.42 });
    // 作者词形来自 take.text 分词(非声学词形)
    expect(cues.map(c => c.text)).toEqual(words);
  });

  it('N:M 共享窗 = 多 cue 同窗(karaoke 逐词高亮)', () => {
    const cues = buildWordCues(takeOf({
      tokens: words.map((_, i) => ({
        tokenIndex: i, startMs: i < 3 ? 500 : i * 100, endMs: i < 3 ? 800 : i * 100 + 90,
      })),
    }));
    expect(cues.slice(0, 3).map(c => [c.startMs, c.endMs])).toEqual([[500, 800], [500, 800], [500, 800]]);
  });

  it('take 与文本不符即抛(拒绝而非钳制)', () => {
    expect(() => buildWordCues(takeOf({ tokens: [] }))).toThrow(/token 数/);
  });
});

describe('placeWordCues — 时间轴平移', () => {
  it('平移 stemOffset(② timeline 同源)', () => {
    const cues = buildWordCues(takeOf());
    const placed = placeWordCues(cues, 1500);
    expect(placed[0].startMs).toBe(1500);
    expect(placed[12].endMs).toBe(12 * 100 + 90 + 1500);
  });
});
