import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, SfxClip, TtsClip } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileAudioPlan } from '../src/ir/audio/compile';
import type { AudioMixPlan } from '../src/ir/audio/types';
import {
  mapAudioPlanToTtsQueue,
  mapAudioPlanToSfxQueue,
  mapAudioPlanToBgmQueue,
  mapMixToProSegmentCuts,
} from '../src/bridge/audio';
import type { MixCallRuntime } from '../src/bridge/types';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));

const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

const planOf = (ir: StoryFlowIR = example()): AudioMixPlan => compileAudioPlan(ir);

const mixRt = (over: Partial<MixCallRuntime> = {}): MixCallRuntime => ({
  videoUrlOf: shotId => `video://${shotId}.mp4`,
  keyOf: clipId => `key:${clipId}`,
  blobOf: clipId => new Blob([clipId]),
  bgmUrlOf: clipId => `bgm://${clipId}.m4a`,
  ...over,
});

describe('mapAudioPlanToTtsQueue — 逐 part 合成任务', () => {
  it('emits one call per ≤1024 part with voice/speed/watermarkEnabled mapped', () => {
    const calls = mapAudioPlanToTtsQueue(planOf(), { apiKey: 'k' });
    expect(calls).toHaveLength(2); // 2 台词 × 各 1 part
    expect(calls.map(c => [c.clipId, c.partIndex])).toEqual([
      ['aud-tts-001', 0],
      ['aud-tts-002', 0],
    ]);
    expect(calls[0].apiKey).toBe('k');
    expect(calls[0].input).toBe('拍一张证件照,要赶九点的火车。');
    // IR watermark:false → 适配器参数名 watermarkEnabled
    expect(calls[0].opts).toEqual({ voice: 'jam', speed: 1, watermarkEnabled: false });
    expect(calls[1].opts).toEqual({ voice: 'tongtong', speed: 0.9 });
  });

  it('long lines fan out per part with ascending partIndex (queue order)', () => {
    const plan = planOf(mutated(ir => {
      const clip = ir.audio.find(c => c.id === 'aud-tts-001') as TtsClip;
      clip.text = '好。'.repeat(800);
    }));
    const calls = mapAudioPlanToTtsQueue(plan, { apiKey: 'k' }).filter(c => c.clipId === 'aud-tts-001');
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.map(c => c.partIndex)).toEqual(calls.map((_, i) => i));
    expect(calls.map(c => c.input).join('')).toBe('好。'.repeat(800));
  });
});

describe('mapAudioPlanToSfxQueue / BgmQueue — 查表与请求队列', () => {
  it('sfx queue: one resolveSfx lookup per clip (missing 也入列,幂等探测)', () => {
    const calls = mapAudioPlanToSfxQueue(planOf());
    expect(calls).toEqual([
      { clipId: 'aud-sfx-001', name: 'ding' },
      { clipId: 'aud-sfx-002', name: 'shutter' }, // missing:true 同样入列
    ]);
  });

  it('bgm queue: one requestMusic per bed with the built prompt', () => {
    const calls = mapAudioPlanToBgmQueue(planOf(), { falKey: 'fk' });
    expect(calls).toHaveLength(1);
    expect(calls[0].clipId).toBe('aud-bgm-001');
    expect(calls[0].falKey).toBe('fk');
    expect(calls[0].prompt).toContain('photo studio at dawn');
  });
});

describe('mapMixToProSegmentCuts — ProSegmentCut 字段映射', () => {
  it('maps segKey/videoUrl/ttsKeys 键序/bgmUrl/sfx atMs', () => {
    const cuts = mapMixToProSegmentCuts(planOf(), mixRt());
    expect(cuts.map(c => c.segKey)).toEqual(['SHOT_001', 'SHOT_002', 'SHOT_003', 'SHOT_004', 'SHOT_005']);
    const cut3 = cuts[2];
    expect(cut3.videoUrl).toBe('video://SHOT_003.mp4');
    expect(cut3.ttsKeys).toEqual(['key:aud-tts-001']); // 按 mix.tts 序(说话序)
    expect(cut3.bgmUrl).toBe('bgm://aud-bgm-001.m4a');
    expect(cut3.sfx?.[0].atMs).toBe(0); // shot-start → 0ms
    const cut5 = cuts[4];
    expect(cut5.sfx?.[0].atMs).toBe(3742); // 词锚 29/31 × 4s
    expect(cut5.sfx?.[0].blob).toBeInstanceOf(Blob);
    // 无音轨字段省略
    expect(cuts[0].ttsKeys).toBeUndefined();
  });

  it('unresolvable sfx are filtered out of the cut (live exportCut parity)', () => {
    const cuts = mapMixToProSegmentCuts(planOf(), mixRt({
      blobOf: clipId => (clipId === 'aud-sfx-002' ? undefined : new Blob([clipId])),
    }));
    expect(cuts[4].sfx).toBeUndefined(); // shutter(SFX_MISSING)不出 cut
    expect(cuts[2].sfx?.[0].atMs).toBe(0); // 可解算的照常出
  });

  it('multi-tts shots keep stem order in ttsKeys', () => {
    const plan = planOf(mutated(ir => {
      ir.audio.push({
        id: 'aud-tts-003', kind: 'tts', shotId: 'SHOT_003',
        text: '再拍一张。', voice: 'jam',
      } as TtsClip);
    }));
    const cut3 = mapMixToProSegmentCuts(plan, mixRt())[2];
    expect(cut3.ttsKeys).toEqual(['key:aud-tts-001', 'key:aud-tts-003']);
  });
});
