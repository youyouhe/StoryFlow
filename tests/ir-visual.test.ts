import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, Shot } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import {
  compileVisualPlan,
  renderComfyMaterials,
  CONTINUITY_LOCK_LINE,
} from '../src/ir/visual/compile';
import { validateVisualCallPlan } from '../src/ir/visual/schema';
import { estimateVideoCostFen, videoPriceFen } from '../src/ir/visual/cost';
import { splitAnchorWords, fitShotDuration, chainSegments } from '../src/ir/shared';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { renderStoryFlowXML } from '../src/ir/format/render';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));

/** 深克隆 + 就地变异的夹具工厂(同 tests/ir-schema.test.ts 的 minimalIR 模式)。 */
const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

describe('compileVisualPlan — path dispatch', () => {
  it('pro doc dispatches one t2v job per shot', () => {
    const plan = compileVisualPlan(example());
    expect(plan.mode).toBe('pro');
    expect(plan.shots).toHaveLength(5);
    for (const shot of plan.shots) {
      expect(shot.jobs).toHaveLength(1);
      const job = shot.jobs[0];
      expect(job.kind).toBe('video');
      expect(job.kind === 'video' && job.path).toBe('t2v');
      expect(job.kind === 'video' && job.firstFrame).toBeUndefined();
    }
    // 整个计划可过运行时校验(P0 防漂移同款门禁)
    const v = validateVisualCallPlan(plan);
    // 本仓库 root tsconfig 不开 strictNullChecks——布尔判别联合不窄化,
    // 运行时已由 throw 保证是失败分支(同 tests/ir-schema.test.ts 备注)。
    if (!v.ok) throw new Error(`plan must validate:\n${(v as { issues: string[] }).issues.join('\n')}`);
  });

  it('express mode emits image + i2v pairs', () => {
    const plan = compileVisualPlan(mutated(ir => { ir.mode = 'express'; }));
    for (const shot of plan.shots) {
      expect(shot.jobs).toHaveLength(2);
      const [image, video] = shot.jobs;
      expect(image.kind).toBe('image');
      if (image.kind === 'image') expect(image.prompt.text).toBe(image.prompt.imagePrompt);
      expect(video.kind).toBe('video');
      if (video.kind !== 'video') return;
      expect(video.path).toBe('i2v');
      expect(video.firstFrame?.fromJobId).toBe(image.jobId);
    }
    expect(validateVisualCallPlan(plan).ok).toBe(true);
  });

  it('r2v only when whiteModelRef passed', () => {
    const r2v = compileVisualPlan(example(), { whiteModelRef: { durationSeconds: 6 } });
    expect(r2v.shots[0].jobs[0].kind === 'video' && r2v.shots[0].jobs[0].path).toBe('r2v');
    const t2v = compileVisualPlan(example());
    expect(t2v.shots[0].jobs[0].kind === 'video' && t2v.shots[0].jobs[0].path).toBe('t2v');
  });
});

describe('refSlots — unified <Picture N> packing', () => {
  it('refSlots are strict 1..N with env first (regression: no skipped Picture index)', () => {
    const plan = compileVisualPlan(example());
    const shot2 = plan.shots[1]; // SHOT_002: char+prop+scene+action 乱序绑定
    const slots = shot2.jobs[0].materials.slots;
    expect(slots.map(s => s.index)).toEqual([1, 2, 3, 4]);
    expect(slots.map(s => s.tag)).toEqual(['<Picture 1>', '<Picture 2>', '<Picture 3>', '<Picture 4>']);
    // scene/环境永远打头,角色次之,其余保持绑定序
    expect(slots.map(s => s.refId)).toEqual([
      'scene:照相馆', 'char:苏晚', 'prop:海鸥相机', 'action:擦拭相机',
    ]);
    // 身份关键槽 = 首个角色槽
    expect(shot2.jobs[0].materials.primaryRefSlot).toBe(2);
  });

  it('without an env sheet the first cast still gets <Picture 1> (historical gap fixed)', () => {
    const plan = compileVisualPlan(mutated(ir => {
      const shot = ir.shots[1] as Shot;
      shot.refBindings = shot.refBindings.filter(r => !r.startsWith('scene:'));
    }));
    const slots = plan.shots[1].jobs[0].materials.slots;
    expect(slots[0].refId).toBe('char:苏晚');
    expect(slots[0].tag).toBe('<Picture 1>');
    expect(slots.map(s => s.index)).toEqual([1, 2, 3]);
  });

  it('refSlots cap at 9 with REF_PACK_TRUNCATED', () => {
    const plan = compileVisualPlan(mutated(ir => {
      for (let i = 0; i < 10; i++) {
        ir.refs.props.push({ id: `prop:道具${i}`, name: `道具${i}`, description: 'x', asset: { assetId: `a${i}` } });
      }
      const shot = ir.shots[0] as Shot;
      shot.refBindings = [...ir.refs.props.map(p => p.id), 'scene:照相馆'];
    }));
    const slots = plan.shots[0].jobs[0].materials.slots;
    expect(slots).toHaveLength(9);
    expect(slots.map(s => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.warnings.some(w => w.code === 'REF_PACK_TRUNCATED')).toBe(true);
  });

  it('renderComfyMaterials tags match slot order and add <Video 1> only for r2v', () => {
    const plan = compileVisualPlan(example());
    const slots = plan.shots[0].jobs[0].materials.slots;
    const block = renderComfyMaterials(slots);
    const lines = block.split('\n').slice(1);
    expect(lines[0]).toContain('<Picture 1>');
    expect(lines[0]).toContain('scene/background reference');
    expect(block).not.toContain('<Video 1>');
    const withVideo = renderComfyMaterials(slots, { hasVideo: true });
    expect(withVideo.split('\n').at(-1)).toContain('<Video 1> is the white-model motion reference');
  });
});

describe('duration fit — ttsFloor, clamp, chain', () => {
  it('outputSeconds honors ttsFloor and clamps to [4, 15]', () => {
    // 地板抬升:5s 镜头 + 8s 对白 → 8s
    const raised = compileVisualPlan(mutated(ir => {
      const shot = ir.shots[2] as Shot;
      shot.shotDuration = 5;
      shot.dialogue = { text: shot.dialogue!.text, ttsFloor: 8 };
    }));
    const job = raised.shots[2].jobs[0];
    expect(job.kind === 'video' && job.outputSeconds).toBe(8);
    expect(raised.warnings.some(w => w.code === 'DIALOGUE_FLOOR_RAISES_DURATION' && w.shotId === 'SHOT_003')).toBe(true);
    // 超上限:20s 对白 → 钳 15 + AUDIO_TOO_LONG
    const over = compileVisualPlan(mutated(ir => {
      const shot = ir.shots[2] as Shot;
      shot.dialogue = { text: shot.dialogue!.text, ttsFloor: 20 };
    }));
    const overJob = over.shots[2].jobs[0];
    expect(overJob.kind === 'video' && overJob.outputSeconds).toBe(15);
    expect(over.warnings.some(w => w.code === 'AUDIO_TOO_LONG')).toBe(true);
    // 低于模型下限:2s 节拍 → 4s
    const short = compileVisualPlan(mutated(ir => {
      (ir.shots[0] as Shot).shotDuration = 2;
    }));
    const shortJob = short.shots[0].jobs[0];
    expect(shortJob.kind === 'video' && shortJob.outputSeconds).toBe(4);
  });

  it('shotDuration > 15 chains with equal-share offsets', () => {
    const plan = compileVisualPlan(mutated(ir => {
      (ir.shots[0] as Shot).shotDuration = 32;
    }));
    const shot = plan.shots[0];
    expect(shot.durationFit.chain.map(l => l.outputSeconds)).toEqual([11, 11, 10]);
    expect(shot.durationFit.chain.map(l => l.offsetSeconds)).toEqual([0, 11, 22]);
    expect(shot.jobs).toHaveLength(3);
    const jobs = shot.jobs.map(j => (j.kind === 'video' ? j.outputSeconds : 0));
    expect(jobs).toEqual([11, 11, 10]);
  });

  it('dialogue attaches to chain link 1 only', () => {
    const plan = compileVisualPlan(mutated(ir => {
      const shot = ir.shots[2] as Shot; // 有对白
      shot.shotDuration = 32;
    }));
    const jobs = plan.shots[2].jobs;
    expect(jobs).toHaveLength(3);
    expect(jobs[0].kind === 'video' && jobs[0].prompt.dialogue).toBe('拍一张证件照,要赶九点的火车。');
    expect(jobs[1].kind === 'video' && jobs[1].prompt.dialogue).toBeUndefined();
    expect(jobs[1].kind === 'video' && jobs[1].prompt.text).not.toContain('拍一张证件照');
    expect(jobs[0].kind === 'video' && jobs[0].prompt.text).toContain(CONTINUITY_LOCK_LINE);
  });
});

describe('seed policy and vendor passthrough', () => {
  it('seed fixed when present, reroll when absent', () => {
    const plan = compileVisualPlan(example());
    const withSeed = plan.shots[0].jobs[0].seed;      // SHOT_001 seed 10240001
    expect(withSeed).toEqual({ mode: 'fixed', value: 10240001 });
    const withoutSeed = plan.shots[2].jobs[0].seed;   // SHOT_003 无 seed
    expect(withoutSeed).toEqual({ mode: 'reroll' });
  });

  it('vendor bag passthrough is lossless', () => {
    const plan = compileVisualPlan(example());
    expect(plan.shots[2].jobs[0].vendor).toEqual({ model: 'h3', resolution: '768P' });
    expect(plan.shots[3].jobs[0].vendor).toEqual({ quality: 'high' });
  });
});

describe('cost — integer fen, minimax only', () => {
  it('estimatedCostFen is integer and only on minimax jobs', () => {
    const plan = compileVisualPlan(example());
    const costs = plan.shots.map(s => s.jobs[0].estimatedCostFen);
    // SHOT_001 comfyui / SHOT_002 comfyui / SHOT_003 minimax / SHOT_004 grok / SHOT_005 comfyui
    expect(costs[0]).toBeUndefined();
    expect(costs[2]).toBeGreaterThan(0);
    expect(Number.isInteger(costs[2])).toBe(true);
    expect(costs[3]).toBeUndefined();
    // 价目镜像自洽:6s 输出 × 50 分/s(H3 768P) = 300 分,3 张参考图在免费额内
    expect(costs[2]).toBe(300);
  });

  it('cost mirror matches the source price book in fen', () => {
    expect(videoPriceFen(undefined, '2K').outputPerSecFen).toBe(80);
    expect(videoPriceFen('MiniMax-Hailuo-02-Max', '480P').inputVideoPerSecFen).toBe(37);
    expect(estimateVideoCostFen({ outputSeconds: 10, imageCount: 7, resolution: '768P', model: 'h3' }))
      .toBe(10 * 50 + 0 + (7 - 5) * 20);
    expect(estimateVideoCostFen({ outputSeconds: 5, imageCount: 0, resolution: '768P', videoSeconds: 5 }))
      .toBe(5 * 50 + 5 * 50);
  });
});

describe('prompt composition and seam invariants', () => {
  it('anchorText is byte-identical to dialogue.text / motionPrompt', () => {
    const ir = example();
    const plan = compileVisualPlan(ir);
    const shot3 = plan.shots[2].jobs[0];
    expect(shot3.kind === 'video' && shot3.prompt.anchorText).toBe(ir.shots[2].dialogue!.text);
    expect(shot3.kind === 'video' && shot3.prompt.anchorSource).toBe('dialogue');
    const shot1 = plan.shots[0].jobs[0];
    expect(shot1.kind === 'video' && shot1.prompt.anchorText).toBe(ir.shots[0].motionPrompt);
    expect(shot1.kind === 'video' && shot1.prompt.anchorSource).toBe('motion');
    // 台词以引号逐字嵌入组装文本(可分词的基文本字段独立存在)
    expect(shot3.kind === 'video' && shot3.prompt.text).toContain('"拍一张证件照,要赶九点的火车。"');
    expect(shot3.kind === 'video' && shot3.prompt.text).toContain('陈默：');
  });

  it('preflight warnings: missing assetId, long imagePrompt', () => {
    const plan = compileVisualPlan(mutated(ir => {
      ir.refs.characters.push({ id: 'char:旁白者', name: '旁白者', description: '无设定表' });
      (ir.shots[0] as Shot).refBindings = ['char:旁白者', 'scene:照相馆'];
      (ir.shots[0] as Shot).imagePrompt = ir.style.promptPrefix + 'x'.repeat(1500);
    }));
    expect(plan.warnings.some(w => w.code === 'REF_ASSET_MISSING' && w.shotId === 'SHOT_001')).toBe(true);
    expect(plan.warnings.some(w => w.code === 'IMAGE_PROMPT_LONG' && w.shotId === 'SHOT_001')).toBe(true);
  });
});

describe('shared primitives', () => {
  it('splitAnchorWords: CJK per-char, latin per-run, punctuation never tokens', () => {
    expect(splitAnchorWords('渐暗,收黑!')).toEqual(['渐', '暗', '收', '黑']);
    expect(splitAnchorWords('OK || 2012 年')).toEqual(['OK', '2012', '年']);
    expect(splitAnchorWords('标点，不产 token。')).toEqual(['标', '点', '不', '产', 'token']);
  });

  it('fitShotDuration / chainSegments mirror the pinned rules', () => {
    expect(fitShotDuration(6, 4).chain).toEqual([
      { chainIndex: 1, chainCount: 1, outputSeconds: 6, offsetSeconds: 0 },
    ]);
    expect(fitShotDuration(32).chain.map(l => l.outputSeconds)).toEqual([11, 11, 10]);
    expect(chainSegments(16).map(l => l.outputSeconds)).toEqual([8, 8]);
  });
});

describe('P1-② / P1-③ boundary stubs', () => {
  it('compileAudioPlan stub is typed and throws', () => {
    expect(() => compileAudioPlan(example())).toThrow(/P1-② not implemented/);
  });

  it('renderStoryFlowXML stub is typed and throws', () => {
    expect(() => renderStoryFlowXML(example())).toThrow(/P1-③ not implemented/);
  });
});
