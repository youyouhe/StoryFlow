import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR } from '../src/ir/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileVisualPlan } from '../src/ir/visual/compile';
import { executeVisualPlan } from '../src/exec/visualExec';
import {
  planCostReport, checkBudgetGate, BudgetExceededError,
} from '../src/exec/budget';
import type { VisualExecDeps, VisualExecPorts } from '../src/exec/types';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const proPlan = () => compileVisualPlan(example());

const countingPorts = () => {
  const calls: string[] = [];
  const ports: VisualExecPorts = {
    generateImages: async () => { calls.push('generateImages'); return [{ url: 'u', blob: new Blob(['x']) }]; },
    uploadH3Video: async () => { calls.push('uploadH3Video'); return 'uri'; },
    createH3Task: async () => { calls.push('createH3Task'); return 'task'; },
    queryH3Task: async () => { calls.push('queryH3Task'); return { status: 'succeeded' as const, videoUrl: 'v' }; },
    comfyUploadImage: async () => { calls.push('comfyUploadImage'); return 'up'; },
    comfyPatchWorkflow: () => { calls.push('comfyPatchWorkflow'); return {}; },
    comfyQueuePrompt: async () => { calls.push('comfyQueuePrompt'); return 'p'; },
    comfyQueryTask: async () => { calls.push('comfyQueryTask'); return { status: 'succeeded' as const, videoUrl: 'v' }; },
  };
  return { ports, calls };
};

const depsOf = (ports: VisualExecPorts): VisualExecDeps => ({
  ports,
  refBlob: () => new Blob(['r']),
  minimax: { apiKey: 'k', baseUrl: 'https://api.test' },
  comfy: { serverUrl: 'https://comfy.test', graphJsonOf: () => '{}' },
});

const FAST = { pollIntervalMs: 0, sleep: async () => {} };

describe('planCostReport — 成本汇总(① estimatedCostFen 口径)', () => {
  it('sums minimax video cost and lists unpriced jobs 明示', () => {
    const report = planCostReport(proPlan());
    // 银盐晨光:仅 SHOT_003(minimax)有刊例 6s×50 分=300
    expect(report.totalCostFen).toBe(300);
    expect(report.byJob).toHaveLength(5);
    expect(report.unpricedJobIds).toHaveLength(4); // comfy×3 + grok×1 明示
    expect(report.byJob.filter(j => j.estimatedCostFen > 0)).toHaveLength(1);
  });
});

describe('checkBudgetGate — 判限', () => {
  it('边界:cap=300 放行;cap=299 拒绝且给差额;无上限不拦', () => {
    const plan = proPlan();
    expect(checkBudgetGate(plan, 300)).toEqual({ ok: true, totalCostFen: 300, budgetFen: 300 });
    expect(checkBudgetGate(plan, 299)).toEqual({
      ok: false, totalCostFen: 300, budgetFen: 299, overByFen: 1,
    });
    const open = checkBudgetGate(plan);
    expect(open.ok).toBe(true);
    expect(open.budgetFen).toBeUndefined();
  });
});

describe('预算闸门 — 超限零提交', () => {
  it('executeVisualPlan 超预算抛 BudgetExceededError 且零 port 调用', async () => {
    const { ports, calls } = countingPorts();
    const err = await executeVisualPlan(proPlan(), depsOf(ports), {
      ...FAST,
      budgetFen: 100,
    }).then(() => null, (e: unknown) => e as BudgetExceededError);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err!.totalCostFen).toBe(300);
    expect(err!.budgetFen).toBe(100);
    expect(err!.overByFen).toBe(200);
    expect(calls).toEqual([]); // 连 upload 都不发生——花钱前三读的最后一读
  });

  it('预算内照常执行(闸门不拦)', async () => {
    const { ports, calls } = countingPorts();
    const result = await executeVisualPlan(proPlan(), depsOf(ports), {
      ...FAST,
      budgetFen: 300,
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(result.results.every(r => r.status !== 'failed')).toBe(true);
  });
});
