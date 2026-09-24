import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, Shot } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileVisualPlan } from '../src/ir/visual/compile';
import type { VisualCallPlan, ImageJob, VideoJob } from '../src/ir/visual/types';
import {
  mapImageJobToGenerateImages,
  mapVideoJobToH3,
  mapVideoJobToComfy,
  mapVideoCall,
  planCallSequence,
} from '../src/bridge/visual';
import type { ResolvedRef, ImageCallRuntime, H3CallRuntime, ComfyCallRuntime } from '../src/bridge/types';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));

const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

const proPlan = (): VisualCallPlan => compileVisualPlan(example());
const expressPlan = (): VisualCallPlan =>
  compileVisualPlan(mutated(ir => { ir.mode = 'express'; }));

/** 全注册表假 Blob 解算(mock 注入,零网络)。 */
const allRefs = (plan: VisualCallPlan): ResolvedRef[] => {
  const seen = new Map<string, ResolvedRef>();
  for (const shot of plan.shots) {
    for (const job of shot.jobs) {
      for (const s of job.materials.slots) {
        if (!seen.has(s.refId)) {
          seen.set(s.refId, { refId: s.refId, name: s.name, blob: new Blob([s.refId]) });
        }
      }
    }
  }
  return [...seen.values()];
};

const imageRt = (plan: VisualCallPlan, over: Partial<ImageCallRuntime> = {}): ImageCallRuntime => ({
  provider: 'minimax',
  apiKey: 'k',
  baseUrl: 'https://api.test',
  refs: allRefs(plan),
  ...over,
});

const h3Rt = (plan: VisualCallPlan, over: Partial<H3CallRuntime> = {}): H3CallRuntime => ({
  apiKey: 'k',
  baseUrl: 'https://api.test',
  refs: allRefs(plan),
  ...over,
});

const comfyRt = (plan: VisualCallPlan, over: Partial<ComfyCallRuntime> = {}): ComfyCallRuntime => ({
  serverUrl: 'https://comfy.test',
  graphJson: '{"a": {"class_type": "x", "inputs": {}}}',
  uploadedRefNames: allRefs(plan).map(r => ({ refId: r.refId, name: `up-${r.refId}.png` })),
  ...over,
});

const imageJobOf = (plan: VisualCallPlan, shotId: string): ImageJob => {
  const job = plan.shots.find(s => s.shotId === shotId)!.jobs[0];
  if (job.kind !== 'image') throw new Error('want image job');
  return job;
};

const videoJobsOf = (plan: VisualCallPlan, shotId: string): VideoJob[] =>
  plan.shots.find(s => s.shotId === shotId)!.jobs.filter((j): j is VideoJob => j.kind === 'video');

describe('mapImageJobToGenerateImages — per-provider 参考打包', () => {
  it('minimax locks the primary identity sheet only', () => {
    const plan = expressPlan();
    const refs = allRefs(plan);
    const job = imageJobOf(plan, 'SHOT_002'); // slots: scene(1) 苏晚(2) prop(3) action(4)
    const call = mapImageJobToGenerateImages(job, imageRt(plan, { refs }));
    expect(call.kind).toBe('images');
    expect(call.prompt).toBe(job.prompt.text);
    expect(call.opts.n).toBe(1);
    expect(call.opts.aspectRatio).toBe('16:9');
    // 单 subject_reference = primaryRefSlot(苏晚);无 landscape 槽(记档不对称)
    const primary = job.materials.slots.find(s => s.index === job.materials.primaryRefSlot)!;
    expect(call.opts.subjectReference?.size).toBeGreaterThan(0);
    expect(call.opts.subjectReference).toBe(refs.find(r => r.refId === primary.refId)!.blob);
    expect(call.opts.references).toBeUndefined();
    expect(call.cfg.provider).toBe('minimax');
  });

  it('fal packs characters + landscape', () => {
    const plan = expressPlan();
    const refs = allRefs(plan);
    const job = imageJobOf(plan, 'SHOT_002');
    const call = mapImageJobToGenerateImages(job, imageRt(plan, { provider: 'fal', falKey: 'fk', refs }));
    expect(call.opts.subjectReference).toBeUndefined();
    expect(call.opts.references?.characters).toHaveLength(1); // 仅角色槽
    expect(call.opts.references?.landscape).toBe(refs.find(r => r.refId === 'scene:照相馆')!.blob);
    expect(call.cfg.falKey).toBe('fk');
  });
});

describe('mapVideoJobToH3 — H3SubmitParams 字段映射', () => {
  it('maps prompt without materials tags, ref names, resolution/model/outputSeconds', () => {
    const plan = proPlan();
    const job = videoJobsOf(plan, 'SHOT_003')[0]; // minimax + vendor {model:'h3', resolution:'768P'}
    const call = mapVideoJobToH3(job, h3Rt(plan));
    expect(call.kind).toBe('h3');
    expect(call.params.prompt).toBe(job.prompt.text);
    expect(call.params.prompt).not.toContain('Reference materials'); // 材料块是 comfy 方言
    expect(call.params.referenceImages.map(r => r.name)).toEqual(['ref-1', 'ref-2', 'ref-3']);
    expect(call.params.resolution).toBe('768P');
    expect(call.params.model).toBe('h3');
    expect(call.params.outputSeconds).toBe(6);
    expect(call.params.videoSeconds).toBe(0);
    expect(call.params.videoBlob).toBeUndefined();
  });

  it('r2v carries the white-model video and fileUri', () => {
    const plan = compileVisualPlan(example(), { whiteModelRef: { durationSeconds: 6 } });
    const job = videoJobsOf(plan, 'SHOT_003')[0];
    expect(job.path).toBe('r2v');
    const blob = new Blob(['wm']);
    const call = mapVideoJobToH3(job, h3Rt(plan, { whiteModel: { blob, seconds: 6, fileUri: 'uri-1' } }));
    expect(call.params.videoBlob).toBe(blob);
    expect(call.params.videoSeconds).toBe(6);
    expect(call.videoFileUri).toBe('uri-1');
  });

  it('invalid vendor resolution is rejected, not clamped', () => {
    const plan = proPlan();
    const job = videoJobsOf(plan, 'SHOT_003')[0];
    const bad = { ...job, vendor: { resolution: '4K' } } as VideoJob;
    expect(() => mapVideoJobToH3(bad, h3Rt(plan))).toThrow(/4K/);
  });
});

describe('mapVideoJobToComfy — 拼包与 seed 近似', () => {
  it('i2v sets firstFrameName + durationSeconds and approximates fixed seed', () => {
    const plan = expressPlan();
    const job = videoJobsOf(plan, 'SHOT_001')[0]; // SHOT_001 seed 固定 10240001
    const call = mapVideoJobToComfy(job, comfyRt(plan, { uploadedFirstFrameName: 'frame.png' }));
    expect(call.kind).toBe('comfy');
    expect(call.patch.firstFrameName).toBe('frame.png');
    expect(call.patch.durationSeconds).toBe(6);
    expect(call.patch.randomizeSeed).toBe(false); // fixed → 不随机
    expect(call.patch.prompt).toContain('Reference materials');
    expect(call.patch.prompt).toContain('<Picture 1>');
  });

  it('reroll jobs randomize the seed; i2v without first frame is rejected', () => {
    const plan = expressPlan();
    const rerollJob = videoJobsOf(plan, 'SHOT_003')[0]; // 无 seed → reroll
    const call = mapVideoJobToComfy(rerollJob, comfyRt(plan, { uploadedFirstFrameName: 'f.png' }));
    expect(call.patch.randomizeSeed).toBe(true);
    expect(() => mapVideoJobToComfy(rerollJob, comfyRt(plan))).toThrow(/uploadedFirstFrameName/);
  });

  it('t2v sets refImageNames; empty pack strips the first-frame node', () => {
    const plan = proPlan();
    const job = videoJobsOf(plan, 'SHOT_003')[0];
    const call = mapVideoJobToComfy(job, comfyRt(plan));
    expect(call.patch.refImageNames).toEqual(['up-scene:照相馆.png', 'up-char:陈默.png', 'up-char:苏晚.png']);
    expect(call.patch.stripFirstFrame).toBeUndefined();

    const empty = compileVisualPlan(mutated(ir => {
      (ir.shots[0] as Shot).refBindings = [];
    }));
    const bare = videoJobsOf(empty, 'SHOT_001')[0];
    const bareCall = mapVideoJobToComfy(bare, comfyRt(empty, { uploadedRefNames: [] }));
    expect(bareCall.patch.stripFirstFrame).toBe(true);
    expect(bareCall.patch.refImageNames).toBeUndefined();
    expect(bareCall.patch.prompt).not.toContain('Reference materials');
  });

  it('r2v tags <Video 1> and sets refVideoNames', () => {
    const plan = compileVisualPlan(example(), { whiteModelRef: { durationSeconds: 6 } });
    const job = videoJobsOf(plan, 'SHOT_001')[0];
    const call = mapVideoJobToComfy(job, comfyRt(plan, { uploadedVideoName: 'wm.mp4' }));
    expect(call.patch.refVideoNames).toEqual(['wm.mp4']);
    expect(call.patch.prompt).toContain('<Video 1> is the white-model motion reference');
    expect(() => mapVideoJobToComfy(job, comfyRt(plan))).toThrow(/uploadedVideoName/);
  });
});

describe('分派与时序', () => {
  it('mapVideoCall dispatches by backend and rejects grok', () => {
    const plan = proPlan();
    const minimaxJob = videoJobsOf(plan, 'SHOT_003')[0];
    expect(mapVideoCall(minimaxJob, { h3: h3Rt(plan) }).kind).toBe('h3');
    const comfyJob = videoJobsOf(plan, 'SHOT_001')[0];
    expect(mapVideoCall(comfyJob, { comfy: comfyRt(plan) }).kind).toBe('comfy');
    const grokJob = videoJobsOf(plan, 'SHOT_004')[0]; // backend: grok
    expect(() => mapVideoCall(grokJob, { h3: h3Rt(plan) })).toThrow(/grok/);
  });

  it('planCallSequence: express i2v depends on its image job; chain links are independent', () => {
    const plan = expressPlan();
    const steps = planCallSequence(plan);
    const [imageJob, i2vJob] = plan.shots[0].jobs;
    const image = steps.find(s => s.jobId === imageJob.jobId)!;
    const i2v = steps.find(s => s.jobId === i2vJob.jobId)!;
    expect(image.call).toBe('generateImages');
    expect(image.needs).toEqual([]);
    expect(i2v.needs).toEqual([imageJob.jobId]); // firstFrame.fromJobId

    const chained = compileVisualPlan(mutated(ir => {
      (ir.shots[0] as Shot).shotDuration = 32;
    }));
    const chainIds = new Set(chained.shots[0].jobs.map(j => j.jobId));
    const chainSteps = planCallSequence(chained).filter(s => chainIds.has(s.jobId));
    expect(chainSteps).toHaveLength(3);
    for (const s of chainSteps) expect(s.needs).toEqual([]);

    const grokStep = planCallSequence(proPlan()).find(s => s.call === 'unsupported')!;
    expect(grokStep.reason).toMatch(/grok/);
  });
});
