import { describe, it, expect } from 'vitest';
import type { StoryFlowIR, Shot, TtsClip } from '../src/ir/types';
import { compileCaptions } from '../src/captions/compile';
import { DEFAULT_SPEECH_RATE, estimateSpeechSeconds, estimateTextSeconds } from '../utils/timing/estimate';

/**
 * issue #13 四条验收 —— 字幕窗与台词语速脱钩(合成层):
 *   ① 朗读可读:《标准电影剧本》形态重导,字幕语速落在 2.5~5.5 字/秒
 *     (快速侧:字幕窗 = max(拍窗, TTS 估算),宁可越出拍尾也不可读不完);
 *   ② 拍长不足的拍产出可读警告(SHOT_TOO_SHORT_FOR_TTS,经现有警告机制
 *     透传 IRPipelineModal);
 *   ③ 过慢侧:拍长 >> 朗读估算时字幕保持拍窗(留呼吸感)不缩;
 *   ④ TTS 文本含（低语）等括注按 0.7 倍语速折算(窗随折算变长);
 *   + 语速可注入(charsPerSecond,按稿/按批),缺省 = 全局基准;
 *   + 探活(measured)时真实音频权威:窗不越过实测,超窗仍警告;
 *   + #11 others 分窗与锚句共用同一估算函数(注入生效)。
 */

const shotOf = (id: string, seq: number, durationSec: number, line: string): Shot => ({
  id,
  sequence: seq,
  imagePrompt: 'p',
  motionPrompt: 'm',
  shotDuration: durationSec,
  firstFrame: { description: 'f' },
  refBindings: [],
  character: '说话人',
  dialogue: { text: line, ttsFloor: 0 },
  status: 'draft',
});

const irOf = (shots: Shot[], clips: TtsClip[] = []): StoryFlowIR => ({
  version: '0.3.0',
  mode: 'pro',
  title: '标准电影剧本',
  style: { name: '未设定', artStyle: '未设定', scenePreset: '未设定', promptPrefix: '' },
  refs: { characters: [], props: [], scenes: [], styles: [] },
  shots,
  audio: clips,
  transitions: [],
  spatial: [],
});

/** 显示语速(字/秒)= 显示字数(含标点,与 issue 口径一致)/ 字幕时长秒。 */
const cueRate = (cue: { text: string; startMs: number; endMs: number }): number =>
  ([...cue.text].length) / ((cue.endMs - cue.startMs) / 1000);

describe('issue #13 — 字幕窗 = max(拍窗, TTS 估算)', () => {
  it('验收①:《标准电影剧本》形态重导 — 4 条字幕语速全部落在 2.5~5.5 字/秒', () => {
    // 短拍 + 长句(旧口径 1.5s 塞 11 字 = 7.3 字/秒不可读的场景)
    const ir = irOf([
      shotOf('SHOT_001', 1, 1.5, '我是你留在这里的那一半。'),
      shotOf('SHOT_002', 2, 1.5, '你每睡一次，就少还我一点。'),
      shotOf('SHOT_003', 3, 2.0, '（低语）这不是我的记忆。'),
      shotOf('SHOT_004', 4, 1.0, '把证件照还给我。'),
    ]);
    const track = compileCaptions(ir);
    expect(track.captions).toHaveLength(4);
    for (const c of track.captions) {
      expect(cueRate(c), `caption「${c.text}」rate ${cueRate(c).toFixed(2)}`).toBeGreaterThanOrEqual(2.5);
      expect(cueRate(c)).toBeLessThanOrEqual(5.5);
    }
    // 锚点抽查:11 字句窗 = 朗读估算(越出 1.5s 拍尾),不是旧拍窗
    const c1 = track.captions[0];
    expect(c1.endMs - c1.startMs).toBeCloseTo(estimateSpeechSeconds('我是你留在这里的那一半。') * 1000, -1);
    expect(c1.endMs - c1.startMs).toBeGreaterThan(1500);
  });

  it('验收②:拍长不足的拍产出可读警告(需 Ns 朗读 / 拍仅 Ms)', () => {
    const ir = irOf([
      shotOf('SHOT_001', 1, 1.5, '我是你留在这里的那一半。'),
      shotOf('SHOT_002', 2, 8.0, '把证件照还给我。'),
    ]);
    const track = compileCaptions(ir);
    const warn = track.warnings.find(w => w.code === 'SHOT_TOO_SHORT_FOR_TTS');
    expect(warn).toBeTruthy();
    expect(warn!.shotId).toBe('SHOT_001');
    expect(warn!.message).toContain('SHOT_001');
    expect(warn!.message).toContain('朗读');
    expect(warn!.message).toContain('1.5s'); // 拍仅 Ms —— 拍长原值
    // 拍长足够(8s >> 估算)的拍不警告
    expect(track.warnings.some(w => w.shotId === 'SHOT_002')).toBe(false);
  });

  it('验收③:过慢侧保持拍窗不缩(留呼吸感),且不产拍长不足警告', () => {
    // 10 字句朗读约 2.9s,拍 8s >> 估算 → 字幕窗保持 8s(不缩),无警告
    const ir = irOf([shotOf('SHOT_001', 1, 8.0, '（低语）这不是我的记忆。')]);
    const track = compileCaptions(ir);
    expect(track.warnings).toHaveLength(0);
    expect(track.captions[0].endMs - track.captions[0].startMs).toBe(8000);
  });

  it('验收④:括注 0.7 折算进入窗下限(同拍长下窗随折算变长)', () => {
    const line = '（低语）这不是我的记忆。';
    const foldedMs = estimateSpeechSeconds(line) * 1000;
    const unfoldedMs = (estimateTextSeconds('这不是我的记忆。', 'DIALOGUE') + 0.4) * 1000;
    expect(foldedMs).toBeGreaterThan(unfoldedMs);
    // 拍 2s:无折算的估算 < 拍长,折算后 > 拍长 —— 窗必须取折算值
    const ir = irOf([shotOf('SHOT_001', 1, 2.0, line)]);
    const track = compileCaptions(ir);
    expect(track.captions[0].endMs - track.captions[0].startMs).toBeCloseTo(foldedMs, -1);
  });

  it('语速可注入:charsPerSecond 逐句生效,缺省 = 全局基准 4.5', () => {
    const ir = irOf([shotOf('SHOT_001', 1, 1.0, '我是你留在这里的那一半。')]);
    const base = compileCaptions(ir);
    const slow = compileCaptions(ir, { charsPerSecond: 2.5 });
    const fast = compileCaptions(ir, { charsPerSecond: 9 });
    const dur = (t: typeof base) => t.captions[0].endMs - t.captions[0].startMs;
    expect(dur(slow)).toBeGreaterThan(dur(base));
    expect(dur(fast)).toBeLessThan(dur(base));
    expect(dur(base)).toBeCloseTo(estimateSpeechSeconds('我是你留在这里的那一半。') * 1000, -1);
    expect(DEFAULT_SPEECH_RATE).toBe(4.5);
    // 注入的慢语速同样触发拍长不足警告(估算口径一致)
    expect(slow.warnings.some(w => w.code === 'SHOT_TOO_SHORT_FOR_TTS')).toBe(true);
  });

  it('探活优先:measured 存在时窗 = 实测(不越过真实音频),超拍仍警告', () => {
    const ir = irOf(
      [shotOf('SHOT_001', 1, 1.5, '我是你留在这里的那一半。')],
      [{ id: 'aud-tts-001', kind: 'tts', shotId: 'SHOT_001', text: '我是你留在这里的那一半。', voice: 'tongtong' } as TtsClip],
    );
    const track = compileCaptions(ir, { measured: { 'aud-tts-001': 0.4 } });
    // 窗 = 探活 0.4s(真实音频权威,短于估算也不虚构语音)
    expect(track.captions[0].endMs - track.captions[0].startMs).toBe(400);
    // 但「需 Ns 朗读,拍仅 Ms」的估算警告照发(估算信号独立于探活)
    expect(track.warnings.some(w => w.code === 'SHOT_TOO_SHORT_FOR_TTS')).toBe(true);
  });

  it('#11 others 分窗共用估算函数:注入语速改变余句窗(与锚句同一出处)', () => {
    const ir = irOf(
      [shotOf('SHOT_001', 1, 3.0, '把证件照还给我。')],
      [
        { id: 'aud-tts-001', kind: 'tts', shotId: 'SHOT_001', text: '把证件照还给我。', voice: 'tongtong' } as TtsClip,
        { id: 'aud-tts-002', kind: 'tts', shotId: 'SHOT_001', text: '客人来了就说歇业。', voice: 'jam' } as TtsClip,
      ],
    );
    const base = compileCaptions(ir);
    const slow = compileCaptions(ir, { charsPerSecond: 2.5 });
    const others = (t: typeof base) =>
      t.captions.filter(c => c.text.includes('客人来了'));
    expect(others(base).length).toBeGreaterThan(0);
    expect(others(slow).length).toBeGreaterThan(0);
    const lastOf = (t: typeof base) => others(t)[others(t).length - 1]!;
    // 余句窗终点 = max(锚尾 + 朗读估算, 拍尾):注入慢语速 → 估算超拍尾 → 窗变长
    expect(lastOf(slow).endMs).toBeGreaterThan(lastOf(base).endMs);
    expect(lastOf(slow).endMs - lastOf(slow).startMs)
      .toBeGreaterThanOrEqual(estimateTextSeconds('客人来了就说歇业。', { type: 'DIALOGUE', charsPerSecond: 2.5 }) * 1000 - 1);
  });
});
