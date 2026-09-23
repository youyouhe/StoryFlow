import { describe, it, expect } from 'vitest';
import { GrayboxCamera } from '../types';
import {
  planSegments,
  defaultTargetSeconds,
  MODEL_MAX_SECONDS,
  MODEL_MIN_SECONDS,
} from '../utils/grayboxPlan';

const cam = (duration?: number): GrayboxCamera =>
  ({
    shotType: 'medium',
    position: [0, 0, 0],
    lookAt: [0, 0, 1],
    movement: { type: 'static', duration: duration ?? 0 },
  }) as GrayboxCamera;

describe('defaultTargetSeconds', () => {
  it('uses the authored camera duration when positive', () => {
    expect(defaultTargetSeconds(cam(7))).toBe(7);
  });

  it('falls back to 3s when duration is 0 or missing', () => {
    expect(defaultTargetSeconds(cam(0))).toBe(3);
    expect(defaultTargetSeconds({ movement: {} } as unknown as GrayboxCamera)).toBe(3);
  });
});

describe('planSegments — below model minimum', () => {
  it('snaps a sub-4s target up to one 4s segment', () => {
    const p = planSegments(2.5);
    expect(p.strategy).toBe('snapped-up');
    expect(p.targetSeconds).toBe(2.5);
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0]).toMatchObject({ index: 1, outputSeconds: 4, offsetSeconds: 0 });
    expect(p.segments[0].note).toContain('2.5');
    expect(p.warnings[0]).toContain('下限 4s');
  });

  it('clamps a non-positive target to 1s before planning (still snapped-up)', () => {
    const p = planSegments(0);
    expect(p.targetSeconds).toBe(1);
    expect(p.strategy).toBe('snapped-up');
  });
});

describe('planSegments — in range [4, 15]', () => {
  it('returns a single exact segment for an integer target', () => {
    const p = planSegments(8);
    expect(p.strategy).toBe('single');
    expect(p.segments).toEqual([{ index: 1, outputSeconds: 8, offsetSeconds: 0, note: '精确 8s。' }]);
    expect(p.warnings).toEqual([]);
  });

  it('accepts the boundary values 4 and 15 as single', () => {
    expect(planSegments(MODEL_MIN_SECONDS).strategy).toBe('single');
    expect(planSegments(MODEL_MAX_SECONDS).strategy).toBe('single');
    expect(planSegments(15).segments[0].outputSeconds).toBe(15);
  });

  it('snaps a decimal target to the nearest integer and warns about post fix-up', () => {
    const p = planSegments(7.5);
    expect(p.strategy).toBe('snapped');
    expect(p.segments[0].outputSeconds).toBe(8); // Math.round(7.5)
    expect(p.segments[0].offsetSeconds).toBe(0);
    expect(p.warnings[0]).toContain('不是整数秒');
    expect(p.segments[0].note).toContain('0.5');
  });

  it('rounds 4.4 DOWN to 4', () => {
    const p = planSegments(4.4);
    expect(p.strategy).toBe('snapped');
    expect(p.segments[0].outputSeconds).toBe(4);
  });
});

describe('planSegments — chain above 15s', () => {
  it('splits 16s into two equal 8s segments', () => {
    const p = planSegments(16);
    expect(p.strategy).toBe('chain');
    expect(p.segments.map(s => s.outputSeconds)).toEqual([8, 8]);
    expect(p.segments.map(s => s.offsetSeconds)).toEqual([0, 8]);
    expect(p.segments.map(s => s.index)).toEqual([1, 2]);
  });

  it('distributes the remainder onto the first segments (31s → 11+10+10)', () => {
    const p = planSegments(31);
    expect(p.segments.map(s => s.outputSeconds)).toEqual([11, 10, 10]);
    // the chain total stays exact
    expect(p.segments.reduce((n, s) => n + s.outputSeconds, 0)).toBe(31);
  });

  it('keeps every chained segment inside the model window', () => {
    for (const T of [16, 20, 30, 31, 45, 47, 100]) {
      const p = planSegments(T);
      for (const s of p.segments) {
        expect(s.outputSeconds).toBeGreaterThanOrEqual(MODEL_MIN_SECONDS);
        expect(s.outputSeconds).toBeLessThanOrEqual(MODEL_MAX_SECONDS);
      }
    }
  });

  it('warns about the model cap and the no-frame-continuation caveat', () => {
    const p = planSegments(20);
    expect(p.warnings[0]).toContain('超过单段上限 15s');
    expect(p.warnings[0]).toContain('拆成 2 段');
    expect(p.warnings[1]).toContain('无帧连续保证');
  });

  it('notes whole-second approximation for decimal over-cap targets', () => {
    const p = planSegments(16.4);
    expect(p.warnings[0]).toContain('按整秒近似');
    expect(p.segments.reduce((n, s) => n + s.outputSeconds, 0)).toBe(16);
  });

  it('does NOT add the approximation note when the target is already whole', () => {
    const p = planSegments(30);
    expect(p.warnings[0]).not.toContain('按整秒近似');
  });
});
