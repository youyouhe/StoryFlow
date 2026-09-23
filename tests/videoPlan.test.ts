import { describe, it, expect } from 'vitest';
import { ScriptBlock } from '../types';
import {
  parseBeatTiming,
  planVideoSegments,
  formatVideoPlan,
  buildSegmentVideoBrief,
  isTimedBeat,
} from '../utils/videoPlan';

const blk = (id: string, type: ScriptBlock['type'], content: string): ScriptBlock => ({ id, type, content });

describe('parseBeatTiming', () => {
  it('parses a leading MM:SS-MM:SS prefix (with trailing 。)', () => {
    expect(parseBeatTiming('00:00-00:03。林枫缓缓抬头')).toEqual({
      start: 0, end: 3, range: '00:00-00:03',
    });
  });

  it('parses fractional seconds', () => {
    expect(parseBeatTiming('00:01.5-00:03,x')).toEqual({ start: 1.5, end: 3, range: '00:01.5-00:03' });
  });

  it('parses minute-crossing ranges', () => {
    expect(parseBeatTiming('01:00-01:30 x')).toEqual({ start: 60, end: 90, range: '01:00-01:30' });
  });

  it('returns null when there is no leading timestamp', () => {
    expect(parseBeatTiming('林枫缓缓抬头')).toBeNull();
  });

  it('returns null when end <= start', () => {
    expect(parseBeatTiming('00:03-00:03。x')).toBeNull();
    expect(parseBeatTiming('00:05-00:03。x')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseBeatTiming('')).toBeNull();
  });
});

describe('planVideoSegments — beat collection', () => {
  it('strips ONLY the timestamp prefix from beat text (display/H3 prompt doubling bug)', () => {
    const plan = planVideoSegments([blk('a', 'ACTION', '00:00-00:03。林枫缓缓抬头')], 10);
    expect(plan.segments[0].beats[0].text).toBe('林枫缓缓抬头');
  });

  it('falls back to the raw text when stripping leaves nothing', () => {
    const raw = '00:00-00:03。';
    const plan = planVideoSegments([blk('a', 'ACTION', raw)], 10);
    expect(plan.segments[0].beats[0].text).toBe(raw);
  });

  it('attaches non-timed blocks to the beat they follow', () => {
    const plan = planVideoSegments([
      blk('s', 'SCENE_HEADING', '内. 茶馆 - 夜'),
      blk('a', 'ACTION', '00:00-00:05。刀光一闪'),
      blk('c', 'CHARACTER', '刀客'),
      blk('d', 'DIALOGUE', '你的刀很快。'),
    ], 10);
    expect(plan.segments).toHaveLength(1);
    const beat = plan.segments[0].beats[0];
    expect(beat.blockIds).toEqual(['a', 'c', 'd']);
    expect(beat.endBlockId).toBe('d');
    expect(beat.dialogues).toEqual([{ cue: '刀客', line: '你的刀很快。' }]);
  });

  it('attributes dialogue to the nearest preceding CHARACTER cue, scene-bounded', () => {
    const plan = planVideoSegments([
      blk('s1', 'SCENE_HEADING', '内. 前景'),
      blk('c1', 'CHARACTER', '甲'),
      blk('s2', 'SCENE_HEADING', '内. 后景'),
      blk('a', 'ACTION', '00:00-00:05。两人对峙'),
      blk('d', 'DIALOGUE', '谁?'),
    ], 10);
    // the scene heading between resets the cue scan: no cue found
    expect(plan.segments[0].beats[0].dialogues).toEqual([{ cue: undefined, line: '谁?' }]);
  });

  it('counts untimed actions with content as untimedBeats and warns', () => {
    const plan = planVideoSegments([
      blk('a1', 'ACTION', '无时间戳的动作'),
      blk('a2', 'ACTION', '00:00-00:05。有戳'),
    ], 10);
    expect(plan.untimedBeats).toBe(1);
    expect(plan.warnings.some(w => w.includes('1 个动作没有时间戳'))).toBe(true);
  });

  it('does not count an untimed DIALOGUE before any beat as untimed (dropped, current behavior)', () => {
    const plan = planVideoSegments([blk('d', 'DIALOGUE', '没人接的台词')], 10);
    expect(plan.untimedBeats).toBe(0);
    expect(plan.segments).toHaveLength(0);
  });
});

describe('planVideoSegments — segment grouping', () => {
  it('aggregates beats that fit the window into ONE segment', () => {
    const plan = planVideoSegments([
      blk('a', 'ACTION', '00:00-00:03。甲'),
      blk('b', 'ACTION', '00:03-00:06。乙'),
    ], 10);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].startTime).toBe(0);
    expect(plan.segments[0].endTime).toBe(6);
    expect(plan.segments[0].blockIds).toEqual(['a', 'b']);
    expect(plan.segments[0].oversize).toBe(false);
  });

  it('flushes and starts a new segment when the window would overflow', () => {
    const plan = planVideoSegments([
      blk('a', 'ACTION', '00:00-00:08。甲'),
      blk('b', 'ACTION', '00:08-00:12。乙'),
    ], 10);
    // b.end(12) - segStart(0) = 12 > 10 → flush first
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0].blockIds).toEqual(['a']);
    expect(plan.segments[1].blockIds).toEqual(['b']);
  });

  it('treats a SCENE_HEADING as a hard consistency boundary', () => {
    const plan = planVideoSegments([
      blk('a', 'ACTION', '00:00-00:03。甲'),
      blk('s', 'SCENE_HEADING', '外. 灵剑峰 - 白天'),
      blk('b', 'ACTION', '00:03-00:06。乙'),
    ], 30); // window big enough — only the scene split can separate them
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0].sceneHeading).toBe('');
    expect(plan.segments[1].sceneHeading).toBe('外. 灵剑峰 - 白天');
    // scene heading ids never enter a segment
    expect(plan.segments.flatMap(s => s.blockIds)).not.toContain('s');
  });

  it('propagates the current scene heading onto beats inside it', () => {
    const plan = planVideoSegments([
      blk('s', 'SCENE_HEADING', '内. 茶馆 - 夜'),
      blk('a', 'ACTION', '00:00-00:03。甲'),
    ], 10);
    expect(plan.segments[0].sceneHeading).toBe('内. 茶馆 - 夜');
  });

  it('flags a single beat longer than the window as oversize (never split)', () => {
    const plan = planVideoSegments([blk('a', 'ACTION', '00:00-00:20。一镜到底长动作')], 10);
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0].oversize).toBe(true);
    expect(plan.warnings.some(w => w.includes('单拍超过目标时长'))).toBe(true);
  });

  it('flags segments shorter than 4s as tooShort', () => {
    const plan = planVideoSegments([blk('a', 'ACTION', '00:00-00:03。短拍')], 10);
    expect(plan.segments[0].tooShort).toBe(true);
    expect(plan.warnings.some(w => w.includes('短于 4s'))).toBe(true);
  });

  it('clamps a non-positive target to 1s', () => {
    const plan = planVideoSegments([blk('a', 'ACTION', '00:00-00:03。甲')], 0);
    expect(plan.targetSeconds).toBe(1);
    // 3s beat > 1s window → oversize
    expect(plan.segments[0].oversize).toBe(true);
  });

  it('indexes segments from 1', () => {
    const plan = planVideoSegments([
      blk('a', 'ACTION', '00:00-00:08。甲'),
      blk('b', 'ACTION', '00:08-00:12。乙'),
    ], 10);
    expect(plan.segments.map(s => s.index)).toEqual([1, 2]);
  });
});

describe('formatVideoPlan', () => {
  it('renders header, per-segment lines, dialogue and warnings', () => {
    const plan = planVideoSegments([
      blk('s', 'SCENE_HEADING', '内. 茶馆 - 夜'),
      blk('a', 'ACTION', '00:00-00:08。甲出手'),
      blk('c', 'CHARACTER', '刀客'),
      blk('d', 'DIALOGUE', '你的刀很快。'),
      blk('b', 'ACTION', '00:08-00:11。乙倒下'),
    ], 10);
    const text = formatVideoPlan(plan);
    expect(text).toContain('视频分段规划（目标 ≤10s/段 · 共 2 段）');
    expect(text).toContain('段1  00:00-00:08（8s）· 1 拍 · 对白 1 句');
    expect(text).toContain('💬 刀客：你的刀很快。');
    expect(text).toContain('⚠ 1 段短于 4s');
  });

  it('marks oversize segments', () => {
    const plan = planVideoSegments([blk('a', 'ACTION', '00:00-00:20。长动作')], 10);
    expect(formatVideoPlan(plan)).toContain('⚠ 单拍超时长');
  });

  it('truncates long beat text at 40 chars with …', () => {
    const long = '一'.repeat(50);
    const plan = planVideoSegments([blk('a', 'ACTION', `00:00-00:08。${long}`)], 10);
    const text = formatVideoPlan(plan);
    expect(text).toContain('…');
    expect(text).not.toContain('一'.repeat(41));
  });
});

describe('buildSegmentVideoBrief', () => {
  it('rebases beat timing to the segment start and keeps dialogue verbatim', () => {
    const plan = planVideoSegments([
      blk('a', 'ACTION', '00:10-00:13。甲出手'),
      blk('c', 'CHARACTER', '刀客'),
      blk('d', 'DIALOGUE', '你的刀很快。'),
    ], 15);
    const brief = buildSegmentVideoBrief(plan.segments[0]);
    expect(brief).toContain('连续镜头，时长 3 秒（00:10-00:13 对应原剧本时间轴）');
    expect(brief).toContain('本段第 0s 起（持续 3s）：甲出手');
    expect(brief).toContain('刀客（画外则不露脸）说：「你的刀很快。」');
  });

  it('renders dialogue without a cue as 角色', () => {
    const plan = planVideoSegments([
      blk('a', 'ACTION', '00:00-00:05。无人称'),
      blk('d', 'DIALOGUE', '谁?'),
    ], 15);
    expect(buildSegmentVideoBrief(plan.segments[0])).toContain('角色说：「谁?」');
  });
});

describe('isTimedBeat', () => {
  it('is true only for ACTION blocks with a parseable leading timestamp', () => {
    expect(isTimedBeat(blk('a', 'ACTION', '00:00-00:03。x'))).toBe(true);
    expect(isTimedBeat(blk('a', 'ACTION', '没有戳'))).toBe(false);
    expect(isTimedBeat(blk('d', 'DIALOGUE', '00:00-00:03。台词不该算拍'))).toBe(false);
  });
});
