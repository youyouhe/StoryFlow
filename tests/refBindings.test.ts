import { describe, it, expect } from 'vitest';
import { RefBindings, RefImage, ScriptBlock } from '../types';
import {
  normIdentity,
  resolveRefBindings,
  writeRefBindings,
  resolveCharacterSheet,
  resolveFrameRefs,
  resolveActionRef,
  resolveBeatRefs,
} from '../utils/refBindings';

const blk = (id: string, type: ScriptBlock['type'], content: string): ScriptBlock => ({ id, type, content });

const img = (id: string, subject: string | undefined, extra: Partial<RefImage> = {}): RefImage => ({
  id, name: `${id}.png`, type: 'image/png', size: 1, createdAt: 0, url: '', subject, ...extra,
});

describe('normIdentity', () => {
  it('parses the slash form (library convention)', () => {
    expect(normIdentity('女主/浴袍')).toEqual({ base: '女主', variant: '浴袍' });
  });

  it('parses the paren form (script cue convention)', () => {
    expect(normIdentity('女主（浴袍）')).toEqual({ base: '女主', variant: '浴袍' });
  });

  it('parses a bare name and tolerates blanks / missing input', () => {
    expect(normIdentity('女主')).toEqual({ base: '女主' });
    expect(normIdentity('女主/')).toEqual({ base: '女主', variant: undefined });
    expect(normIdentity('  女主 / 浴袍 ')).toEqual({ base: '女主', variant: '浴袍' });
    expect(normIdentity('')).toEqual({ base: '' });
    expect(normIdentity(undefined)).toEqual({ base: '' });
  });
});

describe('resolveRefBindings — effective view', () => {
  const base: RefBindings = {
    characters: { 张三: 'a1' },
    environment: 'env1',
    scenes: { '内. 浴室': { characters: { 张三: 'a2' } } },
  };

  it('returns an empty structure for undefined input', () => {
    expect(resolveRefBindings(undefined)).toEqual({ characters: {} });
  });

  it('returns the base view when no scene is asked', () => {
    const eff = resolveRefBindings(base);
    expect(eff.characters).toEqual({ 张三: 'a1' });
    expect(eff.environment).toBe('env1');
  });

  it('per-scene character overrides win; inherited env rides through', () => {
    const eff = resolveRefBindings(base, '内. 浴室');
    expect(eff.characters['张三']).toBe('a2');
    expect(eff.environment).toBe('env1');
  });

  it('per-scene environment override wins', () => {
    const b: RefBindings = {
      ...base,
      scenes: { '内. 浴室': { environment: 'env2' } },
    };
    expect(resolveRefBindings(b, '内. 浴室').environment).toBe('env2');
  });
});

describe('writeRefBindings', () => {
  it('script-wide write replaces defaults and KEEPS scene overrides', () => {
    const current: RefBindings = {
      characters: { 张三: 'a1' },
      scenes: { '内. 浴室': { characters: { 张三: 'a2' } } },
    };
    const next = writeRefBindings(current, undefined, false, { characters: { 张三: 'a9' } });
    expect(next.characters['张三']).toBe('a9');
    expect(next.scenes?.['内. 浴室']?.characters?.['张三']).toBe('a2');
  });

  it('sceneOnly write stores ONLY keys that differ from the script default', () => {
    const current: RefBindings = { characters: { 张三: 'a1' } };
    const next = writeRefBindings(current, '内. 浴室', true, { characters: { 张三: 'a1', 李四: 'b1' } });
    // 张三 equals the default → dropped from the override (falls back cleanly)
    expect(next.scenes?.['内. 浴室']?.characters).toEqual({ 李四: 'b1' });
    expect(next.characters['张三']).toBe('a1');
  });

  it('sceneOnly environment override is stored only when it differs', () => {
    const current: RefBindings = { characters: {}, environment: 'env1' };
    const same = writeRefBindings(current, '内. 浴室', true, { characters: {}, environment: 'env1' });
    expect(same.scenes).toBeUndefined();
    const diff = writeRefBindings(current, '内. 浴室', true, { characters: {}, environment: 'env2' });
    expect(diff.scenes?.['内. 浴室']?.environment).toBe('env2');
  });

  it('an all-default scene write deletes the scene entry entirely', () => {
    const current: RefBindings = {
      characters: { 张三: 'a1' },
      scenes: { '内. 浴室': { characters: { 张三: 'a2' } } },
    };
    const next = writeRefBindings(current, '内. 浴室', true, { characters: { 张三: 'a1' } });
    expect(next.scenes?.['内. 浴室']).toBeUndefined();
    expect(next.scenes).toBeUndefined(); // no scenes left → key dropped
  });
});

describe('resolveCharacterSheet', () => {
  const aBase = img('a_base', '女主');
  const aVariant = img('a_variant', '女主/浴袍');
  const aAge = img('a_age', '女主/晚年');
  const elder = img('elder', '莫长老');
  const renamed = img('renamed', undefined, { name: '女主（黑白条纹）-gen-mu84fh6x.png' });

  it('returns undefined for empty/unknown names', () => {
    expect(resolveCharacterSheet('', undefined, [aBase])).toBeUndefined();
    expect(resolveCharacterSheet('路人', undefined, [aBase])).toBeUndefined();
  });

  it('precedence 1: an explicit binding wins over identity search', () => {
    const b: RefBindings = { characters: { 女主: elder.id } };
    expect(resolveCharacterSheet('女主', b, [aBase, elder])?.id).toBe('elder');
  });

  it('precedence: the per-variant binding key (女主/浴袍) beats the base binding', () => {
    const b: RefBindings = { characters: { 女主: aBase.id, '女主/浴袍': aVariant.id } };
    expect(resolveCharacterSheet('女主', b, [aBase, aVariant], undefined, undefined, '浴袍')?.id).toBe('a_variant');
  });

  it('a BASE binding may masquerade as a costume when NOT strict', () => {
    const b: RefBindings = { characters: { 女主: aBase.id } };
    expect(resolveCharacterSheet('女主', b, [aBase, aVariant], undefined, undefined, '浴袍')?.id).toBe('a_base');
  });

  it('strictVariant: a base binding is rejected — the tagged asset wins', () => {
    const b: RefBindings = { characters: { 女主: aBase.id } };
    expect(
      resolveCharacterSheet('女主', b, [aBase, aVariant], undefined, undefined, '浴袍', { strictVariant: true })?.id,
    ).toBe('a_variant');
  });

  it('strictVariant: a variant-KEY binding pointing at an UNTAGGED asset is a stale link — rejected', () => {
    const b: RefBindings = { characters: { '女主/浴袍': aBase.id } };
    // without strict: the stale link masquerades
    expect(resolveCharacterSheet('女主', b, [aBase, aVariant], undefined, undefined, '浴袍')?.id).toBe('a_base');
    // with strict: rejected, tagged asset wins
    expect(
      resolveCharacterSheet('女主', b, [aBase, aVariant], undefined, undefined, '浴袍', { strictVariant: true })?.id,
    ).toBe('a_variant');
  });

  it('identity candidates: structured charName/variant fields are authoritative', () => {
    const structured = img('s1', '随便写的显示名', { charName: '张三', variant: '浴袍' });
    const miscued = img('s2', '张三', { charName: '李四' });
    const owned = resolveCharacterSheet('张三', undefined, [structured, miscued]);
    expect(owned?.id).toBe('s1');
    expect(resolveCharacterSheet('李四', undefined, [structured, miscued])?.id).toBe('s2');
  });

  it('legacy assets fall back to subject text, then filename tags', () => {
    expect(resolveCharacterSheet('女主', undefined, [renamed])?.id).toBe('renamed');
    // the costume tag embedded before a -gen- tail is understood
    expect(
      resolveCharacterSheet('女主', undefined, [renamed], undefined, undefined, '黑白条纹')?.id,
    ).toBe('renamed');
  });

  it('an untagged base sheet is preferred when no variant/age is asked', () => {
    expect(resolveCharacterSheet('女主', undefined, [aVariant, aBase])?.id).toBe('a_base');
  });

  it('a requested variant resolves to the tagged sheet; strict blocks silent fallback', () => {
    expect(resolveCharacterSheet('女主', undefined, [aBase], undefined, undefined, '浴袍')?.id).toBe('a_base');
    expect(
      resolveCharacterSheet('女主', undefined, [aBase], undefined, undefined, '浴袍', { strictVariant: true }),
    ).toBeUndefined();
    expect(resolveCharacterSheet('女主', undefined, [aVariant, aBase], undefined, undefined, '浴袍')?.id).toBe('a_variant');
  });

  it('an age tag resolves 名字/年纪 assets when the variant does not claim one', () => {
    expect(resolveCharacterSheet('女主', undefined, [aBase, aAge], undefined, '晚年')?.id).toBe('a_age');
    expect(resolveCharacterSheet('女主', undefined, [aBase, aAge])?.id).toBe('a_base');
  });

  it('with no untagged base, the newest owned asset is the fallback', () => {
    expect(resolveCharacterSheet('女主', undefined, [aVariant])?.id).toBe('a_variant');
  });
});

describe('resolveFrameRefs', () => {
  const sheet = img('c1', '张三');
  const envScene = img('e1', '内. 浴室');
  const envGeneric = img('e2', '环境', { kind: 'environment' });

  it('resolves character + bound environment', () => {
    const b: RefBindings = { characters: { 张三: 'c1' }, environment: 'e2' };
    const refs = resolveFrameRefs('action', '张三', '内. 浴室', b, [sheet, envGeneric]);
    expect(refs.character?.id).toBe('c1');
    expect(refs.environment?.id).toBe('e2');
  });

  it('CHARACTER generation NEVER gets a backdrop (独立背景 rule)', () => {
    const b: RefBindings = { characters: { 张三: 'c1' }, environment: 'e2' };
    const refs = resolveFrameRefs('character', '张三', '内. 浴室', b, [sheet, envGeneric]);
    expect(refs.environment).toBeUndefined();
  });

  it('unbound environment: scene-title subject, then sceneKey containment, then generic 环境', () => {
    const refs = resolveFrameRefs('action', '张三', '内. 浴室', undefined, [sheet, envScene]);
    expect(refs.environment?.id).toBe('e1');
    const envKeyed = img('e3', '任意', { kind: 'environment', sceneKey: '浴室' });
    const refs2 = resolveFrameRefs('action', '张三', '内. 豪华浴室 - 夜', undefined, [sheet, envKeyed]);
    expect(refs2.environment?.id).toBe('e3');
    const refs3 = resolveFrameRefs('action', '张三', '内. 某处', undefined, [sheet, envGeneric]);
    expect(refs3.environment?.id).toBe('e2');
  });
});

describe('resolveActionRef', () => {
  const blocks = [
    blk('0', 'SCENE_HEADING', '内. 浴室'),
    blk('1', 'CHARACTER', '张三（浴袍）'),
    blk('2', 'ACTION', '张三泡入热水'),
  ];
  const sheet = img('z1', '张三/浴袍');

  it('ready: cast member resolved to a reference image (variant carried)', () => {
    const r = resolveActionRef(blocks, 2, [], undefined, [sheet], '内. 浴室');
    expect(r).toMatchObject({ kind: 'ready', characterName: '张三', variant: '浴袍' });
    if (r.kind === 'ready') expect(r.image.id).toBe('z1');
  });

  it('needs-image: the beat names a character with no design sheet', () => {
    const r = resolveActionRef(blocks, 2, [], undefined, []);
    expect(r).toEqual({ kind: 'needs-image', characterName: '张三', variant: '浴袍' });
  });

  it('no-character: the beat names nobody', () => {
    const r = resolveActionRef([blk('0', 'ACTION', '空镜')], 0, [], undefined, [sheet]);
    expect(r).toEqual({ kind: 'no-character' });
  });

  it('extraCharNames merge scene-graybox blocking names into the universe', () => {
    const solo = [blk('0', 'ACTION', '周荇推门而入')];
    expect(resolveActionRef(solo, 0, [], undefined, []).kind).toBe('no-character');
    const r = resolveActionRef(solo, 0, ['周荇'], undefined, [img('w1', '周荇')]);
    expect(r).toMatchObject({ kind: 'ready', characterName: '周荇' });
  });
});

describe('resolveBeatRefs', () => {
  const blocks = [
    blk('0', 'SCENE_HEADING', '内. 茶馆'),
    blk('1', 'CHARACTER', '张三'),
    blk('2', 'CHARACTER', '李四'),
    blk('3', 'ACTION', '00:00-00:05。张三出手,李四倒下'),
  ];
  const z = img('z', '张三');
  const l = img('l', '李四');

  it('gates on the PRIMARY only: a missing lead blocks, secondaries degrade silently', () => {
    const r = resolveBeatRefs(blocks, 3, [], undefined, [l]);
    expect(r.needsImage).toBe(true);
    expect(r.primary).toBeUndefined();
    expect(r.others.map(o => o.name)).toEqual(['李四']);
  });

  it('resolves primary first, then others in cast order, plus the environment', () => {
    const env = img('e', '内. 茶馆');
    const r = resolveBeatRefs(blocks, 3, [], undefined, [l, z, env], '内. 茶馆');
    expect(r.needsImage).toBe(false);
    expect(r.primary?.name).toBe('张三');
    expect(r.primary?.image.id).toBe('z');
    expect(r.others.map(o => o.name)).toEqual(['李四']);
    expect(r.environment?.id).toBe('e');
  });

  it('no cast → nothing resolved, no blocking', () => {
    const r = resolveBeatRefs([blk('0', 'ACTION', '空镜')], 0, [], undefined, [z]);
    expect(r).toEqual({ others: [], needsImage: false });
  });

  it('a bound environment id wins over the scene-title search', () => {
    const boundEnv = img('eb', '别的说明');
    const b: RefBindings = { characters: {}, environment: 'eb' };
    const r = resolveBeatRefs(blocks, 3, [], b, [z, l, boundEnv], '内. 茶馆');
    expect(r.environment?.id).toBe('eb');
  });
});
