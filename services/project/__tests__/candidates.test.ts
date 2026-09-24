import { describe, it, expect } from 'vitest';

import {
  outputsOf, candidateFromOutput, sameCandidateAddress,
  withCandidate, withoutCandidate, withSatisfaction, withoutSatisfaction,
  validateRunCandidates,
} from '../candidates';
import type { RunFileData, ResultRecord } from '../files';

/**
 * 候选编辑器纯层(Hypit 尾声 ②)——build-record/satisfy 协议的展示/编辑面
 * 之下:不变量锁定(去重、边随候选删、验证 warn-never-skip)。
 */

const run = (): RunFileData => ({
  name: 'main',
  createdAt: 0,
  selection: { kind: 'all' },
  candidates: [],
  satisfactions: [],
});

const resultRecord = (): ResultRecord => ({
  format: 'storyflow.result@1',
  runId: 'run-20260924-a',
  runName: 'main',
  createdAt: 0,
  status: 'succeeded',
  outputs: [
    { name: 'video.b1', kind: 'video', file: 'files/video.b1.mp4', bytes: 10, createdAt: 0 },
    { name: 'video.b2', kind: 'video', file: 'files/video.b2.mp4', bytes: 10, createdAt: 0 },
  ],
  tasks: [],
});

describe('outputsOf / candidateFromOutput — 结果库 → 候选地址', () => {
  it('ResultOutputRecord.name 就是逻辑输出名(satisfy 同域)', () => {
    const outs = outputsOf(resultRecord().runId, resultRecord());
    expect(outs.map(o => o.output)).toEqual(['video.b1', 'video.b2']);
    expect(outs[0].kind).toBe('video');
  });

  it('candidateFromOutput 生成历史候选并净化 id', () => {
    const c = candidateFromOutput({ runId: 'run 2026/09', output: 'video.b1', name: 'video.b1', kind: 'video' });
    expect(c.fromRun).toBe('run 2026/09');
    expect(c.output).toBe('video.b1');
    expect(c.id).toMatch(/^cand-run_2026_09-video\.b1$/);
  });
});

describe('run-file 编辑不变量', () => {
  it('withCandidate 按地址去重(同 id 或同 fromRun+output 不重复)', () => {
    const c1 = { id: 'cand-a', fromRun: 'r1', output: 'video.b1' };
    const c2 = { id: 'cand-a' }; // same id, different shape
    const c3 = { id: 'cand-x', fromRun: 'r1', output: 'video.b1' }; // same address
    let r = withCandidate(run(), c1);
    expect(r.candidates).toHaveLength(1);
    r = withCandidate(r, c2);
    expect(r.candidates).toHaveLength(1);
    r = withCandidate(r, c3);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].id).toBe('cand-a');
  });

  it('withoutCandidate 连带删除其 satisfy 边(不留悬空)', () => {
    let r = withCandidate(run(), { id: 'cand-a', fromRun: 'r1', output: 'video.b1' });
    r = withSatisfaction(r, 'video.b1', 'cand-a');
    expect(r.satisfactions).toHaveLength(1);
    r = withoutCandidate(r, 'cand-a');
    expect(r.candidates).toHaveLength(0);
    expect(r.satisfactions).toHaveLength(0);
  });

  it('withSatisfaction 覆盖同输出的旧边(一输出一候选)', () => {
    let r = withCandidate(run(), { id: 'c1' });
    r = withCandidate(r, { id: 'c2' });
    r = withSatisfaction(r, 'video.b1', 'c1');
    r = withSatisfaction(r, 'video.b1', 'c2');
    expect(r.satisfactions).toEqual([{ output: 'video.b1', candidate: 'c2' }]);
    r = withoutSatisfaction(r, 'video.b1');
    expect(r.satisfactions).toEqual([]);
  });

  it('sameCandidateAddress:id 相同或地址相同', () => {
    expect(sameCandidateAddress({ id: 'a' }, { id: 'a' })).toBe(true);
    expect(sameCandidateAddress({ id: 'a', fromRun: 'r', output: 'o' }, { id: 'b', fromRun: 'r', output: 'o' })).toBe(true);
    expect(sameCandidateAddress({ id: 'a', fromRun: 'r', output: 'o' }, { id: 'b', fromRun: 'r', output: 'p' })).toBe(false);
  });
});

describe('validateRunCandidates — warn,never skip', () => {
  it('悬空 satisfy / 缺历史 / 重复 id 各自报出且 ok=false', () => {
    const r: RunFileData = {
      ...run(),
      candidates: [
        { id: 'c1', fromRun: 'run-a', output: 'video.b1' },
        { id: 'c1' },
        { id: 'c2', fromRun: 'run-ghost', output: 'video.zz' },
      ],
      satisfactions: [{ output: 'video.b1', candidate: 'ghost' }],
    };
    const v = validateRunCandidates(r, new Map([
      ['run-a', new Set(['video.b1'])],
    ]));
    expect(v.duplicateIds).toEqual(['c1']);
    expect(v.missingHistory).toEqual(['c2']);
    expect(v.danglingSatisfactions).toEqual(['video.b1']);
    expect(v.ok).toBe(false);
  });

  it('干净 run → ok=true', () => {
    const r: RunFileData = {
      ...run(),
      candidates: [{ id: 'c1', fromRun: 'run-a', output: 'video.b1' }],
      satisfactions: [{ output: 'video.b1', candidate: 'c1' }],
    };
    expect(validateRunCandidates(r, new Map([['run-a', new Set(['video.b1'])]])).ok).toBe(true);
  });
});
