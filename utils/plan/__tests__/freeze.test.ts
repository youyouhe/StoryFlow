/**
 * P3 — frozen plans, explicit reuse (Candidates/satisfy), pricing honesty,
 * result addresses. Acceptance targets: 候选满足不发请求(1), 子产物可继承(2),
 * 零外部请求计划预览(3), A/B 可 diff(4), run-id+output 地址(5).
 */
import { describe, expect, it } from 'vitest';
import {
  newRunId,
  parseResultFile,
  resolveOutputRecord,
  serializeResultFile,
  type ResultRecord,
} from '../../../services/project/files';
import { formatFrozenPlan, freezePlan, type PlanDemand } from '../freeze';
import { estimateFalImagePrice, estimateLocalVideoPrice, estimateVideoPrice } from '../pricing';

const videoDemand = (name: string, blockId = 'b1'): PlanDemand => ({
  name,
  kind: 'video',
  blockId,
  service: 'minimax-h3',
  params: { model: 'MiniMax-Hailuo-2.3', resolution: '768P', outputSeconds: 5 },
  outputSeconds: 5,
  videoSeconds: 0,
  imageCount: 2,
  resolution: '768P',
});

const run = (candidates: Parameters<typeof freezePlan>[1], satisfactions: Parameters<typeof freezePlan>[2]) =>
  freezePlan('main', candidates, satisfactions, [videoDemand('video.b1'), videoDemand('video.b2', 'b2')]);

describe('freezePlan (zero external requests)', () => {
  it('lists every demand with params and price, costs only what will be sent', () => {
    const plan = run([], []);
    expect(plan.format).toBe('storyflow.plan@1');
    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0].estimated.amount).toBe(2.5); // 5s × ¥0.50
    expect(plan.totals.CNY).toBe(5);
    expect(plan.skippedCount).toBe(0);
    const text = formatFrozenPlan(plan);
    expect(text).toContain('video.b1');
    expect(text).toContain('outputSeconds=5');
  });

  it('a satisfied demand is marked "由候选满足" and sends NO request (acceptance 1)', () => {
    const plan = run(
      [{ id: 'kept', fromRun: 'run_old', output: 'video.b1' }],
      [{ output: 'video.b1', candidate: 'kept' }],
    );
    expect(plan.rows[0].satisfiedBy?.source).toBe('run_old#video.b1');
    expect(plan.rows[0].satisfiedBy).toBeTruthy();
    expect(plan.rows[1].satisfiedBy).toBeUndefined();
    expect(plan.skippedCount).toBe(1);
    expect(plan.totals.CNY).toBe(2.5); // only the unsatisfied demand costs
    expect(formatFrozenPlan(plan)).toContain('不发请求');
  });

  it('a file candidate satisfies too (approved local bytes)', () => {
    const plan = run([{ id: 'file1', file: './approved.mp4' }], [{ output: 'video.b1', candidate: 'file1' }]);
    expect(plan.rows[0].satisfiedBy?.file).toBe('./approved.mp4');
  });

  it('missing or malformed candidates warn and do NOT silently skip (fail loud)', () => {
    const plan = run([{ id: 'broken', output: 'x' }], [
      { output: 'video.b1', candidate: 'ghost' },
      { output: 'video.b2', candidate: 'broken' },
    ]);
    expect(plan.warnings).toHaveLength(2);
    expect(plan.skippedCount).toBe(0);
    expect(plan.totals.CNY).toBe(5); // both requests still happen
  });

  it('is deterministic — same inputs, byte-identical plan body (A/B diffs live in run files)', () => {
    const a = run([{ id: 'kept', fromRun: 'run_old', output: 'video.b1' }], [{ output: 'video.b1', candidate: 'kept' }]);
    const b = run([{ id: 'kept', fromRun: 'run_old', output: 'video.b1' }], [{ output: 'video.b1', candidate: 'kept' }]);
    expect({ ...a, createdAt: 0 }).toEqual({ ...b, createdAt: 0 });
  });
});

describe('pricing honesty', () => {
  it('H3 rates derive from the official 刊例 with the breakdown in the note', () => {
    const est = estimateVideoPrice({ videoSeconds: 3, outputSeconds: 10, imageCount: 6, resolution: '2K', model: undefined });
    // 10×0.80 + 3×0.80 + 1×0.20 = 10.6
    expect(est.amount).toBeCloseTo(10.6, 5);
    expect(est.currency).toBe('CNY');
    expect(est.note).toContain('参考视频');
  });

  it('Comfy local is zero-cost; FAL images price by the derived table; unknown cells never guess', () => {
    expect(estimateLocalVideoPrice().amount).toBe(0);
    expect(estimateFalImagePrice('landscape_4_3', 'low', 2).amount).toBeCloseTo(0.00804, 6);
    const unknown = estimateFalImagePrice('weird_size', 'low');
    expect(unknown.amount).toBeUndefined();
    expect(unknown.note).toContain('不猜价');
  });

  it('currencies never mix into one total', () => {
    const plan = freezePlan('main', [], [], [
      videoDemand('video.b1'),
      { name: 'image.b2', kind: 'image', blockId: 'b2', service: 'fal:gpt-image', params: { size: 'square_hd', quality: 'low' }, imageSize: 'square_hd', imageQuality: 'low' },
    ]);
    expect(plan.totals.CNY).toBe(2.5);
    expect(plan.totals.USD).toBeCloseTo(0.00588, 6);
  });
});

describe('result addresses (runId + output) and forwarding', () => {
  const record = (runId: string, outputs: ResultRecord['outputs']): ResultRecord => ({
    format: 'storyflow.result@1',
    runId,
    runName: 'main',
    createdAt: 1,
    status: 'succeeded',
    outputs,
    tasks: [],
  });

  it('round-trips result.json and mints sortable run ids', () => {
    const r = record('run_1', [{ name: 'video.b1', kind: 'video', file: 'files/video.b1.mp4', bytes: 10, createdAt: 1 }]);
    const parsed = parseResultFile(serializeResultFile(r));
    expect(parsed).toEqual(r);
    expect(newRunId(new Date('2026-09-24T12:30:45Z'))).toMatch(/^run_20260924T123045Z_[a-z0-9]+$/);
  });

  it('resolves forwards without copying bytes and guards cycles (acceptance 2/5)', async () => {
    const store = new Map<string, ResultRecord>([
      ['run_old', record('run_old', [{ name: 'video.b1', kind: 'video', file: 'files/a.mp4', createdAt: 1, blockId: 'b1' }])],
      ['run_new', record('run_new', [
        { name: 'video.b1', kind: 'video', forward: { runId: 'run_old', output: 'video.b1' }, createdAt: 2 },
        { name: 'loop', kind: 'video', forward: { runId: 'run_new', output: 'loop2' }, createdAt: 2 },
        { name: 'loop2', kind: 'video', forward: { runId: 'run_new', output: 'loop' }, createdAt: 2 },
      ])],
    ]);
    const lookup = (id: string) => store.get(id);

    // a failed run's completed sub-output is inheritable through the address
    const reused = await resolveOutputRecord(lookup, 'run_new', 'video.b1');
    expect(reused?.record.file).toBe('files/a.mp4');
    expect(reused?.runId).toBe('run_old'); // bytes stay with the original run

    // forward cycles refuse rather than hang
    expect(await resolveOutputRecord(lookup, 'run_new', 'loop')).toBeNull();
  });
});
