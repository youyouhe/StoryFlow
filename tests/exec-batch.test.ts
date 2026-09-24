import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, Shot } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileVisualPlan } from '../src/ir/visual/compile';
import type { VisualCallPlan } from '../src/ir/visual/types';
import { executeBatch } from '../src/exec/batchExec';
import type { BatchRequest, ExecOptions, VisualExecDeps, VisualExecPorts } from '../src/exec/types';

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

const mockPorts = (over: Partial<VisualExecPorts> = {}) => {
  const calls: string[] = [];
  const ports: VisualExecPorts = {
    generateImages: async () => { calls.push('generateImages'); return [{ url: 'u', blob: new Blob(['x']) }]; },
    uploadH3Video: async () => { calls.push('uploadH3Video'); return 'uri'; },
    createH3Task: async () => { calls.push('createH3Task'); return 'task'; },
    queryH3Task: async () => ({ status: 'succeeded' as const, videoUrl: 'v' }),
    comfyUploadImage: async () => { calls.push('comfyUploadImage'); return 'up'; },
    comfyPatchWorkflow: () => ({}) as never,
    comfyQueuePrompt: async () => { calls.push('comfyQueuePrompt'); return 'p'; },
    comfyQueryTask: async () => ({ status: 'succeeded' as const, videoUrl: 'v' }),
    ...over,
  };
  return { ports, calls };
};

const depsOf = (ports: VisualExecPorts): VisualExecDeps => ({
  ports,
  refBlob: () => new Blob(['r']),
  minimax: { apiKey: 'k', baseUrl: 'https://api.test' },
  image: { provider: 'minimax' },
  comfy: { serverUrl: 'https://comfy.test', graphJsonOf: () => '{}' },
});

const FAST = { pollIntervalMs: 0, sleep: async () => {} };
const req = (id: string, plan: VisualCallPlan, deps: VisualExecDeps, opts: ExecOptions = FAST): BatchRequest =>
  ({ id, plan, deps, opts });

describe('executeBatch — 总预算与发起即计', () => {
  it('总预算只够一份:第二计划 rejected 不发起,第一照跑', async () => {
    const { ports } = mockPorts();
    const deps = depsOf(ports);
    const batch = await executeBatch(
      [req('p1', proPlan(), deps), req('p2', proPlan(), deps)],
      { budgetFen: 300 }, // 每计划 300 分
    );
    expect(batch.items.map(i => [i.id, i.status])).toEqual([
      ['p1', 'succeeded'], ['p2', 'rejected'],
    ]);
    expect(batch.items[1].chargedCostFen).toBe(0); // 未发起不计
    expect(batch.items[1].error).toMatch(/预算闸门拒绝/);
    expect(batch.totalChargedFen).toBe(300); // 发起即计(失败不退)
  });

  it('逐项自带闸门抛 BudgetExceededError 归 rejected,批量不断', async () => {
    const { ports } = mockPorts();
    const deps = depsOf(ports);
    const batch = await executeBatch([
      req('tight', proPlan(), deps, { ...FAST, budgetFen: 100 }), // 逐项闸:300>100
      req('ok', proPlan(), deps),
    ]);
    expect(batch.items.map(i => i.status)).toEqual(['rejected', 'succeeded']);
    expect(batch.totalChargedFen).toBe(300); // 仅第二项计
  });

  it('failed 发起即计;stopOnError 中止余项', async () => {
    const { ports } = mockPorts({
      generateImages: async () => { throw new Error('生图挂了'); },
    });
    const deps = depsOf(ports);
    // express 计划含生图任务 → failed(发起即计)
    const batch = await executeBatch(
      [req('f1', expressPlan(), deps), req('f2', expressPlan(), deps)],
      { stopOnError: true },
    );
    expect(batch.items[0].status).toBe('failed');
    // attempt 模式按计划估算计费(P9 起 express 的 minimax i2v 也烘 300)
    expect(batch.items[0].chargedCostFen).toBe(300);
    expect(batch.items[1].status).toBe('failed');
    expect(batch.items[1].error).toMatch(/批量中止/);
    expect(batch.items[1].chargedCostFen).toBe(0);

    // 对照:pro 计划失败也发起即计(300 分照收)
    const { ports: p2 } = mockPorts({
      queryH3Task: async () => ({ status: 'failed' as const, errorMessage: '远端失败' }),
    });
    const batch2 = await executeBatch([req('f3', proPlan(), depsOf(p2))]);
    expect(batch2.items[0].status).toBe('failed');
    expect(batch2.items[0].chargedCostFen).toBe(300);
    expect(batch2.totalChargedFen).toBe(300);
  });
});

describe('executeBatch — 成功判据', () => {
  it('grok 等按设计跳过不判 failed', async () => {
    const { ports } = mockPorts();
    const batch = await executeBatch([req('p', proPlan(), depsOf(ports))]);
    expect(batch.items[0].status).toBe('succeeded');
    expect(batch.items[0].result!.results.some(r => r.status === 'skipped')).toBe(true); // grok 细节在 result
  });
});

describe('executeBatch — P9 精确结算(settlement 选项)', () => {
  it("attempt(缺省)发起即计回归锁:失败计划仍计 300", async () => {
    const { ports } = mockPorts({
      queryH3Task: async () => ({ status: 'failed' as const, errorMessage: '远端失败' }),
    });
    const batch = await executeBatch([req('a', proPlan(), depsOf(ports))]);
    expect(batch.items[0].status).toBe('failed');
    expect(batch.items[0].chargedCostFen).toBe(300); // P6 发起即计
  });

  it("precise 按实际产出:唯一计价任务失败 → 计 0", async () => {
    const { ports } = mockPorts({
      queryH3Task: async () => ({ status: 'failed' as const, errorMessage: '远端失败' }),
    });
    const batch = await executeBatch([req('a', proPlan(), depsOf(ports))], {
      settlement: 'precise',
    });
    expect(batch.items[0].status).toBe('failed');
    expect(batch.items[0].chargedCostFen).toBe(0); // SHOT_003 失败 → 不计
    expect(batch.totalChargedFen).toBe(0);
  });

  it('precise 部分成功:只计 succeeded 任务', async () => {
    // SHOT_001/002 comfy 成功(无刊例 0 分)、SHOT_003 minimax 成功(300)
    const { ports } = mockPorts();
    const batch = await executeBatch([req('a', proPlan(), depsOf(ports))], {
      settlement: 'precise',
    });
    expect(batch.items[0].status).toBe('succeeded');
    expect(batch.items[0].chargedCostFen).toBe(300);
    expect(batch.totalChargedFen).toBe(300);
  });
});
