import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, Shot } from '../src/ir/types';
import type { AlignmentTake } from '../src/ir/audio/types';
import { parseStoryFlowIR } from '../src/ir/schema';
import { compileCaptions } from '../src/captions/compile';
import { toSrt, toVtt } from '../src/captions/serialize';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

const LINE = '拍一张证件照,要赶九点的火车。';

describe('compileCaptions — 断句与时基', () => {
  it('银盐晨光缺省:句内不断 → 每对白镜头 1 条,片内绝对时基', () => {
    const track = compileCaptions(example());
    expect(track.captions.map(c => [c.text, c.startMs, c.endMs])).toEqual([
      ['拍一张证件照,要赶九点的火车。', 11000, 17000], // 片偏移 6+5s,字素 basis 6s
      ['好,坐那边,光正好。', 17000, 22000],             // 片偏移 6+5+6s,basis 5s
    ]);
    expect(track.captions[0].character).toBe('陈默');
    expect(track.captions[0].shotId).toBe('SHOT_003');
  });

  it('句末标点断句:一句一条', () => {
    const ir = mutated(m => {
      (m.shots[2] as Shot).dialogue = { text: '拍一张证件照。再拍一张半身。', ttsFloor: 4 };
    });
    const track = compileCaptions(ir);
    const texts = track.captions.filter(c => c.shotId === 'SHOT_003').map(c => c.text);
    // issue #11 全对白覆盖:锚行两条 + 旧锚 clip(文本与改后对白不再相等,
    // 作为非锚 clip 照常覆盖——TTS 也会合成它,字幕与音频一致)
    expect(texts).toEqual(['拍一张证件照。', '再拍一张半身。', '拍一张证件照,要赶九点的火车。']);
  });

  it('行宽上限在 token 边界强制收口', () => {
    const ir = mutated(m => {
      (m.shots[2] as Shot).dialogue = { text: '这一句特别长没有标点所以只能按行宽强制收口处理', ttsFloor: 4 };
    });
    const track = compileCaptions(ir, { maxCharsPerCaption: 16 });
    const caps = track.captions.filter(c => c.shotId === 'SHOT_003');
    // 锚行两条 + 非锚旧锚 clip(issue #11 全对白覆盖)
    expect(caps.map(c => c.text)).toEqual([
      '这一句特别长没有标点所以只能按行', // 16 字
      '宽强制收口处理',
      '拍一张证件照,要赶九点的火车。',
    ]);
  });

  it('无对白镜头零字幕(motion 是画面叙述不是台词)', () => {
    const track = compileCaptions(example());
    expect(track.captions.every(c => c.shotId !== 'SHOT_001')).toBe(true);
    expect(track.captions).toHaveLength(2);
  });

  it('最短可读时长只警告不合并', () => {
    const ir = mutated(m => {
      (m.shots[2] as Shot).dialogue = { text: '好。', ttsFloor: 4 };
      // 锚行文本同步(否则锚匹配失败 → 回退 wantSeconds,警告不触发)
      const clip = m.audio.find(c => c.id === 'aud-tts-001') as { text: string };
      clip.text = '好。';
    });
    const track = compileCaptions(ir, { measured: { 'aud-tts-001': 3.4 } });
    // basis = measured 3.4s;单词 caption 窗 ≈ 3400ms > 600 —— 换更短探活
    const short = compileCaptions(ir, { measured: { 'aud-tts-001': 0.4 } });
    expect(short.warnings.some(w => w.code === 'CAPTION_TOO_SHORT')).toBe(true); // 单词窗 400ms < 600
    void track;
  });
});

describe('compileCaptions — 对齐窗优先与校正直通', () => {
  it('对齐窗优先于字素;校时(P10)先套后分', () => {
    const ir = example();
    const take: AlignmentTake = {
      text: LINE,
      clipId: 'aud-tts-001',
      durationMs: 3400,
      tokens: Array.from({ length: 13 }, (_, i) => ({
        tokenIndex: i, startMs: i * 200, endMs: i * 200 + 180,
      })),
    };
    const track = compileCaptions(ir, { alignments: { 'aud-tts-001': take } });
    const c = track.captions[0];
    expect(c.startMs).toBe(11000 + 0); // 首词窗起点 + 拼杆/片偏移
    expect(c.endMs).toBe(11000 + 12 * 200 + 180); // 末词窗终点

    // P10 校时直通:token 0 校正窗 → 字幕起点跟随
    const fixed = compileCaptions(ir, {
      alignments: { 'aud-tts-001': take },
      timing: { 'aud-tts-001': [{ tokenIndex: 0, startMs: 50, endMs: 150 }] },
    });
    expect(fixed.captions[0].startMs).toBe(11000 + 50);
  });

  it('measured 探活作字素回退 basis', () => {
    const track = compileCaptions(example(), { measured: { 'aud-tts-001': 3.0 } });
    expect(track.captions[0].endMs).toBe(11000 + 3000); // basis 3s(非 wantSeconds 6s)
  });
});

describe('compileCaptions — 拼杆与说话人', () => {
  it('多台词镜头:拼杆序多条字幕;speakerPrefix 可选', () => {
    const ir = mutated(m => {
      (m.audio as unknown as { unshift: (c: unknown) => void }).unshift({
        id: 'aud-tts-009', kind: 'tts', shotId: 'SHOT_003', text: '先来一句。',
        voice: 'jam', measuredSeconds: 1.5,
      });
      m.audio.push({
        id: 'aud-tts-003', kind: 'tts', shotId: 'SHOT_003', text: '再拍一张。',
        voice: 'jam', measuredSeconds: 1.2,
      } as never);
      // 锚行 = 与 dialogue.text 逐字相等的 aud-tts-001,位于 aud-tts-009 之后
    });
    // extra 在锚之前(unshift)→ 锚的拼杆偏移 = 1.5s(拼杆序 = IR 数组序)
    const track = compileCaptions(ir, { speakerPrefix: true });
    const shot3 = track.captions.filter(c => c.shotId === 'SHOT_003');
    // issue #11 全对白覆盖:锚行 + 非锚 clip(先来一句/再拍一张)都进字幕
    expect(shot3.map(c => c.text)).toEqual([
      '陈默：拍一张证件照,要赶九点的火车。',
      '先来一句。',
      '再拍一张。',
    ]);
    expect(shot3[0].startMs).toBe(11000 + 1500); // 拼杆偏移 1.5s(extra 在锚前)
  });

  it('无对齐件且无探活 → 字素回退恒可用(basis = wantSeconds)', () => {
    const ir = mutated(m => {
      const clip = m.audio.find(c => c.id === 'aud-tts-001') as { measuredSeconds?: number };
      delete clip.measuredSeconds;
    });
    const track = compileCaptions(ir, { measured: {} });
    const cap = track.captions.find(c => c.shotId === 'SHOT_003')!;
    expect(cap.startMs).toBe(11000);
    expect(cap.endMs).toBe(11000 + 6000); // wantSeconds 6s
  });
});

describe('toSrt / toVtt — 外挂字幕序列化', () => {
  const track = compileCaptions(example());

  it('SRT:序号 + 逗号毫秒 + CRLF', () => {
    const srt = toSrt(track);
    expect(srt).toBe(
      '1\r\n00:00:11,000 --> 00:00:17,000\r\n[陈默]拍一张证件照,要赶九点的火车。\r\n\r\n' +
      '2\r\n00:00:17,000 --> 00:00:22,000\r\n[苏晚]好,坐那边,光正好。\r\n',
    );
  });

  it('VTT:WEBVTT 头 + 点毫秒 + LF', () => {
    const vtt = toVtt(track);
    expect(vtt).toBe(
      'WEBVTT\n\n1\n00:00:11.000 --> 00:00:17.000\n[陈默]拍一张证件照,要赶九点的火车。\n\n' +
      '2\n00:00:17.000 --> 00:00:22.000\n[苏晚]好,坐那边,光正好。\n',
    );
  });
});
