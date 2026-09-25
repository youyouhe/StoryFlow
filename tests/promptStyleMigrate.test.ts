import { describe, it, expect } from 'vitest';
import { migrateScreenplay } from '../utils/screenplayMigrate';
import { stripStylePrefix, composeBlockImagePrompt, characterSheetOf, hasImagePayload } from '../utils/promptStyle';
import type { Screenplay, ScriptBlock } from '../types';

/**
 * issue #8 — 剧本 JSON 去冗余(schemaVersion 3):
 *   ① styleHead 前缀不落库,读时从当前 styleHead 合成(改头即全剧跟随)
 *   ② 角色 sheet 全剧一份(注册表),块引用不复制
 *   ③ 画外音结构化 extension 字段
 *   ④ 旧 localStorage 数据无损幂等迁移
 */

const PREFIX = 'live-action 35mm film cinematography, muted palette';
const sp = (over: Partial<Screenplay> = {}): Screenplay => ({
  id: 't1',
  metadata: { title: 'T', author: 'a', draft: '1', scriptLanguage: 'zh',
    styleHead: { name: '银盐晨光', artStyle: '胶片', scenePreset: '厨房', promptPrefix: PREFIX } },
  blocks: [],
  schemaVersion: 2,
  lastModified: 0,
  ...over,
});
const blk = (id: string, type: ScriptBlock['type'], content: string, extra: Partial<ScriptBlock> = {}): ScriptBlock =>
  ({ id, type, content, ...extra });

describe('stripStylePrefix', () => {
  it('strips ONE leading Global Style line, keeps the increment', () => {
    const stored = `Global Style: ${PREFIX}\nSubject: a mother slides a cup\nMood: warm`;
    expect(stripStylePrefix(stored)).toBe('Subject: a mother slides a cup\nMood: warm');
  });
  it('idempotent — a bare increment passes through', () => {
    expect(stripStylePrefix('Subject: x')).toBe('Subject: x');
  });
  it('does not touch a Global Style mention mid-body', () => {
    expect(stripStylePrefix('Subject: says "Global Style:" out loud\nMood: x')).toContain('Global Style:');
  });
});

describe('migrateScreenplay — v2 → v3, pure + idempotent', () => {
  it('strips inline prefixes and moves CHARACTER sheets into the registry (first wins)', () => {
    const sheet = `Global Style: ${PREFIX}\nIdentity: 母亲 — adult woman\nMain: turnaround`;
    const doc = sp({
      blocks: [
        blk('s', 'SCENE_HEADING', '清晨厨房', { imagePrompt: `Global Style: ${PREFIX}\nSubject: kitchen` }),
        blk('c1', 'CHARACTER', '母亲（微笑）', { imagePrompt: sheet }),
        blk('c2', 'CHARACTER', '母亲（微笑）', { imagePrompt: `Global Style: ${PREFIX}\nIdentity: 母亲 — adult woman\nMain: turnaround` }),
        blk('a', 'ACTION', '推杯', { imagePrompt: `Global Style: ${PREFIX}\nSubject: cup` }),
      ],
    });
    const out = migrateScreenplay(doc);
    expect(out.schemaVersion).toBe(3);
    // registry holds ONE copy per cue slot
    expect(Object.keys(out.characterSheets!)).toEqual(['母亲（微笑）']);
    expect(out.characterSheets!['母亲（微笑）']).not.toContain('Global Style:');
    expect(out.characterSheets!['母亲（微笑）']).toContain('Identity: 母亲');
    // blocks: no inline copies, prefixes gone
    for (const b of out.blocks) {
      expect(b.imagePrompt?.startsWith('Global Style:')).toBeFalsy();
      if (b.type === 'CHARACTER') expect(b.imagePrompt).toBeUndefined();
    }
    // SCENE/ACTION keep their bare increments
    expect(out.blocks[0].imagePrompt).toBe('Subject: kitchen');
    expect(out.blocks[3].imagePrompt).toBe('Subject: cup');
  });

  it('idempotent: migrating a v3 doc is a no-op', () => {
    const once = migrateScreenplay(sp({
      characterSheets: { '女儿': 'Identity: 女儿' },
      blocks: [blk('c', 'CHARACTER', '女儿'), blk('a', 'ACTION', 'x', { imagePrompt: 'Subject: x' })],
    }));
    const twice = migrateScreenplay(once);
    expect(twice).toEqual(once);
  });

  it('sets characterMarker on off-screen cues, keeps the cue text (display + 名字匹配依赖原文)', () => {
    const out = migrateScreenplay(sp({
      blocks: [blk('v', 'CHARACTER', '空椅子里的声音（画外）'), blk('n', 'CHARACTER', 'NARRATOR (O.S.)'), blk('p', 'CHARACTER', '母亲（微笑）')],
    }));
    expect(out.blocks[0].characterMarker).toBe('vo');
    expect(out.blocks[1].characterMarker).toBe('os');
    expect(out.blocks[2].characterMarker).toBeUndefined();
    expect(out.blocks[0].content).toBe('空椅子里的声音（画外）'); // text preserved
  });

  it('preserves director fields + speaker through migration (无损)', () => {
    const out = migrateScreenplay(sp({
      blocks: [blk('a', 'ACTION', '00:00-00:03。推门', {
        motionPrompt: '门摆', shotDuration: 3, firstFrameDesc: 'F', lastFrameDesc: 'L',
      })],
    }));
    expect(out.blocks[0]).toMatchObject({ motionPrompt: '门摆', shotDuration: 3, firstFrameDesc: 'F', lastFrameDesc: 'L' });
  });
});

describe('composeBlockImagePrompt — 读时合成(改 styleHead 即时跟随)', () => {
  const v3 = (blocks: ScriptBlock[], characterSheets?: Record<string, string>): Screenplay =>
    migrateScreenplay(sp({ blocks, ...(characterSheets ? { characterSheets } : {}) }));

  it('prepends the CURRENT styleHead prefix to a stored increment', () => {
    const doc = v3([blk('a', 'ACTION', '推杯', { imagePrompt: 'Subject: cup' })]);
    expect(composeBlockImagePrompt(doc.blocks[0], doc)).toBe(`Global Style: ${PREFIX}\nSubject: cup`);
  });

  it('editing styleHead.promptPrefix updates EVERY existing block (验收①)', () => {
    const doc = v3([blk('a', 'ACTION', '推杯', { imagePrompt: 'Subject: cup' })]);
    const restyled = {
      ...doc,
      metadata: { ...doc.metadata, styleHead: { ...doc.metadata.styleHead!, promptPrefix: 'ink-wash painting, rice paper texture' } },
    };
    const composed = composeBlockImagePrompt(restyled.blocks[0], restyled);
    expect(composed.startsWith('Global Style: ink-wash painting')).toBe(true);
    expect(composed).toContain('Subject: cup');
  });

  it('CHARACTER resolves its sheet from the registry (验收②: 全剧一份)', () => {
    const doc = v3(
      [blk('c1', 'CHARACTER', '母亲（微笑）'), blk('c2', 'CHARACTER', '母亲（微笑）')],
      { '母亲（微笑）': 'Identity: 母亲' },
    );
    // both cues read the SAME single stored sheet
    expect(characterSheetOf(doc.blocks[0], doc)).toBe('Identity: 母亲');
    expect(characterSheetOf(doc.blocks[1], doc)).toBe('Identity: 母亲');
    expect(composeBlockImagePrompt(doc.blocks[1], doc)).toBe(`Global Style: ${PREFIX}\nIdentity: 母亲`);
    expect(hasImagePayload(doc.blocks[1], doc)).toBe(true);
  });

  it('never double-prefixes an un-migrated inline prompt', () => {
    const doc = sp({ blocks: [blk('a', 'ACTION', 'x', { imagePrompt: `Global Style: old-prefix\nSubject: y` })] });
    expect(composeBlockImagePrompt(doc.blocks[0], doc)).toBe(`Global Style: old-prefix\nSubject: y`);
  });

  it('no styleHead → bare increment (no fabricated prefix)', () => {
    const doc = migrateScreenplay(sp({
      metadata: { title: 'T', author: 'a', draft: '1', scriptLanguage: 'zh' },
      blocks: [blk('a', 'ACTION', 'x', { imagePrompt: 'Subject: y' })],
    }));
    expect(composeBlockImagePrompt(doc.blocks[0], doc)).toBe('Subject: y');
  });
});
