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

describe('P5 词级对齐 — 对齐窗优先与 reflow', () => {
  const LINE = '拍一张证件照,要赶九点的火车。';
  const withWordSfx = mutated(ir => {
    const sfx = ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
    sfx.anchor = { kind: 'word', wordIndex: 10 };
    sfx.shotId = 'SHOT_003';
    sfx.missing = false;
  });

  it('aligned windows win over proportional (stemOffset + startMs)', () => {
    const plan = compileAudioPlan(withWordSfx, {
      alignments: {
        'aud-tts-001': {
          text: LINE, clipId: 'aud-tts-001', durationMs: 3400,
          tokens: [{ tokenIndex: 10, text: '的', startMs: 2600, endMs: 2680 }],
        },
      },
    });
    // 对齐窗 2600(字素比例会是 2615——对齐优先)
    expect(plan.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(2600);
    expect(plan.warnings.some(w => w.code === 'ALIGNMENT_UNUSABLE')).toBe(false);
  });

  it('stale text fingerprint falls back to proportional with ALIGNMENT_UNUSABLE', () => {
    const plan = compileAudioPlan(withWordSfx, {
      alignments: {
        'aud-tts-001': {
          text: '旧台词(改词前)', clipId: 'aud-tts-001', durationMs: 3400,
          tokens: [{ tokenIndex: 10, startMs: 2600, endMs: 2680 }],
        },
      },
    });
    expect(plan.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs)
      .toBe(Math.round((10 / 13) * 3400)); // 字素回退 2615
    expect(plan.warnings.some(w => w.code === 'ALIGNMENT_UNUSABLE' && /stale/.test(w.message))).toBe(true);
  });

  it('missing token falls back too (不静默降级)', () => {
    const plan = compileAudioPlan(withWordSfx, {
      alignments: {
        'aud-tts-001': {
          text: LINE, clipId: 'aud-tts-001', durationMs: 3400,
          tokens: [{ tokenIndex: 11, startMs: 2800, endMs: 2900 }], // 无 token 10
        },
      },
    });
    expect(plan.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs)
      .toBe(Math.round((10 / 13) * 3400));
    expect(plan.warnings.some(w => w.code === 'ALIGNMENT_UNUSABLE' && /token 10/.test(w.message))).toBe(true);
  });

  it('reflow: 改词→旧对齐失效回退→重对齐窗口生效(无手工重排)', () => {
    const anchorAt0 = mutated(ir => {
      const sfx = ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
      sfx.anchor = { kind: 'word', wordIndex: 0 };
      sfx.shotId = 'SHOT_003';
      sfx.missing = false;
    });
    const take1 = {
      text: LINE, clipId: 'aud-tts-001', durationMs: 3400,
      tokens: [{ tokenIndex: 0, startMs: 100, endMs: 250 }],
    };
    const v1 = compileAudioPlan(anchorAt0, { alignments: { 'aud-tts-001': take1 } });
    expect(v1.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(100);

    // 改词(十点)——对白与 TtsClip 同步改,锚基文本漂移
    const LINE2 = '拍一张证件照,要赶十点的火车。';
    const edited = mutated(ir => {
      const sfx = ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
      sfx.anchor = { kind: 'word', wordIndex: 0 };
      sfx.shotId = 'SHOT_003';
      sfx.missing = false;
      (ir.shots[2] as Shot).dialogue = { text: LINE2, ttsFloor: 4 };
      (ir.audio.find(c => c.id === 'aud-tts-001') as TtsClip).text = LINE2;
    });
    const v2 = compileAudioPlan(edited, { alignments: { 'aud-tts-001': take1 } });
    expect(v2.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(0); // 字素接管(word 0)
    expect(v2.warnings.some(w => w.code === 'ALIGNMENT_UNUSABLE')).toBe(true);

    // 重对齐后窗口生效
    const take2 = {
      text: LINE2, clipId: 'aud-tts-001', durationMs: 3400,
      tokens: [{ tokenIndex: 0, startMs: 55, endMs: 200 }],
    };
    const v3 = compileAudioPlan(edited, { alignments: { 'aud-tts-001': take2 } });
    expect(v3.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(55);
    expect(v3.warnings.some(w => w.code === 'ALIGNMENT_UNUSABLE')).toBe(false);
  });

  it('对齐窗叠在拼杆偏移上(锚 clip 非首段)', () => {
    const reordered = mutated(ir => {
      const sfx = ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
      sfx.anchor = { kind: 'word', wordIndex: 10 };
      sfx.shotId = 'SHOT_003';
      sfx.missing = false;
      ir.audio.unshift({
        id: 'aud-tts-009', kind: 'tts', shotId: 'SHOT_003', text: '先来一句。',
        voice: 'jam', measuredSeconds: 1.5,
      } as TtsClip);
    });
    const plan = compileAudioPlan(reordered, {
      alignments: {
        'aud-tts-001': {
          text: LINE, clipId: 'aud-tts-001', durationMs: 3400,
          tokens: [{ tokenIndex: 10, startMs: 2600, endMs: 2680 }],
        },
      },
    });
    // 拼杆偏移 1500(前置句)+ 对齐窗 2600
    expect(plan.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(4100);
  });
});
