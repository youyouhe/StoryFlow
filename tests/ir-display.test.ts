import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, Shot, SfxClip } from '../src/ir/types';
import { parseStoryFlowIR, validateStoryFlowIR } from '../src/ir/schema';
import { renderStoryFlowXML } from '../src/ir/format/render';
import { parseStoryFlowDocument } from '../src/ir/format/parse';
import { compileCaptions } from '../src/captions/compile';
import { anchorTextOf, splitAnchorWords } from '../src/ir/shared';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const goldenPath = fileURLToPath(new URL('../docs/storyflow-xml-example.xml', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const golden = (): string => readFileSync(goldenPath, 'utf8').replace(/\n$/, '');
const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

const DISPLAY = '证件照,加急。||再来一张半身。';
const displayShot = (): StoryFlowIR =>
  mutated(m => {
    (m.shots[2] as Shot).dialogue = {
      text: '拍一张证件照,要赶九点的火车。',
      display: DISPLAY,
      ttsFloor: 4,
    };
  });

describe('IR additive — dialogue.display(P12)', () => {
  it('display 过校验;缺省/一体形状零变化;0.2.0 旧档照常通过', () => {
    const v = validateStoryFlowIR(displayShot());
    if (!v.ok) throw new Error((v as { issues: string[] }).issues.join('\n'));
    const ir = example();
    expect(ir.shots[2].dialogue!.display).toBeUndefined(); // v0.2 形状缺省
    expect(validateStoryFlowIR({ ...ir, version: '0.2.0' }).ok).toBe(true);
    expect(validateStoryFlowIR({ ...ir, version: '0.1.0' }).ok).toBe(true);
  });

  it('词锚基文本仍是朗读 text(显读分离不动 P0 规则二)', () => {
    const ir = displayShot();
    const base = anchorTextOf(ir.shots[2]);
    expect(base).toEqual({ text: '拍一张证件照,要赶九点的火车。', source: 'dialogue' });
    expect(splitAnchorWords(base.text)).toHaveLength(13); // 朗读分词,非显示
  });
});

describe('XML round-trip — say 属性 + 显示文本', () => {
  it('显读分离:say 载朗读、文本载显示(|| 保留)', () => {
    const ir = displayShot();
    const xml = renderStoryFlowXML(ir, { pretty: true });
    expect(xml).toContain('<role name="陈默" say="拍一张证件照,要赶九点的火车。">证件照,加急。||再来一张半身。</role>');
    const doc = parseStoryFlowDocument(xml);
    expect(doc.ir).toEqual(ir); // 双向互换含 display
  });

  it('显读一体 → v0.2 形状零变化(无 say 属性)', () => {
    const xml = renderStoryFlowXML(example(), { pretty: true });
    expect(xml).toContain('<role name="陈默">拍一张证件照,要赶九点的火车。</role>');
    expect(xml).not.toContain('say=');
    expect(renderStoryFlowXML(parseStoryFlowDocument(golden()).ir, { pretty: true })).toBe(golden());
  });

  it('词锚标记边界:display + 词锚 SFX 同镜头 → 标记随 say 属性', () => {
    const ir = mutated(m => {
      (m.shots[2] as Shot).dialogue = {
        text: '拍一张证件照,要赶九点的火车。',
        display: '证件照,加急。',
        ttsFloor: 4,
      };
      const sfx = m.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
      sfx.anchor = { kind: 'word', wordIndex: 10 };
      sfx.shotId = 'SHOT_003';
      sfx.missing = false;
    });
    const xml = renderStoryFlowXML(ir, { pretty: true });
    // 标记在 say 属性内(朗读 token 序),display 文本无标记
    expect(xml).toMatch(/say="[^"]*\@\{sfx-001!\}[^"]*"/); // 标记在 say 属性内(朗读 token 序)
    const doc = parseStoryFlowDocument(xml);
    const sfx = doc.ir.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
    expect(sfx.anchor).toEqual({ kind: 'word', wordIndex: 10 }); // 从 say 恢复
  });
});

describe('字幕编译器 — ||-first(作者断句兑现)', () => {
  it('display ≠ spoken:作者断句优先,窗按显示字素比例分配', () => {
    const track = compileCaptions(displayShot(), {
      alignments: {
        'aud-tts-001': {
          text: '拍一张证件照,要赶九点的火车。',
          clipId: 'aud-tts-001',
          durationMs: 2580,
          tokens: Array.from({ length: 13 }, (_, i) => ({
            tokenIndex: i, startMs: i * 200, endMs: i * 200 + 180,
          })),
        },
      },
    });
    const caps = track.captions.filter(c => c.shotId === 'SHOT_003');
    expect(caps.map(c => c.text)).toEqual(['证件照,加急。', '再来一张半身。']);
    // 朗读总窗 [0, 2580](片偏移 11000)按显示字素 7:7 平分
    expect(caps[0].startMs).toBe(11000);
    expect(caps[0].endMs).toBe(11000 + 1290);
    expect(caps[1].startMs).toBe(11000 + 1290);
    expect(caps[1].endMs).toBe(11000 + 2580);
  });

  it('朗读侧零变化:词窗与 karaoke 仍按 spoken(P0 规则二回归锁)', () => {
    const ir = displayShot();
    const base = anchorTextOf(ir.shots[2]);
    const track = compileCaptions(ir, {
      alignments: {
        'aud-tts-001': {
          text: base.text,
          clipId: 'aud-tts-001',
          durationMs: 2580,
          tokens: Array.from({ length: 13 }, (_, i) => ({
            tokenIndex: i, startMs: i * 200, endMs: i * 200 + 180,
          })),
        },
      },
    });
    // SFX 词锚(朗读 token 10)落点不受 display 影响 —— ② 域回归由既有测试锁定
    expect(splitAnchorWords(base.text)).toHaveLength(13);
    expect(track.captions.filter(c => c.shotId === 'SHOT_003')).toHaveLength(2);
  });

  it('display 缺省 → P11 原路逐字节回归', () => {
    const track = compileCaptions(example());
    expect(track.captions.map(c => [c.text, c.startMs])).toEqual([
      ['拍一张证件照,要赶九点的火车。', 11000],
      ['好,坐那边,光正好。', 17000],
    ]);
  });
});
