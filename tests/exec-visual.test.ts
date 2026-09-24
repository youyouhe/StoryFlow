import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, Shot } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileVisualPlan } from '../src/ir/visual/compile';
import type { VisualCallPlan } from '../src/ir/visual/types';
import { executeVisualPlan } from '../src/exec/visualExec';
import type { VisualExecDeps, VisualExecPorts, ExecOptions } from '../src/exec/types';

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

/** 即时轮询(默认 10s 间隔只属生产口径;测试注入假 sleep)。 */
const FAST: ExecOptions = { pollIntervalMs: 0, sleep: async () => {} };

/** 全 mock ports:记录调用序 + 可脚本化响应,零网络。 */
const mockVisualPorts = (over: Partial<VisualExecPorts> = {}) => {
  const calls: string[] = [];
  const uploads: { filename: string; blob: Blob }[] = [];
  const patches: Record<string, unknown>[] = [];
  const frame = new Blob(['first-frame']);
  let h3Polls = 0;
  const ports: VisualExecPorts = {
    generateImages: async () => {
      calls.push('generateImages');
      return [{ url: 'img://1', blob: frame }];
    },
    uploadH3Video: async () => {
      calls.push('uploadH3Video');
      return 'file-uri-1';
    },
    createH3Task: async (_cfg, p, fileUri) => {
      calls.push(`createH3Task${fileUri ? ':with-uri' : ''}`);
      void p;
      return 'task-1';
    },
    queryH3Task: async () => {
      calls.push('queryH3Task');
      h3Polls += 1;
      return h3Polls < 3
        ? { status: h3Polls === 1 ? ('queued' as const) : ('running' as const) }
        : { status: 'succeeded' as const, videoUrl: 'vid://h3-1' };
    },
    comfyUploadImage: async (_cfg, blob, filename) => {
      calls.push(`upload:${filename}`);
      uploads.push({ filename, blob });
      return `up-${filename}`;
    },
    comfyPatchWorkflow: (graphJson, patch) => {
      calls.push('patch');
      patches.push(patch as unknown as Record<string, unknown>);
      void graphJson;
      return {};
    },
    comfyQueuePrompt: async () => {
      calls.push('queue');
      return 'prompt-1';
    },
    comfyQueryTask: async () => {
      calls.push('query');
      return { status: 'succeeded' as const, videoUrl: 'vid://comfy-1' };
    },
    ...over,
  };
  return { ports, calls, uploads, patches, frame };
};

const baseDeps = (ports: VisualExecPorts, over: Partial<VisualExecDeps> = {}): VisualExecDeps => ({
  ports,
  refBlob: () => new Blob(['ref']),
  minimax: { apiKey: 'k', baseUrl: 'https://api.test' },
  image: { provider: 'minimax' },
  comfy: { serverUrl: 'https://comfy.test', graphJsonOf: () => '{"g":{"class_type":"x","inputs":{}}}' },
  ...over,
});

describe('executeVisualPlan — express 路(首帧交接 + CallStep 顺序)', () => {
  it('image 产物交接给 i2v 上传,且 submit→poll 顺序保持', async () => {
    const plan = expressPlan();
    const { ports, calls, uploads, patches, frame } = mockVisualPorts();
    const result = await executeVisualPlan(plan, baseDeps(ports), FAST);

    // CallStep 顺序:image(generateImages) → 槽图上传 → 首帧上传 → patch → queue → query
    const idx = (tag: string) => calls.indexOf(tag);
    expect(idx('generateImages')).toBeGreaterThanOrEqual(0);
    expect(idx('generateImages')).toBeLessThan(idx('patch'));
    expect(idx('patch')).toBeLessThan(idx('queue'));
    expect(idx('queue')).toBeLessThan(idx('query'));

    // 首帧交接:image 产物 blob 直接进 i2v 上传(身份同一)
    const frameUpload = uploads.find(u => u.filename === 'sf-vj-002-frame.png');
    expect(frameUpload?.blob).toBe(frame);

    // patch 带 firstFrameName + durationSeconds(6 = SHOT_001 outputSeconds)
    const i2vPatch = patches.find(p => p.firstFrameName === 'up-sf-vj-002-frame.png');
    expect(i2vPatch?.durationSeconds).toBe(6);

    // 收集:image resultBlob / i2v resultUrl
    const byJob = new Map(result.results.map(r => [r.jobId, r]));
    expect(byJob.get('vj-001')?.status).toBe('succeeded');
    expect(byJob.get('vj-001')?.resultBlob).toBe(frame);
    expect(byJob.get('vj-002')?.status).toBe('succeeded');
    expect(byJob.get('vj-002')?.resultUrl).toBe('vid://comfy-1');
    expect(result.results).toHaveLength(10); // 5 镜 × (image + i2v)
  });
});

describe('executeVisualPlan — Pro 路(H3 submit→poll→collect)', () => {
  it('t2v 提交后轮询到终态并收集 resultUrl', async () => {
    const plan = proPlan();
    const { ports, calls } = mockVisualPorts();
    const result = await executeVisualPlan(plan, baseDeps(ports), FAST);
    const jobId = plan.shots[2].jobs[0].jobId; // SHOT_003 = minimax
    const run = result.results.find(r => r.jobId === jobId)!;
    expect(run.status).toBe('succeeded');
    expect(run.resultUrl).toBe('vid://h3-1');
    // queued → running → succeeded 三查
    expect(calls.filter(c => c === 'queryH3Task')).toHaveLength(3);
    // 无白模 → 不走 uploadH3Video
    expect(calls).not.toContain('uploadH3Video');
  });

  it('r2v 先上传白模拿 fileUri 再 createH3Task', async () => {
    const plan = compileVisualPlan(example(), { whiteModelRef: { durationSeconds: 6 } });
    const { ports, calls } = mockVisualPorts();
    await executeVisualPlan(plan, baseDeps(ports, { whiteModel: { blob: new Blob(['wm']), seconds: 6 } }), FAST);
    const jobId = plan.shots[2].jobs[0].jobId;
    void jobId;
    expect(calls.indexOf('uploadH3Video')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('uploadH3Video')).toBeLessThan(calls.indexOf('createH3Task:with-uri'));
  });

  it('依赖任务失败 → 后续 skipped;grok 步 skipped 带理由', async () => {
    const plan = expressPlan();
    const { ports } = mockVisualPorts({
      generateImages: async () => {
        throw new Error('生图服务挂了');
      },
    });
    const result = await executeVisualPlan(plan, baseDeps(ports), FAST);
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].error).toMatch(/生图服务挂了/);
    expect(result.results[1].status).toBe('skipped');
    expect(result.results[1].error).toMatch(/依赖任务未完成/);

    const proResult = await executeVisualPlan(proPlan(), baseDeps(mockVisualPorts().ports), FAST);
    const grok = proResult.results.find(r => r.jobId === proPlan().shots[3].jobs[0].jobId)!;
    expect(grok.status).toBe('skipped');
    expect(grok.error).toMatch(/grok/);
  });

  it('假时钟下轮询超时 → status timeout', async () => {
    let t = 0;
    const opts: ExecOptions = {
      now: () => t,
      sleep: async () => { t += 10_000; },
      pollIntervalMs: 10_000,
      timeoutMs: 30_000,
    };
    const { ports } = mockVisualPorts({
      queryH3Task: async () => ({ status: 'running' as const }),
    });
    const plan = proPlan();
    const result = await executeVisualPlan(plan, baseDeps(ports), opts);
    const run = result.results.find(r => r.jobId === plan.shots[2].jobs[0].jobId)!;
    expect(run.status).toBe('timeout');
    expect(run.error).toMatch(/轮询超时/);
  });
});

describe('executeVisualPlan — P6 并行提交 opt-in', () => {
  it('concurrency=1 回归锁:严格顺序(一对 image→其 i2v 完整走完才开下一对)', async () => {
    const plan = expressPlan();
    const { ports, calls } = mockVisualPorts();
    await executeVisualPlan(plan, baseDeps(ports), FAST);
    // 顺序语义:vj-001/002 一对完整相邻——vj-002 的全部上传都在第二对 image 之前
    const gIdx = calls.map((c, i) => (c === 'generateImages' ? i : -1)).filter(i => i >= 0);
    const pair1 = calls.map((c, i) => (c.startsWith('upload:sf-vj-002') ? i : -1)).filter(i => i >= 0);
    expect(gIdx[0]).toBe(0);
    expect(Math.max(...pair1)).toBeLessThan(gIdx[1]);
  });

  it('concurrency=2: 同波并发(maxInFlight=2)+ 波间先后(image 波先于 i2v 波)', async () => {
    const plan = expressPlan();
    let inFlight = 0;
    let maxInFlight = 0;
    const { ports, calls } = mockVisualPorts({
      generateImages: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight -= 1;
        return [{ url: 'img://1', blob: new Blob(['frame']) }];
      },
    });
    const result = await executeVisualPlan(plan, baseDeps(ports), { ...FAST, concurrency: 2 });
    expect(maxInFlight).toBe(2); // 波内并发上限生效
    // 泃0(全部 image)先于波1(i2v 上传)——needs 恒先满足
    expect(calls.lastIndexOf('generateImages')).toBeLessThan(calls.findIndex(c => c.startsWith('upload:')));
    expect(result.results).toHaveLength(10);
    // grok 镜(SHOT_004)按设计 skipped;其余全成功
    expect(result.results.every(r => r.status === 'succeeded' || r.status === 'skipped')).toBe(true);
    expect(result.results.filter(r => r.status === 'skipped')).toHaveLength(1);
  });
});
