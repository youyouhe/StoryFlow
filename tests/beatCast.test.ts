import { describe, it, expect } from 'vitest';
import { ScriptBlock } from '../types';
import {
  parseCharacterName,
  baseCharName,
  isOffScreen,
  collectCharacterNames,
  computeBeatCast,
  resolveBeatVariant,
} from '../utils/beatCast';

const blk = (id: string, type: ScriptBlock['type'], content: string): ScriptBlock => ({ id, type, content });

describe('parseCharacterName', () => {
  it('splits a full-width trailing (variant) cue', () => {
    expect(parseCharacterName('张三（浴袍）')).toEqual({ base: '张三', variant: '浴袍' });
  });

  it('splits a half-width trailing (variant) cue', () => {
    expect(parseCharacterName('张三(战损)')).toEqual({ base: '张三', variant: '战损' });
  });

  it('returns the bare name when there is no variant', () => {
    expect(parseCharacterName('张三')).toEqual({ base: '张三' });
  });

  it('does not treat an inner/mid-string paren as a variant cue', () => {
    expect(parseCharacterName('张三(浴袍)extras')).toEqual({ base: '张三(浴袍)extras' });
  });

  it('falls back to the raw name when the variant part is empty', () => {
    expect(parseCharacterName('张三()')).toEqual({ base: '张三()' });
  });

  it('trims whitespace around base and variant', () => {
    expect(parseCharacterName(' 张三 （ 浴袍 ） ')).toEqual({ base: '张三', variant: '浴袍' });
  });

  it('baseCharName strips the variant', () => {
    expect(baseCharName('张三（浴袍）')).toBe('张三');
    expect(baseCharName(' 张三 ')).toBe('张三');
  });
});

describe('isOffScreen', () => {
  it('flags the Chinese V.O. conventions', () => {
    expect(isOffScreen('旁白')).toBe(true);
    expect(isOffScreen('甲（画外音）')).toBe(true);
  });

  it('flags the English V.O./O.S. conventions', () => {
    expect(isOffScreen('NARRATOR (V.O.)')).toBe(true);
    expect(isOffScreen('甲 (O.S.)')).toBe(true);
    expect(isOffScreen('VO')).toBe(true);
    expect(isOffScreen('voice over')).toBe(true);
    expect(isOffScreen('off-screen')).toBe(true);
  });

  it('does not flag in-frame names that merely contain similar letters', () => {
    expect(isOffScreen('VOICETRACK')).toBe(false);
    expect(isOffScreen('张三')).toBe(false);
    expect(isOffScreen('IVY')).toBe(false);
  });
});

describe('collectCharacterNames', () => {
  it('collects distinct BASE names from CHARACTER cues, oldest first', () => {
    const blocks = [
      blk('1', 'CHARACTER', '张三'),
      blk('2', 'CHARACTER', '张三（浴袍）'), // same person, different costume
      blk('3', 'ACTION', '张三入水'),
      blk('4', 'CHARACTER', '李四'),
      blk('5', 'CHARACTER', '张三'),
    ];
    expect(collectCharacterNames(blocks)).toEqual(['张三', '李四']);
  });

  it('never frames off-screen cues', () => {
    const blocks = [
      blk('1', 'CHARACTER', '旁白（V.O.）'),
      blk('2', 'CHARACTER', '张三'),
    ];
    expect(collectCharacterNames(blocks)).toEqual(['张三']);
  });
});

describe('computeBeatCast', () => {
  it('casts characters mentioned in the beat text', () => {
    const blocks = [
      blk('0', 'SCENE_HEADING', '内. 茶馆'),
      blk('1', 'CHARACTER', '张三'),
      blk('2', 'CHARACTER', '李四'),
      blk('3', 'ACTION', '00:00-00:05。张三出手,李四倒下'),
    ];
    expect(computeBeatCast(blocks, 3, ['张三', '李四', '王五'])).toEqual(['张三', '李四']);
  });

  it('the cue scan adds up to two names NOT already found — the nearest cue self-mentions, so up to 3 total', () => {
    const blocks = [
      blk('0', 'SCENE_HEADING', '内. 茶馆'),
      blk('1', 'CHARACTER', '王五'),
      blk('2', 'CHARACTER', '张三'),
      blk('3', 'CHARACTER', '李四'),
      blk('4', 'ACTION', '对峙,无人点名'),
    ];
    // 李四 enters via the mention pass (the nearest cue is appended to the
    // scanned text); the scan then counts 张三 (1) and 王五 (2) as new finds.
    expect(computeBeatCast(blocks, 4, ['王五', '张三', '李四'])).toEqual(['李四', '张三', '王五']);
  });

  it('a cue already found by mention does not consume a scan slot (scene stops the scan earlier)', () => {
    const blocks = [
      blk('0', 'SCENE_HEADING', '内. 茶馆'),
      blk('1', 'CHARACTER', '张三'),
      blk('2', 'CHARACTER', '旁白（V.O.）'),
      blk('3', 'CHARACTER', '李四'),
      blk('4', 'ACTION', '对峙'),
    ];
    expect(computeBeatCast(blocks, 4, ['张三', '李四'])).toEqual(['李四', '张三']);
  });

  it('the cue scan is scene-bounded', () => {
    const blocks = [
      blk('0', 'SCENE_HEADING', '内. 前景'),
      blk('1', 'CHARACTER', '张三'),
      blk('2', 'SCENE_HEADING', '内. 后景'),
      blk('3', 'CHARACTER', '李四'),
      blk('4', 'ACTION', '对峙'),
    ];
    expect(computeBeatCast(blocks, 4, ['张三', '李四'])).toEqual(['李四']);
  });

  it('names outside the universe are never cast', () => {
    const blocks = [
      blk('0', 'SCENE_HEADING', '内. 茶馆'),
      blk('1', 'CHARACTER', '赵六'),
      blk('2', 'ACTION', '动作'),
    ];
    expect(computeBeatCast(blocks, 2, ['张三'])).toEqual([]);
  });

  it('returns no-character when the beat stands alone', () => {
    const blocks = [blk('0', 'ACTION', '空镜,无人')];
    expect(computeBeatCast(blocks, 0, ['张三'])).toEqual([]);
  });
});

describe('resolveBeatVariant', () => {
  const blocks = [
    blk('0', 'SCENE_HEADING', '内. 浴室'),
    blk('1', 'CHARACTER', '张三（浴袍）'),
    blk('2', 'ACTION', '张三泡入热水'),
    blk('3', 'CHARACTER', '张三'),
    blk('4', 'ACTION', '张三出门'),
  ];

  it('resolves the variant from the nearest preceding cue of the same base', () => {
    expect(resolveBeatVariant(blocks, 2, '张三')).toBe('浴袍');
  });

  it('a bare later cue returns to the base design (undefined)', () => {
    expect(resolveBeatVariant(blocks, 4, '张三')).toBeUndefined();
  });

  it('another character’s variant cue does not interfere', () => {
    const blocks2 = [
      blk('0', 'SCENE_HEADING', '内. 战场'),
      blk('1', 'CHARACTER', '李四（战损）'),
      blk('2', 'CHARACTER', '张三（浴袍）'),
      blk('3', 'ACTION', '张三冲锋'),
    ];
    expect(resolveBeatVariant(blocks2, 3, '张三')).toBe('浴袍');
  });

  it('is scene-bounded: a cue before the scene heading does not leak in', () => {
    const blocks2 = [
      blk('0', 'CHARACTER', '张三（浴袍）'),
      blk('1', 'SCENE_HEADING', '外. 街道'),
      blk('2', 'ACTION', '张三走过'),
    ];
    expect(resolveBeatVariant(blocks2, 2, '张三')).toBeUndefined();
  });

  it('returns undefined for an unknown base', () => {
    expect(resolveBeatVariant(blocks, 2, '不存在')).toBeUndefined();
  });
});
