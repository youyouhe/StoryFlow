import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, Shot, SfxClip, TtsClip, BgmClip } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileAudioPlan, splitForTts, GLM_TTS_MAX_INPUT } from '../src/ir/audio/compile';
import { validateAudioMixPlan } from '../src/ir/audio/schema';
import { MIX_GAIN_TTS, MIX_GAIN_BGM, MIX_GAIN_SFX } from '../src/ir/audio/types';
import { fitShotDuration, splitAnchorWords } from '../src/ir/shared';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));

const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

describe('compileAudioPlan — three-track jobs', () => {
  it('银盐晨光 emits the three-track job set with pinned execution gains', () => {
    const plan = compileAudioPlan(example());
    expect(plan.jobs).toHaveLength(5);
    const tts = plan.jobs.filter(j => j.kind === 'tts');
    const bgm = plan.jobs.filter(j => j.kind === 'bgm');
    const sfx = plan.jobs.filter(j => j.kind === 'sfx');
    expect(tts).toHaveLength(2);
    expect(bgm).toHaveLength(1);
    expect(sfx).toHaveLength(2);

    const first = tts[0];
    expect(first.kind === 'tts' && first.parts).toEqual(['拍一张证件照,要赶九点的火车。']);
    expect(first.kind === 'tts' && first.voice).toBe('jam');
    expect(first.kind === 'tts' && first.character).toBe('陈默');
    expect(bgm[0].kind === 'bgm' && bgm[0].gain).toBe(MIX_GAIN_BGM);
    expect(sfx[1].kind === 'sfx' && sfx[1].anchor).toEqual({ kind: 'word', wordIndex: 29 });
  });

  it('TtsJob.parts splits at punctuation within the 1024-char cap', () => {
    const long = '好。'.repeat(800); // 1600 字符,远超上限
    const parts = splitForTts(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(GLM_TTS_MAX_INPUT);
    expect(parts.join('')).toBe(long);
    // 标点跟句:每个分段以句号收尾(除尾段)
    for (const p of parts.slice(0, -1)) expect(p.endsWith('。')).toBe(true);
  });

  it('anchor clip must match dialogue.text verbatim (TTS_ANCHOR_UNMATCHED)', () => {
    const plan = compileAudioPlan(mutated(ir => {
      const clip = ir.audio.find(c => c.id === 'aud-tts-001') as TtsClip;
      clip.text = '拍一张证件照,要赶九点的火车!'; // 逐字漂移 → 锚丢失
    }));
    expect(plan.warnings.some(w => w.code === 'TTS_ANCHOR_UNMATCHED' && w.shotId === 'SHOT_003')).toBe(true);
    // 零 clip = 尚未合成的常态,不警告
    const bare = compileAudioPlan(mutated(ir => {
      ir.audio = ir.audio.filter(c => c.kind !== 'tts');
    }));
    expect(bare.warnings.some(w => w.code === 'TTS_ANCHOR_UNMATCHED')).toBe(false);
  });
});

describe('word anchors → timeline (词级锚定→时间轴)', () => {
  it('motion-anchored word sfx derives ms by grapheme proportion over planned duration', () => {
    // SHOT_005 无对白:基文本 = motionPrompt(31 token),basis = wantSeconds 4s
    const plan = compileAudioPlan(example());
    const tokens = splitAnchorWords(example().shots[4].motionPrompt);
    expect(tokens).toHaveLength(31);
    const entry = plan.timeline.find(e => e.clipId === 'aud-sfx-002');
    expect(entry?.startMs).toBe(Math.round((29 / 31) * 4000)); // 3742
  });

  it('dialogue-anchored word sfx uses probed measured as basis (opts.measured wins over IR)', () => {
    const withAnchor = mutated(ir => {
      const sfx = ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
      sfx.anchor = { kind: 'word', wordIndex: 10 }; // 「拍一张证件照,要赶九点的火车。」第 10 token
      sfx.shotId = 'SHOT_003';
    });
    // 锚 clip aud-tts-001 的 measuredSeconds=3.4(3400ms);token 10/13
    const plan = compileAudioPlan(withAnchor);
    const entry = plan.timeline.find(e => e.clipId === 'aud-sfx-001');
    expect(entry?.startMs).toBe(Math.round((10 / 13) * 3400)); // 2615
    // IO 边缘新探活值覆盖 IR 回填旧值
    const plan2 = compileAudioPlan(withAnchor, { measured: { 'aud-tts-001': 2.0 } });
    expect(plan2.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs)
      .toBe(Math.round((10 / 13) * 2000)); // 1538
  });

  it('shot-start anchors at 0 and shot-end at the shot content end', () => {
    const plan = compileAudioPlan(example());
    expect(plan.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(0);
    const endAnchored = compileAudioPlan(mutated(ir => {
      const sfx = ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
      sfx.anchor = { kind: 'shot-end' };
    }));
    expect(endAnchored.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(6000);
  });

  it('TTS stem offsets are cumulative over the shot (muxSegment concat semantics)', () => {
    const plan = compileAudioPlan(mutated(ir => {
      ir.audio.push({
        id: 'aud-tts-003', kind: 'tts', shotId: 'SHOT_003',
        text: '再拍一张。', voice: 'jam', measuredSeconds: 1.5,
      });
    }));
    const stem = plan.timeline.filter(e => e.clipId === 'aud-tts-001' || e.clipId === 'aud-tts-003');
    expect(stem.map(e => [e.startMs, e.durationMs])).toEqual([[0, 3400], [3400, 1500]]);
  });

  it('missing measurement keeps a TTS clip out of the timeline', () => {
    const plan = compileAudioPlan(mutated(ir => {
      const clip = ir.audio.find(c => c.id === 'aud-tts-002') as TtsClip;
      delete clip.measuredSeconds;
    }));
    expect(plan.timeline.some(e => e.clipId === 'aud-tts-002')).toBe(false);
    expect(plan.timeline.some(e => e.clipId === 'aud-tts-001')).toBe(true);
  });
});

describe('mix plan — ProSegmentCut declared (muxSegment 契约)', () => {
  it('mix gains are pinned to the contract; IR gain overrides ignored in v1', () => {
    const plan = compileAudioPlan(mutated(ir => {
      (ir.audio.find(c => c.id === 'aud-tts-001') as TtsClip).gain = 0.5;
      (ir.audio.find(c => c.id === 'aud-bgm-001') as BgmClip).gain = 0.9;
      (ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip).gain = 0.1;
    }));
    for (const seg of plan.mix) {
      for (const t of seg.tts) expect(t.gain).toBe(MIX_GAIN_TTS);
      if (seg.bgm) expect(seg.bgm).toMatchObject({ gain: MIX_GAIN_BGM, loop: true });
      for (const s of seg.sfx) expect(s.gain).toBe(MIX_GAIN_SFX);
    }
    expect(validateAudioMixPlan(plan).ok).toBe(true);
  });

  it('bgm bed covers fromShotId..toShotId (absent toShotId = through end)', () => {
    const plan = compileAudioPlan(example());
    expect(plan.mix).toHaveLength(5);
    for (const seg of plan.mix) expect(seg.bgm?.clipId).toBe('aud-bgm-001');
    const capped = compileAudioPlan(mutated(ir => {
      (ir.audio.find(c => c.id === 'aud-bgm-001') as BgmClip).toShotId = 'SHOT_003';
    }));
    const withBgm = capped.mix.filter(s => s.bgm).map(s => s.shotId);
    expect(withBgm).toEqual(['SHOT_001', 'SHOT_002', 'SHOT_003']);
  });

  it('sfx atMs matches the timeline derivation', () => {
    const plan = compileAudioPlan(example());
    const seg = plan.mix.find(s => s.shotId === 'SHOT_005');
    expect(seg?.sfx).toEqual([{ clipId: 'aud-sfx-002', atMs: 3742, gain: MIX_GAIN_SFX }]);
  });

  it('fits mirror shared.fitShotDuration (ttsFloor seam)', () => {
    const plan = compileAudioPlan(example());
    expect(plan.fits).toHaveLength(5);
    expect(plan.fits[2].durationFit).toEqual(fitShotDuration(6, 4));
  });
});

describe('warnings', () => {
  it('AUDIO_TOO_LONG when ttsFloor exceeds the model window', () => {
    const plan = compileAudioPlan(mutated(ir => {
      (ir.shots[2] as Shot).dialogue = { text: ir.shots[2].dialogue!.text, ttsFloor: 20 };
    }));
    expect(plan.warnings.some(w => w.code === 'AUDIO_TOO_LONG' && w.shotId === 'SHOT_003')).toBe(true);
  });

  it('SFX_MISSING preserved as a placeholder (not silently dropped)', () => {
    const plan = compileAudioPlan(example());
    expect(plan.warnings.some(w => w.code === 'SFX_MISSING' && w.shotId === 'SHOT_005')).toBe(true);
  });

  it('SFX_ANCHOR_OUT_OF_RANGE leaves the clip unplaced', () => {
    const plan = compileAudioPlan(mutated(ir => {
      (ir.audio.find(c => c.id === 'aud-sfx-002') as SfxClip).anchor = { kind: 'word', wordIndex: 99 };
    }));
    expect(plan.warnings.some(w => w.code === 'SFX_ANCHOR_OUT_OF_RANGE')).toBe(true);
    expect(plan.timeline.some(e => e.clipId === 'aud-sfx-002')).toBe(false);
  });

  it('plan validates against the audio schema', () => {
    const v = validateAudioMixPlan(compileAudioPlan(example()));
    if (!v.ok) throw new Error(`plan must validate:\n${(v as { issues: string[] }).issues.join('\n')}`);
  });
});
