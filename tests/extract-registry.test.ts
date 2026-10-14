import { describe, it, expect } from 'vitest';
import type { Screenplay, ScriptBlock } from '../types';
import { extractStoryFlowIR } from '../src/extract/screenplayToIR';
import { validateStoryFlowIR } from '../src/ir/schema';
import { estimateSpeechSeconds } from '../utils/timing/estimate';

/**
 * issue #8③ — 提取器读 schemaVersion 分流 + characterSheets registry 消费;
 * issue #13 — 提取层语速注入点(extract opts → 拍长合成,按稿/按拍)。
 *
 * ③ 的口径:schemaVersion ≥ 3 时块只存增量、CHARACTER sheet 全剧一份存
 * `characterSheets`(键 = cue 原文)——拍内缺 inline imagePrompt 时提取查
 * registry(设定图作首帧 prompt),不再落回「前缀+cue 文本」的废 prompt;
 * v1/v2(无 registry 契约)保持块内联权威,行为不变。
 */

const b = (id: string, type: ScriptBlock['type'], content: string, extra: Partial<ScriptBlock> = {}): ScriptBlock =>
  ({ id, type, content, ...extra });

const sp = (over: Partial<Screenplay> = {}): Screenplay => ({
  id: 'reg-1',
  metadata: {
    title: '设定图提取', author: 'agent', draft: 'First Draft', scriptLanguage: 'zh',
    styleHead: {
      name: '水墨', artStyle: '水墨动画', scenePreset: '古镇',
      promptPrefix: 'ink-wash animation style, ',
    },
  },
  blocks: [
    b('s0', 'SCENE_HEADING', '内. 老街 - 黄昏'),
    b('s1', 'CHARACTER', '陈默'),
    b('s2', 'DIALOGUE', '今天不营业。'),
  ],
  lastModified: 0,
  ...over,
});

describe('issue #8③ — 提取读 schemaVersion 分流 + characterSheets registry 消费', () => {
  it('v3:拍内缺 inline imagePrompt 时查 registry(设定图 = 首帧 prompt,缺前缀治愈)', () => {
    const ir = extractStoryFlowIR(sp({
      schemaVersion: 3,
      characterSheets: { '陈默': 'close-up portrait of a man in an old-work-jacket, warm eyes' },
    }), [], { defaultMode: 'pro' });
    const shot = ir.shots.find(s => s.character === '陈默')!;
    expect(shot).toBeTruthy();
    expect(shot.imagePrompt).toBe('ink-wash animation style, close-up portrait of a man in an old-work-jacket, warm eyes');
    const v = validateStoryFlowIR(ir);
    if (!v.ok) throw new Error(`IR must validate:\n${(v as { issues: string[] }).issues.join('\n')}`);
  });

  it('v3 变体槽位:cue「苏晚（晨雾围巾）」只命中自己的 registry 键(不回退基础名)', () => {
    const ir = extractStoryFlowIR(sp({
      schemaVersion: 3,
      characterSheets: { '苏晚': 'base sheet', '苏晚（晨雾围巾）': 'variant sheet with mist-grey scarf' },
      blocks: [
        b('s0', 'SCENE_HEADING', '内. 老街 - 黄昏'),
        b('s1', 'CHARACTER', '苏晚（晨雾围巾）'),
        b('s2', 'DIALOGUE', '好,坐那边。'),
      ],
    }), [], { defaultMode: 'pro' });
    const shot = ir.shots.find(s => s.dialogue?.text === '好,坐那边。')!;
    expect(shot.imagePrompt).toContain('variant sheet with mist-grey scarf');
    expect(shot.imagePrompt).not.toContain('base sheet');
  });

  it('v3 内联优先:拍内已有 imagePrompt 时不查 registry(增量块不受影响)', () => {
    const ir = extractStoryFlowIR(sp({
      schemaVersion: 3,
      characterSheets: { '陈默': 'registry sheet' },
      blocks: [
        b('s0', 'SCENE_HEADING', '内. 老街 - 黄昏'),
        b('s1', 'ACTION', '陈默推门而入。', { imagePrompt: 'inline increment prompt' }),
        b('s2', 'CHARACTER', '陈默'),
        b('s3', 'DIALOGUE', '今天不营业。'),
      ],
    }), [], { defaultMode: 'pro' });
    const shot = ir.shots.find(s => s.dialogue?.text === '今天不营业。')!;
    expect(shot.imagePrompt).toBe('ink-wash animation style, inline increment prompt');
  });

  it('v1/v2 分流:无 registry 契约 → registry 不参与,保持「前缀+拍文本」旧行为', () => {
    const screenplay = sp({
      // schemaVersion 缺省 = 1;即便带了一份 registry(手补/半迁移稿)也不消费
      characterSheets: { '陈默': 'legacy registry sheet' },
    });
    delete (screenplay as { schemaVersion?: number }).schemaVersion;
    const ir = extractStoryFlowIR(screenplay, [], { defaultMode: 'pro' });
    const shot = ir.shots.find(s => s.character === '陈默')!;
    expect(shot.imagePrompt).not.toContain('legacy registry sheet');
    // 旧行为:cue/对白块被空镜拍吸收,拍文本 = 场景标题 → 前缀+标题兜底
    expect(shot.imagePrompt).toBe('ink-wash animation style, 内. 老街 - 黄昏');
  });
});

describe('issue #13 — 提取层语速注入点(opts.charsPerSecond → 拍长合成)', () => {
  const blocks = [
    b('s0', 'SCENE_HEADING', '内. 老街 - 黄昏'),
    b('s1', 'ACTION', '夕阳穿过老街，尘埃浮动。'),
    b('s2', 'CHARACTER', '陈默'),
    b('s3', 'DIALOGUE', '今天不营业。'),
  ];

  it('缺省 = 全局基准 4.5;注入慢语速 → estimated 拍变长(按拍可注入)', () => {
    const base = extractStoryFlowIR(sp({ schemaVersion: 3, blocks }), [], { defaultMode: 'pro' });
    const slow = extractStoryFlowIR(sp({ schemaVersion: 3, blocks }), [], { defaultMode: 'pro', charsPerSecond: 2 });
    const baseBeat = base.shots.find(s => s.dialogue?.text === '今天不营业。')!;
    const slowBeat = slow.shots.find(s => s.dialogue?.text === '今天不营业。')!;
    expect(slowBeat.shotDuration).toBeGreaterThan(baseBeat.shotDuration);
    // 拍长覆盖其对白朗读估算(慢语速口径)
    expect(slowBeat.shotDuration).toBeGreaterThanOrEqual(
      estimateSpeechSeconds('今天不营业。', { charsPerSecond: 2 }) - 0.5,
    );
  });
});
