import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { StoryFlowIR, SfxClip } from '../src/ir/types';
import type { AlignmentTake } from '../src/ir/audio/types';
import { parseStoryFlowIR, validateStoryFlowIR } from '../src/ir/schema';
import {
  StoryFlowAnnotations, storyFlowAnnotationsSchema,
  serializeAnnotations, parseAnnotations,
} from '../src/ir/annotations';
import { renderStoryFlowXML } from '../src/ir/format/render';
import { parseStoryFlowDocument } from '../src/ir/format/parse';
import { compileAudioPlan } from '../src/ir/audio/compile';
import { applyTimingCorrections } from '../src/ir/audio/timing';

const examplePath = fileURLToPath(new URL('../docs/storyflow-ir-example.json', import.meta.url));
const example = (): StoryFlowIR =>
  parseStoryFlowIR(JSON.parse(readFileSync(examplePath, 'utf-8')));
const mutated = (fn: (ir: StoryFlowIR) => void): StoryFlowIR => {
  const ir = JSON.parse(JSON.stringify(example())) as StoryFlowIR;
  fn(ir);
  return ir;
};

const annotations = (): StoryFlowAnnotations => ({
  version: '0.1.0',
  timing: {
    'aud-tts-001': [{ tokenIndex: 10, startMs: 2150, endMs: 2230 }],
  },
  priceBooks: {
    image: { perImageFen: 20 },
    tts: { perCharFen: 2 },
    bgm: { perRequestFen: 50 },
  },
});

const takeOf = (): AlignmentTake => ({
  text: '拍一张证件照,要赶九点的火车。',
  clipId: 'aud-tts-001',
  durationMs: 3400,
  tokens: Array.from({ length: 13 }, (_, i) => ({ tokenIndex: i, startMs: i * 200, endMs: i * 200 + 180 })),
});

describe('注释契约 — zod 校验', () => {
  it('合法注释过校验;非法窗/负费率拒', () => {
    expect(storyFlowAnnotationsSchema.safeParse(annotations()).success).toBe(true);
    const badWindow = {
      version: '0.1.0',
      timing: { 'aud-tts-001': [{ tokenIndex: 0, startMs: 5, endMs: 5 }] },
    };
    expect(storyFlowAnnotationsSchema.safeParse(badWindow).success).toBe(false);
    const negative = {
      version: '0.1.0',
      timing: {},
      priceBooks: { image: { perImageFen: -1 } },
    };
    expect(storyFlowAnnotationsSchema.safeParse(negative).success).toBe(false);
  });

  it('JSON 侧车 round-trip', () => {
    const json = serializeAnnotations(annotations());
    expect(parseAnnotations(JSON.parse(json))).toEqual(annotations());
  });
});

describe('XML 携带 round-trip(v0.3 annotations 节)', () => {
  it('render{annotations} → parseStoryFlowDocument → 注释 ≡', () => {
    const ir = example();
    const xml = renderStoryFlowXML(ir, { pretty: true, annotations: annotations() });
    const doc = parseStoryFlowDocument(xml);
    expect(doc.ir).toEqual(ir);
    expect(doc.annotations).toEqual(annotations());
    expect(xml).toContain('<annotations>');
    expect(xml).toContain('<fix token-index="10" start-ms="2150" end-ms="2230"/>');
    expect(xml).toContain('<tts per-char-fen="2"/>');
  });

  it('无注释 → 零节发射(注释放棄为 undefined)', () => {
    const xml = renderStoryFlowXML(example(), { pretty: true });
    expect(xml).not.toContain('<annotations>');
    expect(parseStoryFlowDocument(xml).annotations).toBeUndefined();
  });
});

describe('消费即语义 — 注释直通编译/对齐', () => {
  it('opts.timing 校正自动套用(落点=校正窗,与手工组合等价)', () => {
    const ir = mutated(m => {
      const sfx = m.audio.find(c => c.id === 'aud-sfx-001') as SfxClip;
      sfx.anchor = { kind: 'word', wordIndex: 10 };
      sfx.shotId = 'SHOT_003';
      sfx.missing = false;
    });
    const plan = compileAudioPlan(ir, {
      alignments: { 'aud-tts-001': takeOf() },
      timing: annotations().timing,
    });
    expect(plan.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(2150);
    // 非法校正 → TIMING_INVALID 警告 + 字素回退,不中断
    const bad = compileAudioPlan(ir, {
      alignments: { 'aud-tts-001': takeOf() },
      timing: { 'aud-tts-001': [{ tokenIndex: 99, startMs: 0, endMs: 1 }] },
    });
    expect(bad.warnings.some(w => w.code === 'TIMING_INVALID')).toBe(true);
    expect(bad.timeline.find(e => e.clipId === 'aud-sfx-001')?.startMs).toBe(2000);
  });

  it('applyTimingCorrections:批量套用 + 无对齐件隔离', () => {
    const { alignments, invalid } = applyTimingCorrections(
      { 'aud-tts-001': takeOf() },
      { 'aud-tts-001': [{ tokenIndex: 0, startMs: 5, endMs: 10 }], 'aud-tts-404': [{ tokenIndex: 0, startMs: 0, endMs: 1 }] },
    );
    expect(alignments['aud-tts-001'].tokens[0]).toMatchObject({ startMs: 5, confidence: 1 });
    expect(invalid).toEqual([{ clipId: 'aud-tts-404', error: expect.stringMatching(/无对齐件/) }]);
  });

  it('priceBooks 直通 P9 计价(注释费率 = 结算费率)', async () => {
    const { audioCostReport, settleAudioRun } = await import('../src/exec/pricing');
    const plan = compileAudioPlan(example());
    const books = annotations().priceBooks;
    const report = audioCostReport(plan, books);
    const tts1 = plan.jobs.find(j => j.clipId === 'aud-tts-001') as { text: string };
    expect(report.totalCostFen).toBeGreaterThanOrEqual(tts1.text.length * 2); // 字符计价在总额内
    expect(settleAudioRun(plan, {
      clipBlobs: { 'aud-tts-001': new Blob(['x']), 'aud-tts-002': new Blob(['y']) },
      measurements: {}, sfxResolutions: {}, bgmUrls: { 'aud-bgm-001': 'b' }, failures: [],
    }, books).chargedCostFen).toBeGreaterThan(0);
  });

  it('差异化价目 XML 携带 round-trip(分册属性,兼容兜底)', () => {
    const ann = annotations();
    ann.priceBooks = { image: { perImageFen: 20, fal: { perImageFen: 50 } } };
    const xml = renderStoryFlowXML(example(), { pretty: true, annotations: ann });
    expect(xml).toContain('per-image-fen="20"');
    expect(xml).toContain('fal-per-image-fen="50"');
    const doc = parseStoryFlowDocument(xml);
    expect(doc.annotations?.priceBooks?.image).toEqual({ perImageFen: 20, fal: { perImageFen: 50 } });
    // 仅分册无兜底
    const ann2 = annotations();
    ann2.priceBooks = { image: { minimax: { perImageFen: 15 } } };
    const doc2 = parseStoryFlowDocument(renderStoryFlowXML(example(), { annotations: ann2 }));
    expect(doc2.annotations?.priceBooks?.image).toEqual({ minimax: { perImageFen: 15 } });
  });
});
