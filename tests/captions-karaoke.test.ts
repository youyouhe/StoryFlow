import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, SfxClip } from '../src/ir/types';
import type { AlignmentTake } from '../src/ir/audio/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileKaraokeLines } from '../src/captions/karaoke';
import { toAssKaraoke, toAss } from '../src/captions/serialize';
import { compileCaptions } from '../src/captions/compile';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

const takeOf = (): AlignmentTake => ({
  text: '拍一张证件照,要赶九点的火车。',
  clipId: 'aud-tts-001',
  durationMs: 3400,
  tokens: Array.from({ length: 13 }, (_, i) => ({
    tokenIndex: i, startMs: i * 200, endMs: i * 200 + 180,
  })),
});

describe('compileKaraokeLines — 片内绝对词窗', () => {
  it('对齐窗优先:逐词片内绝对(词窗 + 拼杆/片偏移)', () => {
    const lines = compileKaraokeLines(example(), { alignments: { 'aud-tts-001': takeOf() } });
    expect(lines).toHaveLength(2); // 两个对白镜头
    const l1 = lines[0];
    expect(l1.shotId).toBe('SHOT_003');
    expect(l1.character).toBe('陈默');
    expect(l1.words).toHaveLength(13);
    expect(l1.words[0]).toEqual({ text: '拍', startMs: 11000, endMs: 11180 });
    expect(l1.words[10].startMs).toBe(11000 + 10 * 200);
    expect(l1.startMs).toBe(11000);
    expect(l1.endMs).toBe(11000 + 12 * 200 + 180);
  });

  it('字素回退恒可用(无对齐件:basis = wantSeconds)', () => {
    const lines = compileKaraokeLines(example());
    expect(lines[0].words).toHaveLength(13);
    expect(lines[0].words[0].startMs).toBe(11000);
    expect(lines[0].endMs).toBe(11000 + 6000);
  });

  it('P10 校正直通:词窗随作者窗移动', () => {
    const lines = compileKaraokeLines(example(), {
      alignments: { 'aud-tts-001': takeOf() },
      timing: { 'aud-tts-001': [{ tokenIndex: 0, startMs: 50, endMs: 150 }] },
    });
    expect(lines[0].words[0].startMs).toBe(11000 + 50);
  });

  it('行分组:词宽预算强制换行', () => {
    const lines = compileKaraokeLines(example(), {
      alignments: { 'aud-tts-001': takeOf() },
      maxCharsPerLine: 10,
    });
    // SHOT_003 13 词,行宽 10 → 10 + 3 两行
    const shot3 = lines.filter(l => l.shotId === 'SHOT_003');
    expect(shot3).toHaveLength(2);
    expect(shot3[0].words).toHaveLength(10);
    expect(shot3[1].words).toHaveLength(3);
  });
});

describe('toAssKaraoke — \\k 厘秒逐词着色', () => {
  it('ASS 结构齐备:\\k 厘秒 + 词间空隙折入前词 + 说话人 Name 字段', () => {
    const lines = compileKaraokeLines(example(), { alignments: { 'aud-tts-001': takeOf() } });
    const ass = toAssKaraoke(lines, { title: '银盐晨光' });
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('Title: 银盐晨光');
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
    // SHOT_003 行:词 i 窗 [i*200, i*200+180] → \\k = 下一词起点 − 本词起点 = 20 厘秒
    // (词间空隙 20ms 折入前词高亮);末词 = 行尾 − 起点 = 2580 − 2400 = 180 → 18
    expect(ass).toContain('Dialogue: 0,0:00:11.00,0:00:13.58,Default,陈默,0,0,0,,{\\k20}拍{\\k20}一');
    expect(ass).toContain('{\\k18}车');
  });

  it('拉丁词间补空格;空轨仅头', () => {
    const lines = [
      {
        character: 'BOY',
        shotId: 'SHOT_001',
        startMs: 0,
        endMs: 1000,
        words: [
          { text: 'OK', startMs: 0, endMs: 500 },
          { text: '2012', startMs: 500, endMs: 1000 },
        ],
      },
    ];
    const ass = toAssKaraoke(lines);
    expect(ass).toContain('{\\k50}OK {\\k50}2012'); // 拉丁词间补空格
    expect(toAssKaraoke([]).split('\n')[0]).toBe('[Script Info]');
    expect(toAssKaraoke([]).endsWith('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')).toBe(true);
  });
});

describe('toAss — 普通字幕轨(P11 CaptionTrack 直转)', () => {
  it('无 \\k:Dialogue 按 CaptionTrack 时基', () => {
    const track = compileCaptions(example());
    const ass = toAss(track, { title: '银盐晨光' });
    expect(ass).toContain('Dialogue: 0,0:00:11.00,0:00:17.00,Default,陈默,0,0,0,,[陈默]拍一张证件照,要赶九点的火车。');
    expect(ass).not.toContain('\\k');
  });
});
