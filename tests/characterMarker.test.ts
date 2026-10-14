import { describe, it, expect } from 'vitest';
import type { ScriptBlock } from '../types';
import { sanitizeParsedBlocks } from '../utils/scriptParse';
import { parseLabeledScript, applyDirectorPipeline, splitInlineDialogue } from '../utils/blockDirectorFill';
import { collectCharacterNames, computeBeatCast, isOffScreenBlock } from '../utils/beatCast';
import { extractStoryFlowIR } from '../src/extract/screenplayToIR';

/**
 * issue #8④ — characterMarker 全链收尾:
 *   · 生成侧:sanitizeParsedBlocks 是 AI 生成块的唯一收口(CONTINUE 追加与
 *     FROM_PROMPT 建稿在 hooks/useAIExecutor 都过它)——画外 cue 在此补写
 *     结构化字段(cue 文本不动);迁移只覆盖存量,新增 cue 在此获得字段。
 *   · 提取侧消费(可选,做):isOffScreenBlock = 字段 OR 文本启发式 ——
 *     字段单独成立(文本日后清洗也不丢画外判定),方向保守(只防框入,
 *     不制造画外)。
 */

const blk = (id: string, type: ScriptBlock['type'], content: string, extra: Partial<ScriptBlock> = {}): ScriptBlock =>
  ({ id, type, content, ...extra });

describe('issue #8④ — 生成侧:sanitizeParsedBlocks 写 characterMarker(唯一收口)', () => {
  it('画外 cue 补写字段:旁白/（画外）/（V.O.）/(O.S.),cue 文本原样保留', () => {
    const out = sanitizeParsedBlocks([
      blk('a', 'SCENE_HEADING', '内. 老宅 - 夜'),
      blk('b', 'CHARACTER', '旁白'),
      blk('c', 'CHARACTER', '空椅子里的声音（画外）'),
      blk('d', 'CHARACTER', 'NARRATOR (V.O.)'),
      blk('e', 'CHARACTER', '母亲 (O.S.)'),
      blk('f', 'CHARACTER', '张三'),
      blk('g', 'DIALOGUE', '这是记忆开始的地方。'),
    ]);
    const byId = new Map(out.map(b => [b.id, b]));
    expect(byId.get('b')!.characterMarker).toBe('vo');
    expect(byId.get('c')!.characterMarker).toBe('vo');
    expect(byId.get('d')!.characterMarker).toBe('vo');
    expect(byId.get('e')!.characterMarker).toBe('os');
    expect(byId.get('f')!.characterMarker).toBeUndefined(); // 在场角色不标
    // 文本不动(编辑器显示 + 名字匹配依赖原文)
    expect(byId.get('c')!.content).toBe('空椅子里的声音（画外）');
    expect(byId.get('d')!.content).toBe('NARRATOR (V.O.)');
    // 非 CHARACTER 块不标
    expect(byId.get('g')!.characterMarker).toBeUndefined();
  });

  it('幂等:已带字段的块原样通过,重复运行零变化(无损)', () => {
    const once = sanitizeParsedBlocks([
      blk('a', 'SCENE_HEADING', '内. 老宅 - 夜'),
      blk('b', 'CHARACTER', '旁白'),
      blk('c', 'CHARACTER', '张三', { characterMarker: 'os' }),
    ]);
    const twice = sanitizeParsedBlocks(once);
    expect(twice).toEqual(once);
  });

  it('生成管线集成(CONTINUE/FROM_PROMPT 同形):labeled → director pipeline → 收口出字段', () => {
    const parsed = applyDirectorPipeline(parseLabeledScript(
      '[CHARACTER] 旁白\n[DIALOGUE] 深夜的城市从未睡去。\n[CHARACTER] 李四\n[DIALOGUE] 走吧。',
    ));
    const out = sanitizeParsedBlocks(parsed);
    const narrator = out.find(b => b.type === 'CHARACTER' && b.content === '旁白');
    const lisi = out.find(b => b.type === 'CHARACTER' && b.content === '李四');
    expect(narrator?.characterMarker).toBe('vo');
    expect(lisi?.characterMarker).toBeUndefined();
  });

  it('内联台词拆分(splitInlineDialogue)产出的画外 cue 同样被收口补写', () => {
    const mashed = [
      blk('a', 'SCENE_HEADING', '内. 老宅 - 夜'),
      blk('b', 'ACTION', '旁白：深夜的城市从未睡去。'),
    ];
    const split = splitInlineDialogue(mashed);
    expect(split.some(b => b.type === 'CHARACTER' && b.content === '旁白')).toBe(true);
    const out = sanitizeParsedBlocks(split);
    expect(out.find(b => b.type === 'CHARACTER')?.characterMarker).toBe('vo');
  });
});

describe('issue #8④ — 提取侧消费:isOffScreenBlock = 字段 OR 文本(保守方向)', () => {
  it('字段单独成立:文本已清洗的画外 cue 仍被排除出角色宇宙与在场 cast', () => {
    const marked: ScriptBlock = blk('b', 'CHARACTER', '张三', { characterMarker: 'vo' });
    expect(isOffScreenBlock(marked)).toBe(true);
    // collectCharacterNames(角色宇宙)排除 —— 宇宙即后续 cast 判定的全集
    const blocks = [
      blk('a', 'SCENE_HEADING', '内. 老宅 - 夜'),
      marked,
      blk('c', 'ACTION', '张三的声音在黑暗里响起。'),
      blk('d', 'CHARACTER', '李四'),
    ];
    const universe = collectCharacterNames(blocks);
    expect(universe).toEqual(['李四']);
    // computeBeatCast(真实宇宙口径)排除:动作文本提到张三、邻接 cue 是标记
    // 块,该拍 cast 为空(画外音在场说话但不进 cast)
    const cast = computeBeatCast(blocks, 2, universe);
    expect(cast).toEqual([]);
  });

  it('文本启发式兜底:未标记的 画外 cue 照旧排除(不回归)', () => {
    expect(isOffScreenBlock(blk('b', 'CHARACTER', '空椅子里的声音（画外）'))).toBe(true);
    expect(collectCharacterNames([
      blk('a', 'SCENE_HEADING', '内. 老宅 - 夜'),
      blk('b', 'CHARACTER', '旁白'),
      blk('c', 'CHARACTER', '张三'),
    ])).toEqual(['张三']);
  });

  it('端到端:提取 IR 不为字段画外角色建 char ref(不进画面,不要求设定图);声音仍进 TTS', () => {
    const ir = extractStoryFlowIR({
      id: 'marker-e2e',
      metadata: { title: '画外提取', author: 'agent', draft: 'First Draft', scriptLanguage: 'zh' },
      schemaVersion: 3,
      blocks: [
        blk('a', 'SCENE_HEADING', '内. 老宅 - 夜'),
        blk('b', 'ACTION', '黑暗里响起一个声音。'),
        blk('c', 'CHARACTER', '张三', { characterMarker: 'vo' }),
        blk('d', 'DIALOGUE', '这是记忆开始的地方。'),
        blk('e', 'ACTION', '李四推门而入。'),
        blk('f', 'CHARACTER', '李四'),
        blk('g', 'DIALOGUE', '走吧。'),
      ],
      lastModified: 0,
    }, [], { defaultMode: 'pro' });
    const names = ir.refs.characters.map(c => c.name);
    expect(names).toContain('李四');
    expect(names).not.toContain('张三');
    // 画外音的台词照常进 TTS(说话,只是不进画面)
    const tts = ir.audio.filter((c): c is import('../src/ir/types').TtsClip => c.kind === 'tts').map(c => c.text);
    expect(tts.some(t => t.includes('这是记忆开始的地方'))).toBe(true);
  });
});
