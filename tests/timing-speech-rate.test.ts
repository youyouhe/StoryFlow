import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPEECH_RATE, BRACKET_RATE_FACTOR, SPEECH_MARGIN_SECONDS,
  estimateTextSeconds, estimateSpeechSeconds,
} from '../utils/timing/estimate';

/**
 * issue #13 语速模型 —— TTS 时长与台词语速脱钩(最小版,语速可配置)。
 *
 * 四条锚点:
 *   1. 基准语速 = 4.5 字/秒(全局常量,issue 原值);
 *   2. TTS 估算 = 朗读估时 + 0.4s 余量;
 *   3. 行内括注按 0.7 倍语速折算(（低语） 读得更慢);
 *   4. 语速可按句注入(charsPerSecond),缺省 = 全局基准——情绪驱动语速的
 *      后续注入点(本任务不实现情绪,只留接口)。
 */

/** 展示语速(字/秒)= 口字数 / 估算秒(括注剥壳后计数,与 issue 口径一致)。 */
const readableRate = (spokenChars: number, text: string, opts?: { charsPerSecond?: number }): number =>
  spokenChars / estimateSpeechSeconds(text, opts);

describe('issue #13 — 语速模型(基准常量 + 余量 + 括注折算 + 可注入)', () => {
  it('基准语速 = 4.5 字/秒(issue 原值,全局唯一常量)', () => {
    expect(DEFAULT_SPEECH_RATE).toBe(4.5);
    expect(BRACKET_RATE_FACTOR).toBe(0.7);
    expect(SPEECH_MARGIN_SECONDS).toBe(0.4);
  });

  it('TTS 估算 = 字数/语速 + 标点停顿 + 0.4s 余量(issue 例①:11 字句落在可读区间)', () => {
    // 「我是你留在这里的那一半。」11 字:11/4.5 + 句号 0.3 + 余量 0.4
    expect(estimateSpeechSeconds('我是你留在这里的那一半。')).toBeCloseTo(11 / 4.5 + 0.3 + 0.4, 5);
    // 旧口径(1.5s 塞 11 字 = 7.3 字/秒不可读)→ 新口径 ≈ 3.5 字/秒,可读
    expect(readableRate(11, '我是你留在这里的那一半。')).toBeGreaterThanOrEqual(2.5);
    expect(readableRate(11, '我是你留在这里的那一半。')).toBeLessThanOrEqual(5.5);
  });

  it('标点停顿计入(逗号/句号),空串兜底 MIN_BLOCK_SECONDS + 余量', () => {
    // 「你每睡一次，就少还我一点。」11 个汉字(issue 标 12 字含标点口径):
    // 11/4.5 + 逗号 0.1 + 句号 0.3 + 余量 0.4
    expect(estimateSpeechSeconds('你每睡一次，就少还我一点。'))
      .toBeCloseTo(11 / 4.5 + 0.1 + 0.3 + 0.4, 5);
    expect(estimateSpeechSeconds('')).toBeGreaterThan(0); // 余量仍在,不产 0s 窗
  });

  it('括注 0.7 折算:（低语） 内容按 0.7 倍语速(更慢),括注符号自身零时长', () => {
    // 「（低语）这不是我的记忆。」:括注内 2 字 @ 4.5×0.7,括注外 7 字 @ 4.5
    const folded = 2 / (4.5 * BRACKET_RATE_FACTOR) + 7 / 4.5 + 0.3 + 0.4;
    expect(estimateSpeechSeconds('（低语）这不是我的记忆。')).toBeCloseTo(folded, 5);
    // 同正文无括注版本更短(折算生效的方向性)
    expect(estimateSpeechSeconds('这不是我的记忆。'))
      .toBeLessThan(estimateSpeechSeconds('（低语）这不是我的记忆。'));
    // 半角括注同口径
    expect(estimateSpeechSeconds('(低语)这不是我的记忆。')).toBeCloseTo(folded, 5);
  });

  it('语速可按句注入:charsPerSecond 越大越快,缺省 = 全局基准', () => {
    const line = '把证件照给我。';
    const fast = estimateSpeechSeconds(line, { charsPerSecond: 9 });
    const base = estimateSpeechSeconds(line);
    const slow = estimateSpeechSeconds(line, { charsPerSecond: 2.5 });
    expect(fast).toBeLessThan(base);
    expect(slow).toBeGreaterThan(base);
    expect(base).toBeCloseTo(estimateSpeechSeconds(line, { charsPerSecond: DEFAULT_SPEECH_RATE }), 10);
    // estimateTextSeconds 同接口(object 形式),旧位置参数(type)仍可用
    expect(estimateTextSeconds(line, { type: 'DIALOGUE', charsPerSecond: 9 }))
      .toBeCloseTo(fast - SPEECH_MARGIN_SECONDS, 10);
    expect(estimateTextSeconds(line, 'DIALOGUE'))
      .toBeCloseTo(base - SPEECH_MARGIN_SECONDS, 10);
  });

  it('estimateTextSeconds 与 estimateSpeechSeconds 的余量关系(单一出处,不散魔法数)', () => {
    const line = '这是另一句台词。';
    expect(estimateSpeechSeconds(line))
      .toBeCloseTo(estimateTextSeconds(line, 'DIALOGUE') + SPEECH_MARGIN_SECONDS, 10);
  });
});
