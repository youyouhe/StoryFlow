import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, SfxClip } from '../src/ir/types';
import type { AlignmentTake } from '../src/ir/audio/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { applyManualTiming } from '../src/align/manual';
import { buildWordCues } from '../src/align/karaoke';
import { splitAnchorWords } from '../src/ir/shared';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

const LINE = '拍一张证件照,要赶九点的火车。';
const words = splitAnchorWords(LINE);
const takeOf = (): AlignmentTake => ({
  text: LINE,
  clipId: 'aud-tts-001',
  durationMs: 3400,
  tokens: words.map((_, i) => ({ tokenIndex: i, startMs: i * 200, endMs: i * 200 + 180, confidence: 0.8 })),
});

describe('applyManualTiming — 校时 = 作者写入', () => {
  it('窗口覆盖 + confidence 1;原 take 不可变', () => {
    const take = takeOf();
    const fixed = applyManualTiming(take, [{ tokenIndex: 10, startMs: 2150, endMs: 2230 }]);
    expect(fixed.tokens[10]).toEqual({ tokenIndex: 10, startMs: 2150, endMs: 2230, confidence: 1 });
    expect(fixed.tokens[9].confidence).toBe(0.8); // 其余原样
    expect(take.tokens[10].startMs).toBe(2000); // 不可变
    expect(fixed.text).toBe(LINE); // 指纹不动(stale 检测照常)
  });

  it('越界/非法窗/重复校正即抛(拒绝而非钳制)', () => {
    const take = takeOf();
    expect(() => applyManualTiming(take, [{ tokenIndex: 99, startMs: 0, endMs: 1 }])).toThrow(/越界/);
    expect(() => applyManualTiming(take, [{ tokenIndex: 0, startMs: 5, endMs: 5 }])).toThrow(/endMs 必须大于/);
    expect(() => applyManualTiming(take, [
      { tokenIndex: 1, startMs: 0, endMs: 10 },
      { tokenIndex: 1, startMs: 0, endMs: 20 },
    ])).toThrow(/重复校正/);
  });
});

describe('手动校时参与 reflow(组合②编译)', () => {
  it('校正窗直通 SFX 词锚落点(karaoke 同窗一致)', () => {
    const ir = mutated(m => {
      const sfx = m.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
      sfx.anchor = { kind: 'word', wordIndex: 10 };
      sfx.shotId = 'SHOT_003';
      sfx.missing = false;
    });
    const fixed = applyManualTiming(takeOf(), [{ tokenIndex: 10, startMs: 2150, endMs: 2230 }]);

    // 校正窗 → ② 词锚落点 2150(未校正会是字素比例 2615)
    const plan = compileAudioPlan(ir, { alignments: { 'aud-tts-001': fixed } });
    expect(plan.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(2150);

    // 同一 take 喂 karaoke:词窗与落点同源
    const cues = buildWordCues(fixed);
    expect(cues[10].startMs).toBe(2150);
    expect(cues[10].confidence).toBe(1);
  });
});
