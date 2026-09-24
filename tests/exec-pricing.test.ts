import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, Shot } from '../src/ir/types';
import type { TtsJob } from '../src/ir/audio/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileVisualPlan } from '../src/ir/visual/compile';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { planCostReport } from '../src/exec/budget';
import {
  audioCostReport, settleVisualRun, settleAudioRun,
} from '../src/exec/pricing';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};
const proPlan = () => compileVisualPlan(example());
const expressPlan = () => compileVisualPlan(mutated(ir => { ir.mode = 'express'; }));

describe('planCostReport — 图条目计价销掉 unpriced(books 输入制)', () => {
  it('无 books:行为不变(image unpriced)', () => {
    const report = planCostReport(expressPlan());
    expect(report.totalCostFen).toBe(300); // 仅 SHOT_003 minimax 视频
    expect(report.unpricedJobIds).toHaveLength(9); // 5 image + 4 comfy
  });

  it('给图价目:image 入价,unpriced 收窄到无刊例视频', () => {
    const report = planCostReport(expressPlan(), { image: { perImageFen: 20 } });
    expect(report.totalCostFen).toBe(300 + 5 * 20); // 视频刊例 + 5 张图
    expect(report.unpricedJobIds).toHaveLength(4); // 只剩 comfy 视频
    const img = report.byJob.filter(j => j.estimatedCostFen === 20);
    expect(img).toHaveLength(5);
  });
});

describe('audioCostReport — 音频三轨计价(SFX 恒 0 非 unpriced)', () => {
  it('给 tts/bgm 价目:按字符与按次计,SFX 显式 0', () => {
    const plan = compileAudioPlan(example());
    const tts1 = plan.jobs.find(j => j.kind === 'tts' && j.clipId === 'aud-tts-001') as TtsJob;
    const tts2 = plan.jobs.find(j => j.kind === 'tts' && j.clipId === 'aud-tts-002') as TtsJob;
    const report = audioCostReport(plan, {
      tts: { perCharFen: 2 },
      bgm: { perRequestFen: 50 },
    });
    const byId = new Map(report.byClip.map(c => [c.clipId, c]));
    expect(byId.get('aud-tts-001')?.costFen).toBe(tts1.text.length * 2);
    expect(byId.get('aud-tts-002')?.costFen).toBe(tts2.text.length * 2);
    expect(byId.get('aud-bgm-001')).toMatchObject({ costFen: 50, priced: true });
    expect(byId.get('aud-sfx-001')).toMatchObject({ costFen: 0, priced: true }); // 本地免费≠unpriced
    expect(report.unpricedClipIds).toEqual([]);
  });

  it('无价目:tts/bgm 回退 unpriced,SFX 仍显式 0', () => {
    const report = audioCostReport(compileAudioPlan(example()));
    expect(report.unpricedClipIds.sort()).toEqual(['aud-bgm-001', 'aud-tts-001', 'aud-tts-002']);
    const sfx = report.byClip.filter(c => c.kind === 'sfx');
    expect(sfx.every(c => c.costFen === 0 && c.priced)).toBe(true);
  });
});

describe('settleVisualRun — 精确结算(按实际产出)', () => {
  it('全成功 → 全计;SHOT_003 失败 → 视觉 0', () => {
    const plan = proPlan();
    const okResult = {
      results: plan.shots.flatMap(s => s.jobs.map(j => ({
        jobId: j.jobId, shotId: j.shotId, status: 'succeeded' as const,
      }))),
    };
    expect(settleVisualRun(plan, okResult).chargedCostFen).toBe(300);

    const targetJob = plan.shots[2].jobs[0].jobId; // SHOT_003 minimax
    const failResult = {
      results: plan.shots.flatMap(s => s.jobs.map(j => ({
        jobId: j.jobId, shotId: j.shotId,
        status: j.jobId === targetJob ? ('failed' as const) : ('succeeded' as const),
      }))),
    };
    const settled = settleVisualRun(plan, failResult);
    expect(settled.chargedCostFen).toBe(0); // 按实际产出:唯一计价任务失败 → 0
    expect(settled.settled.find(s => s.jobId === targetJob)).toMatchObject({
      status: 'failed', costFen: 0,
    });
  });

  it('timeout/skipped 不计;图任务按 books 计', () => {
    const plan = expressPlan();
    const [img1, vid1] = plan.shots[0].jobs;
    const result = {
      results: plan.shots.flatMap(s => s.jobs.map(j => ({
        jobId: j.jobId, shotId: j.shotId,
        status: j.jobId === vid1.jobId ? ('timeout' as const)
          : j.jobId === plan.shots[3].jobs[1].jobId ? ('skipped' as const) // grok
            : ('succeeded' as const),
      }))),
    };
    const settled = settleVisualRun(plan, result, { image: { perImageFen: 20 } });
    // 5 张图全成功(超时打在 i2v 上)= 100;SHOT_003 minimax i2v 成功 = 300
    // (P9 起 express 路同样烘刊例);SHOT_001 i2v timeout 不计、SHOT_004 grok 跳过
    expect(settled.chargedCostFen).toBe(5 * 20 + 300);
    const byVid = settled.settled.find(s => s.jobId === vid1.jobId);
    expect(byVid?.status).toBe('timeout');
  });
});

describe('settleAudioRun — 按实际用量(未合成不计)', () => {
  it('只计实际合成 clip 与到账 BGM;SFX 恒 0', () => {
    const plan = compileAudioPlan(example());
    const run = {
      clipBlobs: { 'aud-tts-001': new Blob(['wav']) }, // tts-002 合成失败 → 不在
      measurements: {},
      sfxResolutions: {},
      bgmUrls: {}, // BGM 未到账
      failures: [],
    };
    const settled = settleAudioRun(plan, run, { tts: { perCharFen: 2 }, bgm: { perRequestFen: 50 } });
    const byId = new Map(settled.settled.map(s => [s.clipId, s]));
    expect(byId.get('aud-tts-001')!.costFen).toBe(
      (plan.jobs.find(j => j.clipId === 'aud-tts-001') as TtsJob).text.length * 2,
    );
    expect(byId.get('aud-tts-002')!.costFen).toBe(0); // 未合成不计
    expect(byId.get('aud-bgm-001')!.costFen).toBe(0); // 未到账不计
    expect(byId.get('aud-sfx-001')!.costFen).toBe(0);
    expect(settled.chargedCostFen).toBe(
      (plan.jobs.find(j => j.clipId === 'aud-tts-001') as TtsJob).text.length * 2,
    );
  });
});
